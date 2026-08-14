# Build Log

Deployment and session history for the Lost Boys ops system. **This file is the build log.**

Migrated 2026-07-30 from the `Build Log` table in the Airtable Pipeline Reference base
(`appA7uj7FhnPp9Bvg` / `tbl3pCxGn0xqC1Qvu`). All 8 records were transferred verbatim below. That
table is **superseded** — do not write to it, and do not read it as current. Everything above the
migration line was authored in Airtable; everything at or below is native to this file.

**How to use:** add a new entry at the top of *Entries* after any deploy or any session that
changes the system or its documentation. Keep the newest first. Record what a future session would
otherwise have to rediscover — decisions, defects found, things that surprised you — not just what
shipped.

---

## Current status at a glance

| Function / Component | Stage | Status | Last touched |
|---|---|---|---|
| `airtable-client-sync` | — | 🟢 Live (v19) | 2026-07-30 |
| `ghl-contact-sync` | — | 🟢 Live (v27+) — tags crash FIXED 2026-08-14, live-verified | 2026-08-14 |
| `airtable-job-created` | 3 | 🟡 In Progress (v21) — **GHL UI verification still pending since 2026-05-15** | 2026-07-30 |
| `airtable-job-scheduled` | 6 | 🟢 Live (v16) — verified end to end | 2026-05-15 |
| `airtable-job-completed` | 8 | 🟢 Live (v14) | 2026-07-30 |
| `receive-airtable-webhook` | — | 🟢 Live (v11) — **unauthenticated**, retirement queued | 2026-07-30 |
| `push-to-airtable` | — | ⚪ Dormant (v11) — never run, latent bug | 2026-07-30 |
| `ghl-job-webhook` | A | 🟢 Live (v7) — Phase A keystone, live E2E verified; v7 = final-review fix wave | 2026-08-13 |
| `crew-night-before` | — | 🟢 Live (v4) — nightly crew digest, Slack E2E verified live via synthetic job (see below) | 2026-08-13 |
| Phase B slice-2 (`web/` app + DB) | B | 🟢 **Complete on branch** — all 14 build tasks + the mid-session no-login scope change + a final whole-branch review + fix wave done, reviewed, merged onto `phase-b-slice-2` (tip `53e7d64`); **not merged to main**, decision returns to Matt; 5 migration files (4 units of work — the RPCs migration + its fixups count as one unit) live | 2026-08-14 |
| `stripe-webhook` | 9–11 | 🔴 Not Built | — |
| Job Completed Airtable Auto | 8 | 🟡 In Progress | 2026-05-07 |
| GHL Custom Fields + Mapping | — | 🟢 Live (19 fields) | 2026-05-15 |

Supabase project for all functions: `eiqqqwajmcpcwhvxxnhx`.

---

## Entries

### 2026-08-14 (night) — Phase B slice-2 COMPLETE on branch: T11/T11b/T12/T9f + no-login scope change + final review; T13 docs close-out

**Status:** 🟢 Complete on branch `phase-b-slice-2` (tip `53e7d64`, 16 new commits since the last
close at `26b9495`), **NOT merged to main** — merge-to-main is Matt's call, informed by the final
whole-branch review's APPROVED verdict below. Resumes and finishes the session paused after Task 8.
Vercel deploy and the production phone smoke are **controller/Matt-owned, not part of this session's
scope** — see the deploy-status line at the bottom of this entry.

**What shipped, task by task (all reviewed by opus; sonnet implemented):**

- **T11 — estimate builder page** (`/estimates/new`): mobile-first, live client-side recalc via
  `computeEstimate`, quick/itemized modes, scope picker over the 19 `scope_library` rows, markup
  preset chips. First-real-create live smoke burned estimate 1416. Fix round 1 closed two review
  findings: partial-decimal inputs (`".25"`) silently resolving to 0, and Save being disabled with
  unreachable dead-code explanations. Merge was deliberately **deferred** past the fix round because
  the no-login scope change (below) landed mid-flight and would have broken the builder's call
  signature immediately after merging — folded into one **integration round** instead (commit
  `cfc90f0`) that rebased onto the merged no-login branch, wired `useEstimator()` → `estimatorName`,
  wired the Path B toggle to the now-real `is_path_b` column, fixed a comma/whitespace decimal-parse
  bug, and re-ran the live smoke through the real action path (estimate 1424). Self-caught mid-round:
  `/estimates/new` had gone **static** post-auth-removal (would have frozen rates at build time) —
  `force-dynamic` added; confirmed the only affected route.
- **T11b — list + detail + lifecycle pages**: quote override (required reason enforced by the
  `quote_override_reason_required` DB CHECK), status actions restricted to sent/accepted/declined
  only, version chain + audit history display, revise → new version. Estimate 1425 burned
  (override → v2 → declined) proving the full lifecycle live. Two **live-caught UI bugs fixed
  in-commit**, not just found: the override-reason textarea was unmounting mid-typing (now keyed off
  price-differs-from-bid instead of a state flag that flickered), and `revise`'s `notFound()` was
  firing spuriously on a Next.js post-action page refresh (guard removed; a friendly
  "newer version exists" message now covers the real conflict case — reproduced live with two
  browser tabs racing a double-revise). Fix round 1 additionally closed the `listEstimates`
  PostgREST-filter-injection carry from T8 (verified live against `,()` bypass attempts) and gave
  superseded-version pages a "viewing an old version" banner.
- **T12 — GHL push orchestration** (`web/src/lib/ghl/push.ts` + `PushPanel.tsx`): per-target
  idempotent push (opportunity fields, draft estimate doc) via `ghl_push_state`, attach-existing or
  create-new-opportunity, version-to-version GHL-id inheritance via `supersedes_estimate_id`. Live
  E2E burned estimates 1417–1420 (initial) and 1421–1423 (fix-round re-verification); real GHL
  artifacts created and manually cleaned up. **Settled a standing open question live**: `PUT
  /opportunities/{id}` **merges** `customFields`, it does not replace them (CV-2, previously an
  assumption inherited from Phase A's behavior — now proven, and it matters to
  `airtable-job-created`/`ghl-job-webhook` too, not just this feature). Fix round 1 decoupled the
  fields-push and doc-push targets so a transient fields error no longer silently skips and
  mislabels the doc-push `sync_log` row, and added create-fallback recovery for a doc Dane manually
  deleted in the GHL UI (previously wedged that estimate's doc push forever on a 404).
- **T9f — follow-up fix task** (controller-created mid-session, not in the original 14): repaired
  `searchContactByEmail` in `web/src/lib/ghl/client.ts` (the live API had moved off the `GET
  /contacts/?email=` shape T9 was built against — that call now 422s; fixed to `POST
  /contacts/search` with an `eq` filter, live-verified); added the `server-only` import guard T9
  deferred; found and closed a **second, transitive** version of the same guard gap
  (`estimateFields.ts → estimateDoc.ts → client.ts` via the money-allocation helper) by extracting a
  zero-dependency `allocation.ts` — proven **byte-identical** behavior via md5 hash match before/after
  the extraction, so T10's exact-remainder money math did not change.
- **No-login scope change (mid-session, Matt's explicit directive, plan-mode approved):**
  `docs/superpowers/plans/2026-08-14-no-login-estimator-picker.md`. Three tasks (A1 identity
  plumbing, A2 delete the auth stack, B1 persist Path B as a real column) replaced Task 6's
  Supabase-Auth login gate with a no-password device-remembered estimator picker. **See CLAUDE.md's
  "No-login estimate tool" section for the full user-facing description — do not rely on any
  auth-related text elsewhere in this repo written before this entry's date.** Net: `middleware.ts`,
  `/login`, `auth.ts`, `safe-next.ts` (and its 3-fix-round-hardened open-redirect protection),
  `supabase/server.ts`, and the `/debug` route are **deleted** (preserved in git history, not lost —
  T6's work through merged range `34eb9b7..0d3470b` remains a reusable pattern). Manual Setup #2
  (provision 3 auth users) is **cancelled**. Migration `20260814230000_phase_b2_path_b_flag.sql`
  applied live, adding `estimates.is_path_b boolean not null default false` and re-creating
  `create_estimate_with_items`/`enforce_estimate_immutability` to cover it — one fix round on the
  DB task (I-1: the coalesce expression needed a `nullif('')` wrap to match the guard's existing
  convention, verified via `pg_get_functiondef` hunk-diffs against the live baseline before and after
  apply, and confirmed the two function bodies contained *only* the intended `is_path_b` deltas).
- **Final whole-branch review** (dispatched early, in parallel with T11b's build, over commit range
  `342f489..e430534`, then a scoped supplemental pass over T11b's range after it merged): **APPROVED
  FOR MERGE, conditional** on three must-fix items — C-1 (these docs, this entry), C-2 (the
  `listEstimates` injection carry — closed inside T11b's own fix round, verified in that review),
  C-3 (stale `requireUser()` doc-comments left behind by the no-login deletion — closed by a
  dedicated **final fix wave** commit that also added `layout.tsx`'s missing title/description,
  fixed GHL doc-list pagination (see below), and added allowlist-rejection tests at the actions
  layer). Reviewer's full triage: 23 findings already resolved by the time of review, 3 must-fix (all
  closed above), 26 follow-up-OK (see Known limitations / Deferred below).

**The three new DB migrations from the paused-session entry below are unchanged; one more applied
live this segment:**
- `20260814230000_phase_b2_path_b_flag.sql` — `estimates.is_path_b`, described above.

**Gates at close:** `deno task test` **18/18** (golden 321 gate intact — the engine changed by
exactly one word across the entire slice, the `requireRates` export). Web suite (`cd web && npx
vitest run`) **261/261** (15 test files). `npm run build` green with env supplied — routes: `/`
(static), `/estimates` (dynamic), `/estimates/[id]` (dynamic), `/estimates/[id]/revise` (dynamic),
`/estimates/new` (dynamic, force-dynamic-corrected). No middleware, no `/login` in the build output.

**Live estimates data at close (verified via SQL this docs pass, not carried from memory):** 16
rows total. `estimate_number` 1414 (v1+v2), 1416, 1417 (v1+v2), 1418, 1419 (v1+v2), 1420, 1421,
1422, 1423, 1424 (v1+v2), 1425 (v1+v2) — every row `job_name` labeled `TEST` / `TEST — void, do not
use` variants, every row's final status is `declined` or `superseded`. **First real estimate will be
≥ 1426.** `ghl_push_state` has **10 rows** (T12's E2E + fix-round pushes — the table is genuinely
written now, not just schema). `sync_log` has **24 rows** with `direction='app_to_ghl'`.
`estimate_mutations_audit` has **27 rows**.

**Defects found and fixed this segment (beyond the ones named above):**
- GHL estimate-doc listing (`listEstimateDocs`) defaulted to GHL's own `limit=10` — a contact with
  more than 10 historical docs could have its live draft missed by the push logic, which would then
  create a duplicate instead of updating in place (or, worse, `PUT` a stale doc id). Fixed to
  auto-paginate at `AUTO_PAGE_SIZE=100` when no explicit limit is given; live-verified GHL honors
  `limit=100` (100 of 511 docs returned per page; auto-pagination sweeps the rest).
- `/estimates/new` going static post-auth-removal (named above under T11).
- The override-reason-textarea-unmounts-mid-typing and spurious-`notFound()`-on-refresh bugs (named
  above under T11b) — both **live-caught through real browser interaction**, not unit tests; the SDD
  session's live-smoke discipline is what surfaced them.

**Known limitations — recorded here because they are invisible from reading any single file, per
the final review's explicit flag (not fixed this session, accepted as low-risk at 3 internal
users):**
1. **Superseded-version protection is UI-only.** The detail page hides status/push controls once a
   version is superseded, but `updateStatusAction` and `pushEstimateAction` do not themselves
   re-check version status — a stale browser tab left open from before a `revise` can still mutate
   or push the superseded row. Partially self-healing (re-pushing the current version overwrites
   the GHL side) but not a status fix — the UI only offers sent/accepted/declined, so restoring a
   wrongly-set superseded marker needs a direct RPC/SQL call, not a click anywhere in the app; a
   server-side defense-in-depth check is deferred.
2. **No concurrency guard on the GHL push.** Two simultaneous first-pushes of the same estimate can
   race `search-before-create` and create duplicate GHL opportunities — `ghl_push_state` has no
   arbitrating constraint. Low likelihood; recovery is deleting the duplicate opportunity in GHL.
3. **The no-login deployment ships network-layer open.** Anyone with the URL can create/mutate/push
   estimates. Deliberately deferred, not solved, by this session — see CLAUDE.md.

**Repo-level open items surfaced this session, out of slice-2's own scope, needing their own future
task:**
- **`airtable-client-sync` v19's `searchGhlByEmail()` is the same broken shape T9f fixed in the web
  app** — `GET /contacts/?email=` now 422s live, and the function never checks `res.ok` before
  `res.json()`, so its search leg is silently dead; the function only survives because GHL's
  duplicate-contact 400 exposes `meta.contactId` as a fallback match. Confirmed by reading the live
  deployed source this docs pass. Needs its own edge-function fix task — same repair T9f applied
  (`POST /contacts/search`, `eq` filter).
- **`crew-night-before` redeploy still owed** — carried from T5's CV-1 mitigation: T5 proved
  `supabase/functions/_shared/package.json {"type":"module"}` is deploy-inert for the two live
  consumers (`ghl-job-webhook`, `crew-night-before`) via static analysis (absent from the Deno
  module graph) and `deno check`, but neither function has actually been **redeployed** since that
  file was added. A real redeploy (not just a check) closes the question permanently; low urgency
  since the static proof is solid, but it's the difference between "proven" and "proven and shipped."
- **6 pre-existing clock-in-era `SECURITY DEFINER` functions callable by `anon`** (e.g.
  `get_my_role`) — flagged during T3's review as unrelated to slice 2 but real; worth re-weighing
  now that the estimate tool itself ships network-open (the security posture of the whole
  environment, not just this feature, deserves a fresh look).

**Deferred minors (non-blocking, not addressed this session — full itemized list, task-by-task, is
in the SDD ledger `progress.md`; the ones with practical follow-up weight):**
- `quotedPrice`/negative-entry inputs clamp silently in the builder UI rather than showing a hint.
- Decimal-comma mis-parse (`"0,25"` → `25`) — theoretical for a US-locale team, not exercised live.
- `revise`-mode prop pairing between the builder and its preload path is not structurally enforced
  by the type system (M-3, final review) — works correctly today, worth a type-level tightening.
- A duplicated `scope_library` loader and a dead `isLifecycleActionStatus` export (M-4, final
  review) — harmless, cheap cleanup whenever someone is next in that file.
- `crypto.randomUUID` throws on non-secure origins (breaks LAN-IP phone QA over plain HTTP; fine
  once Vercel gives it HTTPS).
- Several accessibility nits (unassociated labels, missing `aria-pressed` on the chip, dialog
  semantics on the scope-picker sheet).

**Manual setup status — Manual Setup #1 (env vars) DONE mid-session (Matt); Manual Setup #2
(auth users) CANCELLED (see no-login change above), not owed anymore.**

**Deploy status:** Vercel deploy: [CONTROLLER TO FILL POST-DEPLOY]

**Next session:** merge-to-main is Matt's decision, informed by the final review's APPROVED verdict
above. If merging: standard PR/merge flow, no additional gate. After that (or in parallel): Phase C
(BILL expenses + dump counts), Track B (lead intake), or the BL-4 crew Slack format item deferred
from this slice's brief. See `NEXT_SESSION_PROMPT.md` (regenerated this session) for the full
picture.

### 2026-08-14 (evening) — Phase B slice-2 IN PROGRESS: 10/14 tasks done on branch `phase-b-slice-2` (paused mid-build)

**Status:** 🟡 In progress, paused for session close. Branch `phase-b-slice-2` (tip `123b74a`), **16 commits, NOT merged to main.** Tasks T1–T10 complete + reviewed + merged onto the branch; **T11, T11b, T12, T13 remain.** Executed subagent-driven (sonnet implements / opus reviews per task + fix loops) under a **hybrid-lane concurrency model Matt approved** — a DB migration lane and a web lane ran concurrently via isolated git worktrees, each task merged back after its own review passed. SDD ledger + all task briefs/reports live under `.superpowers/sdd/2026-08-14-phase-b-slice-2-estimate-builder-ghl-push/` (gitignored) — read `progress.md` there first next session.

**What shipped this session (all on the branch, all reviewed):**

*DB lane — 3 new migrations, all APPLIED LIVE to `eiqqqwajmcpcwhvxxnhx` and committed (parity holds):*
- `20260814200000_phase_b2_estimator_columns.sql` — adds `estimates.created_by uuid → auth.users`, `created_by_name text` (both **immutable**, added to the `enforce_estimate_immutability` guard list; mutable set unchanged: status/quoted_price/quote_override_reason/job_number).
- `20260814210000_phase_b2_rpcs_audit.sql` + `20260814215000_phase_b2_rpcs_fixups.sql` — the estimate **write RPCs** (`create_estimate_with_items`, `update_estimate_status`, `update_estimate_quote`, `update_estimate_job_number`) + `estimate_mutations_audit` table & AFTER-UPDATE trigger. All RPCs service-role-only (revoked from public/anon/authenticated), `search_path=public`, take `p_actor`/`p_actor_name` for the audit trail. The create RPC is one transaction (writer contract: v1 omits estimate_number→sequence, vN passes parent's number + supersedes_estimate_id, flips parent to superseded). Fixups added: insert-path override-reason CHECK (`quote_override_reason_required`), `nullif('')` cast hardening, quote-clearing allowed, 2dp rounding, audit-table immutability guard, and actor-on-supersede.
- `20260814220000_phase_b2_ghl_push_state.sql` — `ghl_push_state` table (PK estimate_id → estimates; contact/opp/estimate-doc ids, per-target timestamps, last_error, attempts; mutable, app sets updated_at) + widened `sync_log_direction_check` with `app_to_ghl`.
- **Test estimate rows** (permanent — estimates are undeletable): `estimate_number 1414` (v1+v2, both `job_name='TEST — void, do not use'`, left `declined`) from the T3 verification. `1415` **burned** by the T3-fixups negative-CHECK test (nextval non-transactional). Numbers 1400–1413 burned earlier by dev rollbacks. **First real estimate will be ≥ 1416.**

*Web lane — first Next.js app code, in `web/` (own package.json; legacy root untouched):*
- **T5 scaffold** — Next 16.3 App Router + Tailwind 4 + vitest 4; imports the golden-tested `_shared/pricing.ts` via a re-export shim `web/src/lib/pricing.ts` (never forked). Needed `supabase/functions/_shared/package.json {"type":"module"}` for Turbopack ESM resolution (proven deploy-inert — absent from the Deno module graph).
- **T6 auth** — Supabase Auth (email/password, 3 users, no self-signup), `@supabase/ssr` middleware, `requireUser()`, service-role `admin.ts` (`import "server-only"`), gated `(app)` group. **Open-redirect hardening took 3 fix rounds** (protocol-relative, control-char, and normalized-output re-entrancy bypasses each found+closed; final `safeNext` uses `new URL()` origin re-resolution, fuzzed 71k cases 0 violations).
- **T7 rates loader** — `web/src/lib/rates.ts` `loadRatesConfig()` reads all 6 `pricing_variables` live via service role; throws on any missing key (**never** falls back to DEFAULT_RATES). Exported `requireRates` from pricing.ts (one word; golden gate held 18/18).
- **T9 GHL client** — `web/src/lib/ghl/client.ts` (contacts/opportunities/pipelines/custom-field-defs/estimate-list + retry-once ghlFetch). **Live scope smoke = GO: the existing `GHL_API_KEY` already has estimate scopes** (HTTP 200, 510 docs) — no token rotation needed.
- **T10 estimate-doc builder** — `web/src/lib/ghl/estimateDoc.ts`: builds the customer-facing GHL draft estimate. **Live-validated 3 payload corrections** the OpenAPI spec got wrong (`name`≤40 chars, line items need `type:"one_time"`, `frequencySettings.schedule` must be `null`). Allocation uses **largest-remainder (Hamilton)** so line amounts sum to the quoted price exactly AND are never negative. ⚠️ **GHL stores `meta` keys CAMELCASED** (`lbdEstimateId`) — read-back must use camelCase (T12 must honor).
- **T8 data layer** — `web/src/lib/estimates/{types,validate,map,repo}.ts` + `app/(app)/estimates/actions.ts`. Pure validate (zod; itemized reconciliation; **rejects negative inputs** the DB doesn't constrain) + map (writer contract) + repo (the 7 operations via RPCs, service-role, numeric-as-string normalization at every boundary) + server actions (each calls `requireUser()` itself). Added `zod ^4.4.3` as an explicit web dep.

**Gates at pause:** web vitest **139/139**, `deno task test` **18/18** (golden 321 intact), `npm run build` green with env supplied. `pricing.ts` engine only changed by the one-word `export` — no quoted price moved.

**Defects found but deferred to next session (from reviews, none blocking the merge):**
- `listEstimates` `q` param is PostgREST-filter-injectable (`repo.ts` ~1116) — **sanitize `,()` before T11b wires the list page** (low risk: 3 trusted users, read-only, service-role, same table).
- `quotedPrice` not non-negative-guarded (`validate.ts:69`) — a negative override → negative GHL amount in T12; add `nonNegativeNumber`.
- `updateStatus` accepts any of the 6 statuses with no transition rules — T11b UI must only offer sent/accepted/declined.
- `createNewVersion` on a stale (already-superseded) parent fails with a raw unique-violation string — T11b should add a friendly "newer version exists" check.
- T6 minor: middleware matcher exempts `*.png`-suffixed routes at any depth (inert today).
- T1 doc minors (fold into T13 doc pass): CLAUDE.md prose polish around the test command; `deno.json` absent from the repo-structure tree.

**Manual setup still owed by Matt (carried; none blocked this session's work):**
1. **`web/.env.local`** must be hand-created before local `npm run dev`/build (the M5 env-guard throws without it — by design). Needs `NEXT_PUBLIC_SUPABASE_URL=https://eiqqqwajmcpcwhvxxnhx.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ZmXLIhozN3vMWf-8e13hQQ_59AkdjnY`, and the **service-role key** (server-only). The permission layer blocked agents from writing it.
2. **Provision the 3 auth users** (Dane/Jackson/Matt) in the Supabase dashboard with `display_name` metadata, then disable public signups. Only 1 pre-existing account exists today. Record their emails in CLAUDE.md once created. **(CANCELLED — see the 2026-08-14 (night) entry above; the no-login scope change replaced this with a picker, no auth users needed.)**
3. GHL estimate scopes: **already present** — no action needed (smoke test confirmed).

**Repo-hygiene note for future migration work:** migration **filenames** carry 14-digit timestamps but the live `schema_migrations` **version** stamps differ (MCP `apply_migration` uses its own wall-clock) — repo-wide, pre-existing. Consequence: a `supabase db push` from the repo would see these as unapplied and re-run `create table` (fails). Don't "fix" by renaming applied files; document only.

**Next session — resume at T11 + T12 (both unblocked, can run in parallel):** T11 = the mobile-first estimate builder page (live recalc via client-side `computeEstimate`, scope picker, quick/itemized modes, Path B toggle) with a first-real-create live smoke test; T12 = push orchestration (`pushEstimateToGhl`, per-target idempotent via `ghl_push_state`, honoring the meta-camelCase read + search-before-create idempotency the reviews flagged). Then T11b (list+detail+lifecycle), then T13 (Vercel deploy + docs + BUILD_LOG close + optionally merge to main). Briefs are staged in the SDD workspace dir.

### 2026-08-14 — Phase B slice-1 COMPLETE: golden master, seeds, full verification (Tasks 2, 4, 5)

**Status:** 🟢 Complete · **MERGED TO MAIN AND PUSHED same day** (`0196449..7920a9c`, 10 commits;
branch `phase-b-slice-1` deleted local + remote; tests re-run green on the merged result) · No new
edge function deployed this slice — schema + engine only.

**Addendum — final whole-branch review fix wave (same day).** Ran the final whole-branch review
and shipped its fix wave: migration `phase_b_estimates_fixups2` (applied live) widens
`estimates.dump_count`, `estimate_line_items.dump_count`, and `scope_library.default_dump_count`
from `numeric(5,1)` to `numeric(6,2)` — the golden fixture carries real dump counts of 0.25, 0.35,
and 1.25 loads (estimates 1236, 1131, 1295, 1296) that `numeric(5,1)` would have silently rounded
and re-priced — and adds a `version_chain` check constraint on `estimates` (`version = 1 or
supersedes_estimate_id is not null`). Also renamed the two colliding 8-digit-prefix migration
files (`20260814_phase_b_estimates_schema.sql`, `20260814_phase_b_seeds.sql`, both of which parsed
to the same version number and byte-sorted out of intended order) to unique ordered 14-digit
prefixes — pure renames, content unchanged; live migration history is unaffected since filenames
are documentation only. Deferred follow-ups for next session, in priority order: (1) a
`deno.json` test task so the golden-master gate runs in CI, not just by hand; (2) a
`pricing_variables` loader so `_shared/pricing.ts` reads live rates instead of the `DEFAULT_RATES`
snapshot; (3) an audit trail for the four estimate columns immutability still allows to mutate
(`status`, `quoted_price`, `quote_override_reason`, `job_number`).

Closes out the mid-flight state left by the entry directly below. Tasks 1 and 3 (engine, schema)
were already shipped and reviewed; this entry covers Tasks 2, 4, and the Task 5 close-out pass.

- **Task 2 `41e15dc` — golden master.** `pricing_golden_test.ts` +
  `fixtures/estimates-golden-321.json`: all 321 live Airtable estimates reproduce to the cent —
  309 exact, 11 legacy-diff (two-sided pinned deltas against the known 2026-03-19 hand-keyed
  backfill), 1 penny-tolerance (est 1075) — **under the Task-1-review's corrected half-up
  rounding**, proving the rounding fix moved no quoted price. Full `_shared` suite 18/18.
- **Task 4 `093773c` — seeds.** Migration `20260814_phase_b_seeds.sql` applied live: 19
  `scope_library` rows (with `airtable_record_id` provenance) and 6 `pricing_variables`
  (`labor_rate_per_hour` 26, `overhead_rate_per_hour` 23, `dump_rate_per_load` 300, `cc_fee_rate`
  0.0350, `default_markup_pct` 25, `markup_floor_pct` 15 — the corrected 3.5% CC fee, not the
  stale Airtable 3% row). `default_materials_cost` left NULL for Phase G.
- **Task 5 (this session) — full verification + docs.** All green, no regressions found:
  - `deno test --allow-all supabase/functions/_shared/` → **18/18 passed** (4 `job_test.ts` + 2
    `pricing_golden_test.ts`, incl. the `exact = 309` count assertion, + 12 `pricing_test.ts`).
  - `deno check` on `pricing.ts`, `pricing_test.ts`, `pricing_golden_test.ts` → clean.
  - `get_advisors` (security + performance, project `eiqqqwajmcpcwhvxxnhx`): no new criticals
    attributable to the four new tables. Only `rls_enabled_no_policy` (INFO, accepted house
    posture) and two `unindexed_foreign_keys` INFO notices
    (`estimate_line_items_scope_library_id_fkey`, `estimates_supersedes_estimate_id_fkey`) —
    informational, not blocking. Confirmed `enforce_estimate_immutability` does **not** appear in
    the `function_search_path_mutable` warning list — the Task 3 review's `search_path = public`
    pin is holding live.
  - Live DB: `estimates`, `estimate_line_items`, `scope_library`, `pricing_variables` all RLS
    enabled, 0 policies. `scope_library` = 19 rows, `pricing_variables` = 6 rows,
    `cc_fee_rate = 0.0350`. Ran a live trigger test inside an explicit `BEGIN…ROLLBACK` (so no
    permanent row was left): inserted one draft estimate, confirmed an UPDATE to `total_bid`
    (a computed column) raised `estimates are immutable — write a new version row instead`, then
    confirmed an UPDATE to `status` succeeded — both as designed — then rolled back. `estimates`
    row count confirmed back to 0 after. Side effect: `estimate_number_seq` advanced to **1410**
    from the test insert (sequences don't roll back) — harmless per the existing documented
    behavior, just means the first real estimate will now be ≥1411, not ≥1402.
  - `list_migrations` shows `phase_b_estimates_schema`, `phase_b_estimates_fixups`, and
    `phase_b_seeds` all applied; all three SQL files are committed in this branch (parity rule
    holds).
  - `CLAUDE.md` updated: Supabase Tables section gained rows for the four new tables (immutability
    rule stated for `estimates`/`estimate_line_items`, DELETE-blocked noted); Edge Functions
    section gained a paragraph on `_shared/pricing.ts` (not yet wired into any deployed function —
    that's the next Phase B slice).

**Deferred, recorded so nothing is lost (per the Task 5 brief):** historical import of the 321
Airtable estimates as `status='historical'` rows (numbers 1001–1321, needs a fuller Airtable pull
for client fields not in the golden fixture); the estimate builder UI (first Next.js/Vercel app
code) and GHL push (line items + headline numbers) — the next two Phase B plans; reading rates
from `pricing_variables` at runtime instead of the code-level `DEFAULT_RATES` snapshot; leaving the
Airtable `Pricing Variables` 3% row uncorrected (read by nothing, parallel-running rule).

**What the next session needs:** Phase B slice-1 is **merged to `main` and pushed to GitHub**
(Matt chose local merge; branch deleted local + remote; stale `origin/phase-b-slice-1` removed).
Next step is **Phase B slice 2: estimate builder UI (first Next.js/Vercel app code) + GHL push**,
with the deno.json test task for the golden gate as the first follow-up. No open defects. No new
edge function to deploy. The 4 test calendar events (JOB-1102 Aug 17, JOB-1104 Aug 20, main +
Crew 1 each) were deleted by Matt at session close — that cleanup item is closed.

### 2026-08-14 — Phase A verification CLOSED, ghl-contact-sync fixed, Phase B slice-1 planned + 2/5 tasks built

**Session shape:** three approved goals run in parallel lanes — harden what's live, verify
workflow 2, plan Phase B — then Phase B execution began (subagent-driven) and was deliberately
closed mid-flight at Matt's request. Branch **`phase-b-slice-1`** carries the in-progress work.

**1. `ghl-contact-sync` tags crash — FIXED and live-verified (commit `65cae85`, deployed as
version counter 27).** GHL workflow webhooks send `tags` as a comma-separated *string*; `tags.map()`
threw OUTSIDE the try block, so the function 500'd with **no `sync_log` row** — invisible. Fix:
normalize tags (array/string/other), move payload extraction inside the try. Adversarial review
verdict SHIP with a bigger finding: **all 590 logged payloads carried string tags (empty until
2026-08-13), so contacts with tags had NEVER synced client type through this function.** Damage
window: 5 crashes 2026-08-13 21:53–22:44 UTC (backoff pattern, likely one event). Live-verified
same session: Matt edited Test Client's phone → 3 `contact_updated` webhooks with
`tags:"contractor"` → all succeeded. Deploy-version counters on other functions bumped
cosmetically (known CLI behavior).

**2. Workflow 2 (job_scheduled) — VERIFIED through the real GHL workflow. Phase A verification
is now COMPLETE.** Matt created a test opportunity, set Crew 1 + start 2026-08-20, dragged
Quote Accepted → minted **JOB-1104**; dragged Job Scheduled → both calendars + Slack (to
`#ops-test` `C0BPPG8997Z` via temporarily repointed `SLACK_CREW1_CHANNEL`, restored after,
digest-confirmed) + BILL skipped by design. **Epoch-ms date risk resolved: GHL DATE custom fields
arrive ISO-parseable through the real workflow.** Re-drag proved idempotency AND that GHL allows
workflow re-entry (matters for reschedules). Bonus: Matt's first attempt hit Job Scheduled before
Quote Accepted and the loud no-job-record error guard fired exactly as designed. JOB-1104
cancelled at session end. **Manual cleanup still owed: 4 test calendar events** (JOB-1102 Aug 17
×2, JOB-1104 Aug 20 ×2, main + Crew 1 calendars — Matt's connected Google account can't delete
them; reader-only on a non-jobs calendar).

**3. Phase B research + plan (commit `0196449`).** Live Airtable pull: **321 estimates** (not
296). **All 265 live-Fillout records match the DISCOVERY §1 chain to the cent at 3.5% CC; 0/321
match at 3% — the 3% Pricing Variables row was NEVER live.** 12 revenue mismatches: 11 from the
2026-03-19 hand-keyed bulk backfill + 1 penny artifact (est 1075). Estimates have NO linked
records and NO line items; days×employees method used 1/321 times; dump counts can be fractional
(0.5); Dane's manual discounts exist only in prose (est 1108: $41,038 calc → $39,000 quoted).
Research: `docs/superpowers/plans/2026-08-14-phase-b-estimates-research.md`. Plan (approved by
Matt, engine+schema slice): `docs/superpowers/plans/2026-08-14-phase-b-pricing-engine-and-schema.md`.
Golden fixture committed: `supabase/functions/_shared/fixtures/estimates-golden-321.json`.
**BL-4 added to BUILD_PLAN.md**: Matt's crew-Slack message format, scheduled for end of Phase B.

**4. Phase B slice-1 execution STARTED (subagent-driven, branch `phase-b-slice-1`) — closed
mid-flight.** Tasks 1+3 ran as concurrent lanes (disjoint files, Matt's directive):
- Task 1 `cd39fca`: `_shared/pricing.ts` + tests — engine ported, 9/9 tests, deno check clean.
- Task 3 `e6ec4df`: `supabase/migrations/20260814_phase_b_estimates_schema.sql` — **APPLIED TO
  LIVE** (`phase_b_estimates_schema`) and live-verified: `estimates` (immutable via trigger,
  seq starts 1400), `estimate_line_items`, `scope_library`, `pricing_variables`; RLS on, 0
  policies. Repo file == applied SQL (parity holds).
- ⚠️ **Neither task has had its Opus review yet.** Tasks 2 (golden master), 4 (seeds), 5
  (verification/docs) not started; briefs staged. Resume state + rulings (concurrency, live-apply
  pre-merge, models) in `.superpowers/sdd/2026-08-14-phase-b-pricing-engine-and-schema/progress.md`
  — **read that ledger before touching Phase B.**

**Defects found, not fixed:** none new. Standing: `receive-airtable-webhook` retirement queued;
`push-to-airtable` latent bug; `airtable-job-created` v21 GHL-UI verification (moot-adjacent).

### 2026-08-13 — Phase A build: job record keystone SHIPPED — GHL→Postgres→Calendar/Slack live
**Status:** 🟢 Complete · **Deploys:** `ghl-job-webhook` (new, v7 after fix wave) · `crew-night-before` (new, v4) ·
4 migrations applied · branch `phase-a-job-record`

Built via subagent-driven development: sonnet implementers, opus adversarial reviewers, Matt
checkpointing after Task 1 (migration apply), after Task 4 (before real crew channels), and at
Task 6 (GHL workflow wiring). Full session ledger:
`docs/superpowers/plans/2026-08-13-phase-a-job-record-ledger.md`.

#### What shipped

- **`ghl-job-webhook`** (new function, v7) — one webhook, two events. `quote_accepted` mints a
  canonical `JOB-XXXX` job record in Postgres from a GHL opportunity (name format
  `JOB-XXXX – Client – City`, client name/type from the GHL contact, city parsed from the job
  address). `job_scheduled` fires the schedule leg: Google Calendar (main + crew), Slack crew
  notification, and a gated BILL job-code leg (no-ops — `BILL_API_TOKEN` isn't set anywhere).
  Accepts the request body either top-level (`{event, opportunityId}`, curl/Custom Webhook shape)
  or nested under `customData` (GHL's "Webhook" workflow action shape) — both parsed by the same
  `parseWebhookBody`.
- **`crew-night-before`** (new function, v4) — nightly per-crew Slack digest of tomorrow's jobs.
  Fires via `pg_cron` at both 22:30 and 23:30 UTC; the function self-gates on America/Denver local
  hour (`Intl.DateTimeFormat`) so exactly one of the two daily fires actually sends, with no DST
  seasonal cron edits required.
- **4 migrations** (`supabase/migrations/2026081300000*`): `phase_a_jobs_keystone` (canonical
  `jobs` reshape, `JOB-XXXX` sequence starting at 1100, `job_lifecycle` enum, RLS), `..._fixups`
  (Task 1 review fixes), `schedule_crew_night_before` (pg_cron + pg_net, twice-daily UTC), and
  `phase_a_audit_write_fixups` (sync_log/job_events constraint widening — found live, see below).
- **`supabase/functions/_shared/`** (new) — first shared module in the codebase: job-name/city
  parsing (`job.ts`, unit-tested), Google Calendar auth lifted out of `airtable-job-scheduled`
  (`google.ts`, transitional duplication — old function untouched, cleanup deferred to Phase-B
  era), and `sync_log`/`job_events` writers that now check and log `supabase-js` errors instead of
  swallowing them (`log.ts`).
- **98 tests** on `ghl-job-webhook`, **41** on `crew-night-before` — both `deno check` clean.

#### Live E2E results

JOB-1102 minted from a **real GHL opportunity** (`OQzr5dwMbqpuOBKf5xsD`) via Matt dragging it to
Quote Accepted in the GHL UI — not a curl test. Opportunity card visually confirmed renamed
"JOB-1102 – Contractor Company" in GHL (Matt's screenshot). Schedule-leg drag drove both
calendars and a Slack post to `#ops-test` — exact message shape confirmed, address emoji correctly
omitted when the field is null. Idempotency proven: re-firing the create webhook against the same
opportunity returned `skipped`/same job number, and the GHL write-back PUT self-heals on re-fire.
One production defect surfaced and fixed mid-session: GHL's "Webhook" workflow action nests the
payload under a `customData` key rather than sending it top-level — the first real workflow drag
400'd; fixed to accept both shapes (commit `402b6b0`), redeployed, re-verified.

**`crew-night-before`'s digest Slack leg was live-verified separately, after this entry's original
docs commit.** The controller created a synthetic scheduled job (JOB-1103, Crew 1, start
2026-08-14), then force-fired the function: it posted the "⏰ Tomorrow:" digest to `#ops-test`,
stamped `night_before_sent_on`, and an idempotent re-fire correctly returned "no jobs". The
synthetic row was then deleted and the Crew 1 Slack secret restored to the real channel.

#### Defects found and fixed pre-production (adversarial review loop)

- **Enum collision** — the plan's migration would have silently bound `status_v2` to the
  *existing* `job_status` enum (`{active,archived}`, from the legacy schema) instead of a new one;
  inserts of `'accepted'` would have failed at runtime. Renamed the new type `job_lifecycle`.
- **NOT NULL trap** — `jobs.airtable_job_id` was `NOT NULL` with no default; every canonical
  (non-Airtable) insert would have hit `23502`. Relaxed in the fixups migration.
- **23505 misattribution** — the create path couldn't distinguish a `job_number` sequence
  collision from a genuine `ghl_opportunity_id` race, risking a silent 200/skipped/success with no
  row actually written. Fixed with race-path tests that exercise the divergence.
- **Silent log-write failures** — `supabase-js` returns `{error}` rather than throwing; the
  original `sync_log`/`job_events` writers never checked it. Fixed to check and `console.error`.
- **Per-event-ID calendar resumability** — the schedule leg wasn't resumable per event ID; a
  partial failure (main calendar written, crew calendar not) could duplicate crew events or mask
  configuration errors as success on re-fire. Fixed with per-leg idempotency and tests for both
  directions.
- **`sync_log.direction` check constraint** — found live, not in review: the constraint allowed
  only the two legacy Airtable directions (`ghl_to_airtable`, `airtable_to_ghl`); Phase A's new
  directions (`ghl_to_supabase`, `supabase_to_slack`) were rejected with a 400 on every write.
  Widened via `phase_a_audit_write_fixups`.
- **`job_events.job_id` NOT NULL** — also found live: the legacy column (holds Airtable `recXXX`
  IDs) is `NOT NULL`, but Phase A code intentionally writes `job_number` only, omitting it.
  Dropped the constraint in the same fixups migration. Both audit-write defects were invisible to
  mocks — only Matt's live probe with a real secret and a bogus opportunity ID caught them; the
  error path is now fully live-verified (500 response + both `sync_log` and `job_events` rows
  landing).

#### Defects found, not fixed

- **`ghl-contact-sync` v20 — live `TypeError: tags.map is not a function`.** Unlogged, on real
  traffic at 22:24 during this session. Pre-existing deployed function, **not** Phase A code —
  needs its own small fix in a future session.
- **PII in debug logs** — the `[ghl]` contact-fetch console log and the create-path logs carry
  contact PII. Kept deliberately until Phase A's live payload shapes are fully confirmed; trim
  once they are.

#### Decisions/rulings that matter forward

- **Night-before digest is single-send, no same-day retry.** A missed digest is now *visible* as
  a `sync_log` error (previously invisible) but not auto-resent — the calendar event is the
  primary signal; retry machinery was judged too baroque for a convenience layer.
- **Reschedules ship as visibility, not automation.** When crew/dates change after the schedule
  legs are already stamped, the function updates the DB and logs a `reschedule_detected` event
  with old→new values but does not move calendar events or re-notify. Full auto-reschedule is a
  surfaced backlog item for Matt; reschedules are hand-managed today anyway.
- **BILL leg ships gated off.** `BILL_API_TOKEN` is absent in every environment by design — no
  BILL credentials exist yet. The leg no-ops cleanly; Phase C turns it on once Matt supplies
  credentials.
- **Legacy function version counters may read higher than documented** — the Supabase CLI's
  deploy tooling bumps version numbers on unrelated already-deployed functions as a side effect;
  their `sha256` is unchanged, so this is cosmetic, not a redeploy.

#### What next session needs to know

- **JOB-1102 needs a cancel-or-keep decision from Matt before 2026-08-16** — the night-before
  digest will fire to the real Crew 1 Slack channel for it otherwise.
- **Workflow 2 (job_scheduled) drag is still pending** — Task 6's create-path drag was verified
  live; the schedule-path drag through the actual GHL workflow (vs. the earlier direct-curl
  schedule-leg test) has not been done.
- **BILL credentials** — supply if the BILL leg should go live in Phase A; otherwise it stays
  gated until Phase C.
- **Fillout/estimate side is untouched.** Phase B (estimate builder) is next.
- **`receive-airtable-webhook` retirement is still queued**, unrelated to this build — disable
  Airtable automations `wflYoupCQ00h2BrVa`/`wfldrRGvkSgRsE3ok` first, then remove the function.

Commits: `5c52c8b`, `7fca329`, `55c17f6`, `0b8f5b2`, `358cf8a`, `b6f0f27`, `9fa8770`, `bd7aca7`,
`79b479d`, `0f3c6a9`, `f63be73`, `4942552`, `402b6b0` (branch `phase-a-job-record`, not yet merged
to `main`).

---

### 2026-08-13 — Status review; Aug-11 sync error burst analyzed; Phase A decisions taken
**Status:** 🟢 Complete · **Deploys:** none (review + planning only)

Live verification 13 days after the discovery session: repo clean and synced, function versions
unchanged (19/20/21/16/14/11/11). `sync_log` 668 → **918** rows, daily traffic. Estimates
296 → **321** (~2/business day). Jobs still **9** — zero job records created in ~12 weeks. All
actuals tables still 0 rows. The 321-estimates-to-9-jobs gap is the Phase A problem, measured.

**New defect, self-healed — CLAUDE.md's "no errors since May 2" is stale.** 14 sync errors on
2026-08-11 18:29:36 ("Airtable create returned no record ID") during a 156-record burst day
(~8/day is normal). All 14 contacts recovered within 5 minutes and have both Airtable and GHL IDs —
no data loss. Likely Airtable rate-limiting under bulk load, rescued by GHL webhook redelivery.
`airtable-client-sync` has no explicit retry/backoff; a larger bulk import could drop records less
gracefully. CLAUDE.md line corrected this session.

**Phase A decisions (Matt, 2026-08-13):**
- **Trigger = GHL stage move.** Opportunity → "Quote Accepted" mints the job record. Path B jobs
  must also get an opportunity staged in GHL — behavioral, restate to Dane.
- **Job name = `JOB-XXXX – Client – City`** (company name for businesses, else last name).

Phase A implementation plan written and approved; build follows in next entry.

---

### 2026-07-31 — Three backlog items captured from Dane meeting (equipment, tools, crew P&L)
**Status:** 🟢 Complete · **Deploys:** none · **Documentation only — nothing live was touched**

Matt relayed three asks from a meeting with Dane the same day. All three were explicitly framed as
"not now" — they are recorded as backlog, **not** folded into the A–G critical path.

New section in `BUILD_PLAN.md`: **"Backlog — captured, not scheduled"**, placed after Track B.

- **BL-1 — Equipment maintenance tracking.** Service/repair per unit. Today it disappears into
  ~$572k/yr of BILL card spend with no equipment dimension. Reserve an `equipment` table and
  `expenses.equipment_id` in the initial schema; capture on the foreman completion checklist.
- **BL-2 — Tool inventory.** What exists, which crew has it, what is lost/replaced. Reserve
  `tools` + a `tool_assignments` ledger keyed to `crew_id` (per-crew, not per-employee). Scope to
  exceptions only — a full per-job tool enumeration will not get done.
- **BL-3 — Crew-level P&L + foreman incentive comp.** Each crew as a business unit, foreman cost
  allocated to the crew, bonus on financial performance.

**The one thing a future session must not miss:** BL-3 carries a real hazard, flagged inline in the
plan. Because the dump pad (+$221k/yr) and the labor shortfall (−$246k/yr) cancel, **absolute crew
margin moves with how a job was priced, not how well the crew ran it** — dump-heavy jobs carry the
pad, labor-heavy jobs carry the shortfall. Bonusing on absolute margin would pay foremen for the
estimator's job mix and incentivise them toward dump-heavy work. The defensible basis is **variance
against the accepted estimate** (hours vs. estimated hours, loads vs. estimated loads) plus a
quality gate. Do not attach dollars until the distortion is corrected or explicitly neutralised.

Dependency note: BL-3 is mostly a reporting increment on Phase F — crew is already a first-class
dimension (`crews`, per-crew calendars, per-crew Slack channels, `Crew 1–4` on the job). The new
work is *allocating non-job-level costs* (foreman salary, equipment, tools, overhead share), and
the allocation basis is an unmade decision. BL-3 also depends on **Phase D, which is still
blocking** — no per-crew hours means no labor actual means no crew P&L.

Also added a Backlog row to the `CLAUDE.md` phase roadmap table so it is visible from the entry
point. No open decision changed; the Phase D blocker is unaffected.

---

### 2026-07-31 — Business discovery + financial analysis; BUILD_PLAN amended to A–G; four pads found
**Status:** 🟢 Complete · **Deploys:** none · **Nothing live was touched**

Discovery session, no code. Matt supplied a workflow overview, answered 45 discovery questions in a
Google Doc, and exported four datasets: Stripe payments, BILL card transactions, Gusto payroll, and
the GHL invoice list. All analysis is read-only and reproducible from those files.

**New file `DISCOVERY_2026-07-31.md` is now the business ground truth.** It supersedes
`SYSTEM_AUDIT_2026-07-30.md` wherever they conflict.

#### The finding that matters most
A deliberate dump-fee pad (**+$221k/yr**) has been almost exactly financing a labor estimating
shortfall (**−$246k/yr**). Every individual number in the pricing engine is wrong; they cancel to
roughly +$31k. **This is why nobody ever noticed any of them**, and it is why no pricing input may
be corrected in isolation — fixing the dump rate alone would strip the buffer covering a
quarter-million-dollar annual gap.

Measured scale (annualized): ~$1,315k invoiced / ~$1,169k paid · field payroll ~$619k · BILL card
spend ~$572k · ~712 dump loads at a **$65 median cost** against a ~$388 effective charge.

#### Repo documentation was wrong in five places — all corrected
- **`CLAUDE.md`'s labor benchmark was backwards.** It claimed true all-in labor is $27–29/hr and
  that profit is "structurally overstated." Real payroll says **$23.13/hr** — the $26 standard is
  $2.87 *above* cost and profit is *understated*. (Caveat: excludes workers' comp; ~$25.30 with it.)
- **`CLAUDE.md`'s margin-divisor rule was never implemented.** The live calculator is cost-plus
  markup, so an entered 25% realises 19.3% and the "15% floor" is really 12.6%. Cost-plus is
  *intentional* — a labeling problem, not a pricing bug.
- **`SYSTEM_AUDIT` §2 describes `Jobs (old)`, not the live base.** The five pricing defaults *are*
  set; `Price Before Fees` doesn't exist; estimate fields are plain currency; and **there is no
  `Dump Fee Buffer` field anywhere.** Phase 2's two blocking decisions were framed around fields
  that don't exist. A correction banner was added to §2.
- **Roles were wrong.** Dane is owner/founder/president; Jackson is sales/estimator.
- **Zapier's role is now confirmed** — it runs **website lead form → Slack**. A live dependency; do
  not retire Zapier blindly. It previously sent the night-before crew message, abandoned as
  unreliable.

#### BUILD_PLAN.md amended — 0–9 retired, replaced by A–G + Track B
Defects found in the old numbering: Phase 1's `default_materials_cost` seeding **is not doable**
(no reference list exists; it's a feedback-loop output); Phase 4's clock-in PWA was premised on
crews not clocking in, but **they do, reliably**; and the "GHL opportunity = the screen Dane and
Jackson use" premise is **false today** — GHL isn't used for pipeline tracking at all.

Decisions **resolved**: CC fee (3.5%, cost line, prices held), Dump Fee Buffer ($300 is a *pricing
rate*, not a cost), `receive-airtable-webhook` (**retire, don't secure** — its only two callers are
Airtable automations `wflYoupCQ00h2BrVa` and `wfldrRGvkSgRsE3ok`, neither of which sends the
header). Lead intake, which no phase owned, is now **Track B**.

#### New blocking decision — Phase D
**Gusto has no project-creation API**; `time_tracking/time_sheets` requires a pre-existing
`job_uuid`. This reverses an earlier recommendation to skip ClockShark, which assumed clock-in
could be cheaply rebuilt. Crews already clock in reliably — the *project* is what's missing. Four
options are in `BUILD_PLAN.md`; nothing in Phase D can be designed until Matt chooses.

#### Defects found, not fixed
- **BILL:** Job Name populated on only **35.5%** of transactions; 14% of spend uncategorised;
  ~$6,944 of dump spend mis-tagged (Local Dumpster $5,273 blank, Pay Fulltilt Dump under
  *Donations*, Round Up Transfer under *Gas*); Little Caesars $4.33 tagged as a dump fee.
- **GHL:** **$61,150 overdue** across 18 invoices; **46 invoices (17%) carry blank status and $0**;
  line-item names are uncontrolled free text ("Interior Demolition" 114 vs. "Interior Demo" 30;
  "Commerical Demo" typo) — **this is why scope-mix data doesn't exist.**
- **83% of invoices have exactly one line item**, so scope detail lives in prose. Per-scope
  attribution must come from the estimate side, not the invoice side.

#### Next session needs to know
- **Phase D is the only blocker.** Everything else is decided.
- Outstanding asks: example GHL estimates + their matching invoices; Fillout calculator export;
  what Blue Collar Haulers and Chew It Up Enterprises actually do (Dane) — $19,664 across 7
  transactions currently distorting per-load dump cost; clarification on client sign-off.
- **The v21 GHL UI verification dropped in priority** — it was justified by the "GHL is the human
  surface" premise, which turns out not to hold today.
- Working plan file (outside the repo): `~/.claude/plans/reactive-knitting-sphinx.md`.

---

### 2026-07-30 — Repo/origin reconciliation; BUILD_PLAN.md made official; build log moved in-repo
**Status:** 🟢 Complete · **Deploys:** none · **Ends at:** `721c5c4` plus this closing docs commit, `main`, pushed

No edge function was deployed, no Supabase change made, nothing live was touched.

Merged four remote commits (`ec3fb44`, `56d8056`, `427543a`, `a976059`) with unpushed local work
(`0dd5103`). One conflict, `airtable-job-created/index.ts`, resolved to the origin side —
whitespace only, and that side matches deployed source byte-for-byte.

- **Verified the recovery was exact.** The two Airtable automation scripts and
  `airtable-client-sync/index.ts`, reconstructed from the live base and deployed Supabase, were
  **byte-identical** to the local originals. Only `SETUP_INSTRUCTIONS.md` was unrecoverable —
  Airtable stores script bodies but not the UI wiring around them — so it was restored from a
  local backup (`d5b0f39`).
- **Folded the local CLAUDE.md edits into the rewrite** (`0166d6a`) rather than reverting to
  either side. Of the old 11-item Open Items list, 3 were still live and kept; 8 were superseded
  or duplicated and dropped.
- **Rescued a calculation-ownership note** (`90e7fc3`) that existed only in the pre-rewrite
  CLAUDE.md: Fillout owns estimate math, Airtable stores estimate outputs as inert plain fields,
  Airtable formulas cover actuals and variance only. Absent from BUILD_PLAN.md and the audit.
- **Designated `BUILD_PLAN.md` the official plan** (`7ab339a`). `OPS_ROADMAP.md` (2026-07-15) is
  superseded and its 0–10 phase numbering retired. Before retiring it, its orphaned decisions were
  copied into a new **"Carried over from OPS_ROADMAP.md — unreconciled"** section of
  `BUILD_PLAN.md`: QuickBooks Online via Synder, the GHL number port + A2P 10DLC, client sign-off,
  callback tracking, Stripe native invoice reminders — none owned by any phase — plus a
  ClockShark-vs-in-house-clock-in conflict. Recorded, not resolved.
- **Closed a correction pending since 2026-05-22** (`6959b67`): Fillout → Airtable is a native
  Fillout integration, not Zapier. Zapier's real role is unverified and is now labeled as such.
- **Added `NEXT_SESSION_PROMPT.md`** — ephemeral copy-paste handoff, regenerated each session.
- **Moved the build log into the repo** (`721c5c4`). All 8 records from the Airtable Pipeline
  Reference `Build Log` table were transferred verbatim into this file, which is now the build
  log. The standing rule was retargeted: append here at the end of **every** session, not only
  after deploys, and commit it with the work it describes. The Airtable table is superseded;
  Field Registry, Secrets & Credentials, and People & IDs remain in Airtable. Note the Airtable
  table itself carries no deprecation notice — someone opening the base directly will not see
  that it is retired.
- **Deleted after verification:** a nested `lostboysdemolition/` clone inside the repo (the remote
  session's working directory — clean tree, no stashes, no unpushed commits, nothing unique) and
  the local `../lb-local-backup`.

**Still untracked, intentionally:** `OPS_ROADMAP.md` (superseded, banner added), `prompt.md`
(spent v21 brief), `supabase/.temp/` (CLI scratch). Delete only after BUILD_PLAN.md's carried-over
section is worked through.

**Awaiting Matt:** the 5 carried-over decisions and 1 conflict above; BUILD_PLAN.md's own 5 open
decisions (CC fee and Dump Fee Buffer block Phase 2); whether to add the missing
`x-webhook-secret` check to `receive-airtable-webhook`.

---

<!-- ─────────── MIGRATED FROM AIRTABLE — records below authored in the Pipeline Reference base ─────────── -->

### 2026-07-30 — Documentation reset + session context capture
**Status:** 🟢 Live · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`

Commit a976059. Session closed here — this is the handoff record.

NEXT SESSION: read SYSTEM_AUDIT_2026-07-30.md and BUILD_PLAN.md first. CLAUDE.md now points at both.

ADDED: BUILD_PLAN.md (approved rebuild plan, previously only in the session plan file outside the repo — would have been lost). SYSTEM_AUDIT_2026-07-30.md (ground truth on live Airtable + Supabase + repo).

REWROTE CLAUDE.md: was describing a system that does not exist. Now leads with actual state, records Matt's decisions, lists the 5 open decisions and what each blocks, records the Gusto/BILL API findings, corrects all function and table inventories, adds a repo/production parity rule.

FIXED schema_overview.md: entire body was duplicated (646 lines for 323 lines of content). Deduped + banner added, since CLAUDE.md and the Project Brief both cite it as the Airtable schema reference and it has contained no Airtable schema since commit 3a6af2d. Original spec still at `git show d9eedd6:schema_overview.md` (verified, 498 lines).

MARKED SUPERSEDED: SCHEMA_AUDIT_REPORT.md, including its error about which Clients.Jobs link to delete — Jobs (fldefnvFlGeJSUeFx) points at Jobs (old), Jobs 2 (fldQvLnbflwL0cAgU) points at the live table. The report guessed backwards; following it would destroy legacy linkage.

STATE AT CLOSE: Phase 0 repo reconciliation and RLS hardening complete and verified. Phase 1 (Postgres schema + migration of 989 clients / 296 estimates / 51 legacy jobs / 19 scopes / 5 pricing variables) is unblocked and safe to start — it does not depend on the open decisions. Phase 2 is blocked on the CC-fee and Dump Fee Buffer decisions.

Branch: claude/codebase-review-summary-r57jug, 4 commits, pushed. No PR opened.

> **Superseded 2026-07-30 (later same day):** that branch has since been merged into `main`, and
> five further commits landed on top. Start from `NEXT_SESSION_PROMPT.md`, not from this entry.

---

### 2026-07-30 — Phase 0 — Repo reconciliation + RLS hardening
**Status:** 🟢 Live · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`

No new edge function deploys this session. Codebase review + full build plan approved; Phase 0 executed.

REPO RECONCILIATION (commit ec3fb44): repo was missing 3 deployed functions and carried a stale 4th — redeploying from git would have regressed prod. Added airtable-client-sync (v19, documented in CLAUDE.md but never in git, processing traffic daily), receive-airtable-webhook (v11), push-to-airtable (v11). Replaced airtable-job-created with deployed v21 (Stage 3 only, 15 GHL custom fields via id: format through buildCustomFields, job_events logging) — committed copy was a generation behind.

SECURITY (commit 56d8056, migrations 20260730205654 + 20260730205752): RLS was OFF on sync_log, client_sync_state, job_events, invoice_reminders, labor_actuals, expense_actuals — 989 client records and 668 webhook payloads readable/writable by anyone with the anon key. Enabled RLS on all six, no policies by design (service_role has rolbypassrls=true so edge functions unaffected). RLS alone was NOT sufficient: two SECURITY DEFINER views over sync_log (recent_sync_activity, sync_errors) still leaked — anon read 50 rows after RLS was on, and sync_errors exposed full payload_in with names/phones/addresses. Both set to security_invoker=on. Verified: anon 0 rows everywhere, service_role retains full read + INSERT.

AIRTABLE AUTOMATIONS (commit 427543a): recovered create-line-items.js (wflrlJo8fpwOdCCFv) and update-line-items.js (wflqUwoKPt7wUF8ms) from base apptzp0IclCaAtOk2 — never existed in git despite CLAUDE.md claiming they were on disk.

DEFECTS FOUND, NOT FIXED: (1) receive-airtable-webhook has no x-webhook-secret validation + permissive CORS — can create/archive jobs unauthenticated. (2) push-to-airtable PATCHes 'Actual Labor Cost', an Airtable formula field — would fail if invoked, and addresses fields by name not ID. (3) Jobs formulas Labor Cost Variance (fld5pKKhsSHP5eQVT) and Revenue Variance (fld5FnWhKc2yF2JWg) are isValid:false, referencing deleted fields. (4) Estimate chain returns blank on every record — 5 pricing defaults never set, so IF({Target Margin Percent},...) guard fails; this is why code bills off Total Bid rather than Final Estimated Price.

KEY FINDING: live counts are Estimates 296, Clients 989, Jobs 9 (5 are test records), zero actuals anywhere. Approved plan is a greenfield Postgres rebuild carrying data only. Blockers resolved: Gusto has no project-tracking read API but does expose POST /v1/companies/{uuid}/time_tracking/time_sheets for pushing hours in for payroll; BILL Spend & Expense v3 supports custom-field creation with allowCustomValues plus transaction webhooks, so job codes can be auto-created at scheduling.

AWAITING MATT: CC fee cost vs pass-through (25% target currently reports 27.25%); Dump Fee Buffer priced in or informational; deposit policy; scope calibration rules; whether to drop the Gusto time-tracking add-on.

---

### 2026-05-15 — `airtable-job-created`
**Status:** 🟡 In Progress

v21 deployed. Full estimate field population via buildCustomFields helper. Stage fixed to Stage 3 (Estimate in Progress). job_events logging added. GHL UI visual verification PENDING — session closed before check. First task next session: trigger on test job and confirm all estimate custom fields populated in GHL UI. If blank: id: vs key: format issue.

> **Still open as of 2026-07-30.** This is the oldest unresolved item in the project.

---

### 2026-05-15 — `airtable-job-scheduled`
**Status:** 🟢 Live · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`
**Deploy URL:** https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/airtable-job-scheduled

v16 deployed 2026-05-15. Full end-to-end verified: GHL stage advance ✅, Google Calendar event created ✅, Event ID written back to Airtable fldry3k8ZNGGbm1aJ ✅, sync_log writing ✅, job_events writing ✅ (migration 002 applied this session). Three bugs fixed: (1) Airtable automation guard blocked retrigger — removed status=Scheduled check; (2) sync_log constraint violation — action_taken was 'stage_advanced', must be 'updated'; (3) GOOGLE_SERVICE_ACCOUNT_KEY stale — rotated to key ID 34f3a762c765. SLACK_PLACEHOLDER still in place — pending SLACK_BOT_TOKEN setup.

---

### 2026-05-15 — GHL Custom Fields + Mapping
**Status:** 🟢 Live

19 custom fields created on opportunity model via create-ghl-fields.js. Mapping committed to repo as ghl_field_mapping.md. API quirks documented: field body key is 'name' (not 'label'), MONETORY is GHL's actual enum spelling, options must be plain strings. All 5 MONETORY fields accepted without fallback.

---

### 2026-05-08 — `airtable-job-completed` (Stage 8)
**Status:** 🟢 Live · **Stage:** 8 · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`
**Deploy URL:** https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/airtable-job-completed

v7 deployed 2026-05-08. Replaced lump-sum distribution with per-line item rendering + 'Project Total' adjustment logic. Each named line item (including $0) appears at its actual amount. If sum of line items < Total Bid, a 'Project Total' line is appended for the difference so the invoice always totals to Total Bid. Stripe rendering pattern unchanged: POST /products first, then POST /invoiceitems with price_data[product]=<product.id>.

v6 (2026-05-08): Two-step Stripe rendering: POST /products → POST /invoiceitems with price_data[product]. Confirmed via test job recj05GY73A1felqj → invoice in_1TUpSHBbICAK6z7HvajiGSI9 ($3,790.40 draft).

Pending: Airtable automations (create-line-items.js, update-line-items.js) need manual setup in Airtable UI. Scripts are on disk at airtable-automations/. End-to-end test pending.

> **Update 2026-07-30:** now at v14; Slack paused via `SLACK_NOTIFICATIONS_ENABLED = false`. The
> two automations are live in the base (`wflrlJo8fpwOdCCFv`, `wflqUwoKPt7wUF8ms`) and their scripts
> are committed at `airtable-automations/`.

---

### 2026-05-07 — Job Completed Airtable Automation
**Status:** 🟡 In Progress · **Stage:** 8

Automation trigger for Stage 8 — fires when Job Status = Completed

---

### (not dated) — `stripe-webhook`
**Status:** 🔴 Not Built · **Stage:** 9 · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`

Builds after airtable-job-completed. Handles Stages 9-11.

> **Context 2026-07-30:** sandbox endpoint is configured for `invoice.sent` and `invoice.paid`.
> `STRIPE_SECRET_KEY` is currently a **test** key — confirm the Lost Boys live account before real
> invoicing. Corresponds to Phase 6 of `BUILD_PLAN.md`.
