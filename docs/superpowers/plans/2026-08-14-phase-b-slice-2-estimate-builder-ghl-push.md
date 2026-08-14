# Phase B (Slice 2): Estimate Builder UI + GHL Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first Next.js/Vercel app — a mobile-first estimate builder that computes with the golden-tested pricing engine, writes immutable versioned estimate rows, and pushes both opportunity headline fields and a draft customer-facing GHL estimate document, killing the daily Fillout→GHL rekeying.

**Architecture:** Next.js 16 App Router app in `web/` (own package.json; legacy root package.json untouched), importing the shared `_shared/pricing.ts` via a re-export shim (never forked). All data access server-side through service-role Supabase client behind Supabase Auth (3 users); atomic estimate writes via a Postgres RPC (no client transactions + undeletable rows make cleanup impossible otherwise). GHL push is a Next server action: per-target (fields / doc), non-fatal, idempotent via a `ghl_push_state` table.

**Tech Stack:** Next.js 16.3.x · React 19.2.x · Tailwind 4.3.x · @supabase/supabase-js 2.112.x + @supabase/ssr 0.12.x · zod 4.4.x · vitest 4.1.x (web pure logic only) · Deno (existing `_shared` suite) · GHL API 2.0 (`Version: 2021-07-28`), incl. Estimates API (`POST/PUT /invoices/estimate`)

**Spec:** `BUILD_PLAN.md` "Phase B — Estimate builder (kill the rekeying)" (L204–213) + `DISCOVERY_2026-07-31.md` §1 + `docs/superpowers/plans/2026-08-14-phase-b-estimates-research.md`

## Context

Phase B slice 1 (merged 2026-08-14) shipped the pricing engine (`_shared/pricing.ts`, golden-tested to the cent against all 321 live estimates) and the immutable versioned `estimates` schema — but no way to use them. Dane and Jackson still price jobs in Fillout and then retype nearly everything into a customer-facing GHL estimate document, daily — the friction Dane independently named as his biggest pain and discovery ranked as the highest-credibility first win.

**API spike result (this session): GO.** GHL's Estimates API exists in API 2.0 (`/invoices/estimate` family, `Version: 2021-07-28`), is reachable by Location-Access private-integration tokens with scope `invoices/estimate.write`, creates **drafts by default** (send is a separate action we never call — Dane reviews and sends from GHL), takes line items as one embedded array (name/description/qty/amount in **dollars**), and auto-assigns `EST-` numbers. Caveats: our existing `GHL_API_KEY` predates these scopes (manual scope-add + possible token rotation required — see Manual Setup), `contactDetails` requires id+name+email+phoneNo, estimate docs attach to a **contact** (no opportunityId field — the opportunity↔doc link is ours to keep), and update is a full-replace PUT.

### Decisions made by Matt (2026-08-14, this session)

1. **GHL push target:** opportunity custom fields **and** a draft customer-facing GHL estimate document. Fallback if token scopes missing at runtime: fields-only + UI banner.
2. **Entry point:** both paths — attach to an existing GHL opportunity, or create contact + opportunity at Stage 3 "Estimate in Progress".
3. **Auth:** Supabase Auth, email/password, exactly 3 users (Dane, Jackson, Matt), no self-signup. Gives estimator identity → the "discount by estimator" dataset.
4. **In scope:** `deno.json` test task, `pricing_variables` loader, audit trail for the mutable estimate columns. **Out:** historical import of the 321 Airtable estimates (later slice); BL-4 crew Slack format (end of Phase B).
5. **Customer-facing doc line pricing:** proportional allocation of `coalesce(quoted_price, total_bid)` across scope lines by direct cost (hours×rate + dumps×rate + materials); last line absorbs rounding so the doc total equals the quoted price exactly. No line items → one "Demolition Services" line at full price.

### Design decisions taken in planning (approved via this plan)

- **Header inputs stay the pricing source of truth** (engine contract untouched). *Quick mode* (no line items) = exactly today's Fillout flow. *Itemized mode* (≥1 line) = header hours/dumps become read-only sums of line items; server validates reconciliation (Σ to 0.01). `days_employees` mode (1/321 usage) hides line items.
- **GHL linkage lives in a separate mutable `ghl_push_state` table** (contact/opportunity/doc IDs, per-target timestamps, errors) — NOT as columns on immutable `estimates`. Keeps the immutability guard's mutable set at its current four columns.
- **New estimates columns:** `created_by uuid` + `created_by_name text` (immutable — added to guard list). No `ghl_opportunity_id` column.
- **Atomic writes via Postgres RPC** `create_estimate_with_items` — supabase-js has no transactions, and a header-committed/line-item-failed orphan could never be deleted (no-delete trigger) or edited (immutability). One RPC call = one transaction. Version >1 inserts flip the parent to `superseded` in the same transaction.
- **Actor identity for audit:** all mutations go through RPCs that `set_config('app.actor_id'/'app.actor_name', …, true)` (transaction-local); the audit trigger reads it. (No `auth.uid()` exists on service-role connections.)
- **Rates loader throws on missing keys — never silently falls back to `DEFAULT_RATES`.** Engine keeps its one-arg default so the golden test is untouched. `requireRates` gets exported (additive keyword only) so the loader reuses the engine's own validation.
- **Path B (record-only) estimates skip the customer doc push** — no proposal is sent by definition; fields push still runs.
- **New-version push behavior:** opportunity fields always re-pushed (idempotent PUT). Doc: if prior doc still `draft` → full-replace PUT in place; if `sent/viewed/accepted/declined` → never mutate what the client saw; create a new draft titled "ESTIMATE (REVISED)" and note the supersession.
- **No new GHL custom fields in v1.** Markup/quoted-vs-calc delta ride in the Scope Notes rendered block (internal audience).

## Global Constraints

- **No quoted price may move.** `pricing_golden_test.ts` (321 estimates to the cent) stays green untouched; `computeEstimate(inputs)` keeps its one-argument default to `DEFAULT_RATES`.
- **Cost-plus MARKUP, not margin divisor.** `markup_pct` everywhere; `true_margin_pct` reported alongside. Presets 20/25/30/35 + free entry; 15% floor is an advisory warning, never blocking.
- **Share `_shared/pricing.ts`, never fork it.** One additive change allowed this slice: `export` on `requireRates`.
- **Estimates writer contract:** immutable after insert (only `status`, `quoted_price`, `quote_override_reason`, `job_number` mutable); corrections = new version rows; version-1 rows take `estimate_number` from the sequence, version >1 rows supply the parent's `estimate_number` explicitly AND set `supersedes_estimate_id`. Line items fully immutable. Estimates undeletable — **DB verification uses inspection queries or permanent labeled test rows (`job_name = 'TEST — void, do not use'`, left `declined`), never casual inserts.** First real estimate number ≥ 1411.
- **RLS posture unchanged:** enabled, zero policies. Anon key does auth only; every table read/write is server-side service-role after session verification. All new tables get RLS-on-no-policies; all new functions get `revoke … from public, anon, authenticated` and pinned `search_path = public`.
- **Never edit an applied migration** — corrections land in new ones (14-digit prefixes). Anything applied to Supabase is committed the same session.
- **Dump counts fractional** (0.25/0.35/1.25 live) — `numeric(6,2)`, `inputMode="decimal"`, no integer steppers.
- **Live recalc on every input change**; mobile-first throughout (Dane/Jackson estimate on phones).
- **GHL conventions:** base `https://services.leadconnectorhq.com`, header `Version: 2021-07-28`, custom fields `[{id, field_value}]` (`id:` format, numbers as numbers, omit empties), check `res.ok` and throw with status+body, GHL writes non-fatal (DB commits first), per-target idempotency gating. Retry once after 2s on 429/5xx/network only.
- **Parallel running:** Fillout + Airtable stay live; nothing retired this slice.
- **Frequent commits:** every task ends in a commit; never batch tasks into one commit.

## Manual Setup (Matt — before/alongside execution)

1. **GHL private integration scopes:** Settings → Private Integrations → add Invoices/Estimates scopes (`invoices/estimate.write` + read). ⚠️ **If this rotates the token, update the `GHL_API_KEY` Supabase secret in the same breath — live edge functions (`ghl-job-webhook`, syncs) share it** — and the Vercel env var once it exists. Task 9's smoke test verifies.
2. **Provision 3 auth users:** Supabase Dashboard → Authentication → Add User for Dane, Jackson, Matt (email+password; user metadata `display_name`: "Dane"/"Jackson"/"Matt"), then disable public signups.
3. **Vercel:** account/team ready; Task 13 creates the project (Root Directory `web`, "Include files outside root" enabled).

## File Structure

```
/ (repo root)
├── deno.json                                      # NEW (T1): test task + exclude web/
├── .gitignore                                     # T5: + .next/ .vercel .env*.local
├── supabase/
│   ├── functions/_shared/pricing.ts               # T7: export requireRates (one keyword)
│   └── migrations/
│       ├── 2026xxxx_phase_b2_estimator_columns.sql   # T2: created_by(+name) + guard update
│       ├── 2026xxxx_phase_b2_rpcs_audit.sql          # T3: RPCs + audit table/trigger
│       └── 2026xxxx_phase_b2_ghl_push_state.sql      # T4: push state + sync_log direction
└── web/                                           # NEW (T5): the Next.js app
    ├── package.json, next.config.ts, tsconfig.json, .env.example
    └── src/
        ├── middleware.ts                          # T6: @supabase/ssr session refresh + gate
        ├── lib/
        │   ├── pricing.ts                         # T5: re-export shim → ../../supabase/functions/_shared/pricing
        │   ├── supabase/server.ts                 # T6: anon cookie client (auth only)
        │   ├── supabase/admin.ts                  # T6: service-role client, import "server-only"
        │   ├── auth.ts                            # T6: requireUser()
        │   ├── rates.ts                           # T7: loadRatesConfig()
        │   ├── estimates/{types,validate,map,repo}.ts   # T8: data layer
        │   ├── ghl/client.ts                      # T9: fetch wrapper, contacts, pipelines, opps
        │   ├── ghl/estimateDoc.ts                 # T10: doc payload builder + allocation + Scope Notes
        │   ├── ghl/push.ts                        # T12: pushEstimateToGhl orchestration
        │   └── log.ts                             # T12: sync_log/job_events writers (port of _shared/log.ts)
        └── app/
            ├── login/page.tsx                     # T6
            └── (app)/
                ├── layout.tsx                     # T6: gated shell, bottom nav
                └── estimates/
                    ├── page.tsx                   # T11b: list
                    ├── actions.ts                 # T8/T11/T12: server actions
                    ├── new/page.tsx               # T11: builder
                    └── [id]/page.tsx + revise/page.tsx   # T11b: detail + new-version
```

---

## Tasks

Definition of done for every task: `deno task test` green (once T1 lands), `npm run build` + `npx vitest run` green in `web/` (once T5 lands), migration applied to `eiqqqwajmcpcwhvxxnhx` in the same session it's committed (DB tasks), one commit.

### Task 1: `deno.json` test task

**Files:** Create `deno.json` (repo root). Update `CLAUDE.md` test-run instructions.

```json
{
  "tasks": {
    "test": "deno test --allow-read=supabase/functions/_shared/fixtures supabase/functions/_shared/"
  },
  "exclude": ["web/", "node_modules/", "airtable-automations/"]
}
```

- [ ] Create file; run `deno task test` → 18/18 (golden 321 intact)
- [ ] Confirm `deno test --allow-all supabase/functions/_shared/` still works (documented habit)
- [ ] No `imports` map (must stay inert to `supabase functions deploy`)
- [ ] Commit

### Task 2: Migration — estimator columns + immutability guard update

**Files:** Create `supabase/migrations/<ts>_phase_b2_estimator_columns.sql`
**Interfaces — Produces:** `estimates.created_by uuid references auth.users(id)`, `estimates.created_by_name text` — both IMMUTABLE (added to guard list). Style: reproduce `20260814160000_phase_b_estimates_fixups.sql`'s `create or replace function public.enforce_estimate_immutability() … set search_path = public` with the full existing guard list + the two new columns. Mutable set stays exactly: `status, quoted_price, quote_override_reason, job_number`.

- [ ] Write migration (alter table add columns; re-create guard function with columns appended)
- [ ] Apply via MCP `apply_migration`; verify with `pg_get_functiondef('public.enforce_estimate_immutability'::regprocedure)` (shows new columns) + `information_schema.columns` — **no throwaway estimate inserts**
- [ ] Commit (same session as apply)

### Task 3: Migration — write RPCs + audit trail

**Files:** Create `supabase/migrations/<ts>_phase_b2_rpcs_audit.sql`
**Interfaces — Produces (all `security definer`-free, service-role-only via revoke; `set search_path = public`):**
- `create_estimate_with_items(p_estimate jsonb, p_line_items jsonb default '[]') returns estimates` — single transaction: insert header (`estimate_number` = `coalesce(explicit, nextval)` per writer contract; version default 1), loop-insert line items, and if `supersedes_estimate_id` present flip parent to `superseded`. Race guard = existing `unique (estimate_number, version)`.
- `update_estimate_status(p_id uuid, p_status estimate_status, p_actor uuid, p_actor_name text)`
- `update_estimate_quote(p_id uuid, p_quoted_price numeric, p_reason text, p_actor uuid, p_actor_name text)` — raises if price ≠ `total_bid` and reason blank (DB backstop for the override-reason rule)
- Both mutation RPCs `set_config('app.actor_id'/'app.actor_name', …, true)` before updating.
- `estimate_mutations_audit` table (old/new pairs for the 4 mutable columns + `actor_id`, `actor_name`, `changed_at`; RLS on, no policies) + `audit_estimate_mutation()` AFTER UPDATE trigger on `estimates` reading `current_setting('app.actor_id', true)`.
- `revoke all … from public, anon, authenticated` on every function.

- [ ] Write migration; apply
- [ ] Live verification (service role): create ONE permanent labeled estimate (`job_name 'TEST — void, do not use'`), exercise both mutation RPCs → audit rows carry actor; reason-required raise fires; create v2 via RPC → parent flips `superseded`, v2 carries parent's `estimate_number`; leave both rows `declined`; record numbers in BUILD_LOG at session close
- [ ] Commit

### Task 4: Migration — `ghl_push_state` + sync_log direction

**Files:** Create `supabase/migrations/<ts>_phase_b2_ghl_push_state.sql`
**Interfaces — Produces:**

```sql
create table ghl_push_state (
  estimate_id uuid primary key references estimates(id),
  ghl_contact_id text, ghl_opportunity_id text,
  ghl_estimate_id text, ghl_estimate_number text,
  fields_pushed_at timestamptz, doc_pushed_at timestamptz,
  last_error text, attempts int not null default 0,
  updated_at timestamptz not null default now()
);  -- RLS on, no policies
```

plus `sync_log_direction_check` widened with `'app_to_ghl'` (drop + re-add; exact precedent: `20260813190000_phase_a_audit_write_fixups.sql`).

- [ ] Write migration; apply; verify constraint via `pg_constraint` + table exists with RLS on
- [ ] Commit

### Task 5: Next.js scaffold + pricing import proof

**Files:** Create `web/` via `create-next-app@16` (TS, Tailwind 4, App Router, src dir, no ESLint bikeshed); `web/next.config.ts`; `web/src/lib/pricing.ts` shim; root `.gitignore` additions (`.next/`, `.vercel`, `.env*.local`); `web/.env.example` (names only); vitest 4 setup.

```ts
// web/src/lib/pricing.ts — the ONLY file referencing the outside path
export * from "../../../supabase/functions/_shared/pricing";
```

```ts
// web/next.config.ts
import path from "node:path";
import type { NextConfig } from "next";
const repoRoot = path.join(__dirname, "..");
const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },          // module graph includes ../supabase/…
  outputFileTracingRoot: repoRoot,
  experimental: { externalDir: true },    // webpack fallback path
};
export default nextConfig;
```

- [ ] Scaffold; write config + shim + gitignore + .env.example
- [ ] Vitest cross-runtime smoke test: `computeEstimate({laborMethod:"total_hours", totalJobHours:34, dumpCount:1, jobSpecificCosts:0, markupPct:25}).totalBid === 2543.51` (Jorge's Interior — same case the Deno suite pins)
- [ ] `npm run build` + `npx vitest run` green — this commit proves the import mechanism
- [ ] `deno task test` still green (exclude working)
- [ ] Commit

### Task 6: Auth

**Files:** Create `web/src/lib/supabase/server.ts` (anon cookie client via `@supabase/ssr`), `web/src/lib/supabase/admin.ts` (service-role, `import "server-only"`, `persistSession:false`), `web/src/lib/auth.ts` (`requireUser(): {id, name}` — `getUser()` server-verified, redirect `/login` on miss), `web/src/middleware.ts` (session refresh + redirect, matcher excludes static), `web/src/app/login/page.tsx` + signIn/signOut actions, `web/src/app/(app)/layout.tsx` shell.
**Interfaces — Produces:** `requireUser()` — called first line of every server action; only then is the admin client constructed. Env contract: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `GHL_API_KEY`, `GHL_LOCATION_ID` (server-only).

- [ ] Implement; Matt provisions the 3 users (Manual Setup #2) if not already done
- [ ] Manual test: unauthenticated → redirect; login works on a phone; session survives browser restart; `admin.ts` imported from a client component fails the build (spot-check)
- [ ] Record the 3 account emails in CLAUDE.md
- [ ] Commit

### Task 7: `requireRates` export + rates loader

**Files:** Modify `supabase/functions/_shared/pricing.ts` (line 62: `function requireRates` → `export function requireRates` — nothing else). Create `web/src/lib/rates.ts`.
**Interfaces — Produces:** `loadRatesConfig(): Promise<{rates: Rates; defaultMarkupPct: number; markupFloorPct: number}>` — wrapped in React `cache()` (per-request dedup only); reads all 6 `pricing_variables` keys; **throws on any missing key** (never falls back to `DEFAULT_RATES`); validates via the engine's own `requireRates`.

- [ ] Export keyword change; `deno task test` in the SAME commit (golden gate on the engine file change)
- [ ] Implement loader; vitest: missing key throws, bad ccFeeRate throws, happy path maps snake→camel correctly
- [ ] Commit

### Task 8: Estimates data layer

**Files:** Create `web/src/lib/estimates/types.ts`, `validate.ts`, `map.ts`, `repo.ts`; `web/src/app/(app)/estimates/actions.ts` (create/status/quote actions).
**Interfaces — Produces:**
- `validate.ts` (pure): zod draft schema; itemized-mode reconciliation (`total_job_hours == Σ labor_hours` and `dump_count == Σ dump_count` to 0.01; `job_specific_costs ≥ Σ materials_cost`); override-reason rule.
- `map.ts` (pure): draft + `EstimateOutputs` + `RatesConfig` + user → snake_case jsonb payload. Version-1 payload OMITS `estimate_number`; `newVersion` payload carries parent's `estimate_number`, `version = parent+1`, `supersedes_estimate_id = parent.id` — **the writer-contract unit test lives here.**
- `repo.ts` (`server-only`): `createEstimate(draft, user)` (loadRatesConfig → validate → `computeEstimate(inputs, rates)` → rpc), `createNewVersion(parentId, draft, user)`, `updateStatus`, `updateQuote`, `listEstimates({q?, includeSuperseded=false, limit=50})`, `getEstimate(id)` (header + items by sort_order + version chain + audit + push state).

- [ ] Implement with vitest on validate/map (incl. writer-contract cases + rates snapshot passthrough)
- [ ] One live integration exercise via a server-side script/action against the T3 test estimate chain (no new throwaway rows)
- [ ] Commit

### Task 9: GHL client port

**Files:** Create `web/src/lib/ghl/client.ts`. Reference (read-only): `supabase/functions/ghl-job-webhook/index.ts`, `airtable-job-created/index.ts`, `airtable-client-sync/index.ts`.
**Interfaces — Produces:** typed functions — `searchContactByEmail`, `createContact` (duplicate-400 → reuse `meta.contactId`), `resolvePipeline()` (cached: 'Job Pipeline' + case-insensitive substring stage match 'estimate in progress'), `createOpportunity`, `updateOpportunity` (partial PUT `{name, monetaryValue, customFields}`), `getCustomFieldDefs()` (cached, for Job Scope option matching), `listEstimateDocs({contactId})`, plus `ghlFetch` wrapper: `res.ok` check throw status+body, retry-once-after-2s on 429/5xx/network.
**Includes the live scope smoke test:** `GET /invoices/estimate/list?altId=<loc>&altType=location&limit=1&offset=0` — 200 = doc push GO; 401 = fields-only mode + tell Matt (Manual Setup #1).

- [ ] Implement; vitest on pure helpers (payload builders, retry predicate) with mocked fetch
- [ ] Run smoke test against live location; record result
- [ ] Commit

### Task 10: Estimate doc payload builder

**Files:** Create `web/src/lib/ghl/estimateDoc.ts` (pure builder) + create/update calls via client.
**Interfaces — Produces:** `buildEstimateDocPayload(estimate, lineItems, contact): CreateEstimatesDto` — required set `{altId, altType:'location', name, businessDetails:{name:'Lost Boys Demolition'}, currency:'USD', items, discount:{type:'percentage',value:0}, contactDetails:{id,name,email,phoneNo}, frequencySettings:{enabled:false,schedule:{}}, liveMode:true, meta:{lbd_estimate_id, lbd_estimate_number, lbd_version}}`. **Allocation:** split `coalesce(quoted_price, total_bid)` across lines ∝ direct cost (`labor_hours×labor_rate + dump_count×dump_rate + materials_cost`), cents-rounded, last line absorbs remainder (Σ amounts === quoted exactly); zero direct cost → equal split; no line items → one "Demolition Services" line.
**Spike step (live, once):** minimal create + delete against the live location to verify the `frequencySettings`/`businessDetails` minimal payloads and dollars formatting pass GHL's validator. Requires Task 9's smoke = GO.

- [ ] Implement builder; vitest: allocation sums exactly to quoted price incl. rounding-remainder and equal-split edge cases; meta breadcrumb present
- [ ] Live spike: create minimal doc, verify in GHL UI it's a draft, delete it; adjust payload if validator complains; record findings
- [ ] Commit

### Task 11: Builder page (the page that matters)

**Files:** Create `web/src/app/(app)/estimates/new/page.tsx` (server shell: `loadRatesConfig()` + active `scope_library` filtered by job type) + `EstimateBuilder` client component + small components (Field, SegmentedControl, PresetChips, BottomSheet scope picker, StickyTotalBar, LineItemCard).
**Behavior:** single scrolling column — Client → Job → Scope line items ("Add scope" bottom sheet over the 19 library rows; tap prefills hours/dumps from defaults into an editable card) → Labor (segmented, `total_hours` default; `days_employees` minimal, hides line items) → Dumps (`inputMode="decimal"`) → Costs → Markup (chips 20/25/30/35 + free entry; amber advisory below floor) → Path B toggle ("record only — no proposal") → Save. Quick vs itemized mode per the design decision. **Sticky bottom bar: live Total Bid + true margin on every keystroke** via client-side `computeEstimate` from `@/lib/pricing` against server-provided rates; tap expands the 8-output panel. On save the server action recomputes authoritatively and persists ITS numbers; client compares its preview to the saved row and notices on drift.

- [ ] Implement; vitest for extracted pure logic (mode derivation, item→header sums)
- [ ] Manual phone QA: live recalc, fractional dumps (0.25), chips, floor warning, both labor methods, save → correct row; spot-check one real bid against Fillout to the cent
- [ ] Commit

### Task 11b: List + detail + lifecycle

**Files:** Create `web/src/app/(app)/estimates/page.tsx` (card list: `#1412 v2 — name — $X — [status]`, server-side `ilike` search, superseded hidden by default), `[id]/page.tsx` (header, outputs panel, quoted-price block — editing away from total_bid reveals REQUIRED reason field, status actions Sent/Accepted/Declined, line items, version chain, audit history, push status), `[id]/revise/page.tsx` (builder preloaded from parent → `createNewVersion`).

- [ ] Implement; manual: status flips audit correctly, quote override requires reason (UI + RPC backstop), revise → v2 + parent superseded, double-submit revision surfaces the unique-constraint error kindly
- [ ] Commit

### Task 12: Push orchestration + UI

**Files:** Create `web/src/lib/ghl/push.ts`, `web/src/lib/log.ts` (port `_shared/log.ts` writers: swallow own errors; `sync_log` direction `app_to_ghl`, one row per target; `job_events` only when an opportunity is created). Modify builder/detail to wire it.
**Interfaces — Produces:** `pushEstimateToGhl(estimateId): Promise<PushResult>` where `PushResult = {fields: 'ok'|'error', doc: 'ok'|'skipped_path_b'|'skipped_missing_contact'|'not_configured'|'error', errors?}`.
**Sequence (per-target idempotent via `ghl_push_state`; each target independently try/caught; DB row already committed — push never rolls anything back):**
- *Attach path:* upsert state → fields target: `updateOpportunity` (name, monetaryValue = `coalesce(quoted_price,total_bid)`, customFields per mapping) → doc target (unless Path B / missing email+phone / scopes 401): create if `ghl_estimate_id` null else full-replace PUT if still draft, else new "ESTIMATE (REVISED)" draft. Before any doc create: `listEstimateDocs({contactId})` and adopt a hit whose `meta.lbd_estimate_id` matches (create-then-crash recovery).
- *Create path:* contact search→create (dup-400 reuse) → `resolvePipeline` → `createOpportunity` at Stage 3 with fields riding along → doc target → persist ids.
- Field mapping: the 7 estimate custom fields (`sN6l…` labor hrs = `labor_cost/labor_rate`, `KVlU…` labor cost, `XGz8…` materials = `job_specific_costs`, `Vgxd…` dump fees, `be36…` overhead, `zGtP…` profit, `5u48…` true margin) + Job Scope multi-select (line names ∩ option list, mismatches dropped into Scope Notes) + Scope Notes rendered block (est#/version, quoted vs calc + reason, per-line hours/dumps/materials/allocated price, markup + true margin, doc number) + Job Address/Job Type/Estimator (from auth identity) + Airtable Job ID = `job_number` only when set.
- Builder gets an "attach to existing opportunity" picker (contact email search → their open opportunities); detail gets per-target push status + Retry (re-runs unfinished targets only).

- [ ] Implement; vitest on pure mapping/rendering (customFields builder, Scope Notes, per-target gating decisions)
- [ ] Manual E2E against live GHL with a labeled TEST contact/opportunity: attach path, create path, Path B (no doc), missing-phone (doc skipped, fields pushed), forced doc failure (fields survive, retry completes doc), revise → draft updated in place; verify drafts render correctly in GHL UI; clean up TEST opportunity/doc (deletable, unlike estimates)
- [ ] Commit

### Task 13: Vercel deploy + docs close-out

**Files:** Modify `CLAUDE.md` (web app section: stack, env contract, auth accounts, push design, new tables/RPCs/direction value, PIT scope requirement, `deno task test`), `BUILD_LOG.md` (entry: what shipped, migrations, test-row numbers, defects, next), `NEXT_SESSION_PROMPT.md` (regenerate).

- [ ] Create Vercel project: Root Directory `web`, include-outside-root ENABLED, env vars set (service key + GHL vars server-only)
- [ ] Production smoke on phones: login → build a real estimate alongside Fillout (parallel-running check) → push → Dane/Jackson see the draft in GHL
- [ ] Docs + BUILD_LOG + commit; push to GitHub

---

## Verification (end-to-end)

1. `deno task test` → 18/18 incl. golden 321 (the "no quoted price may move" gate) — after the `requireRates` export and at close.
2. `cd web && npm run build && npx vitest run` → green (cross-runtime pricing smoke = Deno-pinned value).
3. Live DB: new tables RLS-on-0-policies; `pg_get_functiondef` shows updated guard; audit rows carry actor; RPC revokes in place; `get_advisors` shows no new criticals.
4. Writer contract proven live: T3's labeled test chain (v1 seq-numbered, v2 explicit number + supersedes + parent flipped) recorded in BUILD_LOG.
5. Full workflow on a phone in production: login → new estimate (live recalc) → save → push → opportunity fields populated + draft doc in GHL with allocated lines summing exactly to the quoted price → revise → draft updated in place.
6. One real bid double-keyed in Fillout and the builder agrees to the cent.
7. Repo/production parity: `list_migrations` shows the 3 new migrations, all committed; no uncommitted deploy artifacts.

## Risks & watch items

- **`GHL_API_KEY` rotation blast radius:** the token is shared with live edge functions. If adding estimate scopes rotates it, the Supabase secret must be updated simultaneously (Manual Setup #1). The doc push degrades to fields-only on 401 rather than failing the push.
- **GHL estimate-create validator quirks** (`frequencySettings`/`businessDetails` minimal payloads): de-risked by the one-off live spike in Task 10 before any UI wiring.
- **Estimates are undeletable:** verification discipline — labeled permanent test rows only, logged in BUILD_LOG (JOB-1102/1104 precedent).
- **Turbopack/Vercel outside-root import:** proven in Task 5's build before anything else depends on it; webpack fallback via `experimental.externalDir`.

## Explicitly deferred (recorded so they aren't lost)

- Historical import of the 321 Airtable estimates (`status='historical'`, numbers 1001–1321).
- BL-4 crew Slack message format — end of Phase B (after this slice), per Matt 2026-08-14.
- Optional "Estimate Builder Link" GHL custom field (idempotent create via `create-ghl-fields.js` pattern) if wanted later.
- Estimate → job linkage automation (stamping `estimates.job_number` at Quote Accepted) — Phase B/F seam, not this slice.
- Retiring Fillout — only after Dane/Jackson live on the builder.
