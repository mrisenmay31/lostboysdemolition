Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B). The **2026-08-14 (evening)**
entry in BUILD_LOG.md describes exactly where things stand.

## Where the last session left off (2026-08-14, evening) — Phase B slice 2 PAUSED mid-build, 10/14 tasks done

**Phase B slice 2 (estimate builder UI + GHL push) is IN PROGRESS on branch `phase-b-slice-2`
(tip `123b74a`, 16 commits, NOT merged to main).** Executed subagent-driven (sonnet implements /
opus reviews per task + fix loops) under a **hybrid-lane concurrency model** (a DB-migration lane
and a web lane ran concurrently in isolated git worktrees, each task merged back after its own
review passed). **Do not restart from scratch — resume at T11.**

**READ FIRST next session:** the SDD ledger at
`.superpowers/sdd/2026-08-14-phase-b-slice-2-estimate-builder-ghl-push/progress.md` (gitignored) —
it has the full per-task history, all rulings, every deferred finding, and the pause state. Task
briefs + implementer/review reports for every task (incl. the not-yet-built T11/T11b/T12/T13) are
staged in that same directory as `task-N-brief.md` / `task-N-report.md`.

### Done + reviewed + merged onto `phase-b-slice-2` (T1–T10):
- **T1** `deno.json` test task (`deno task test` → 18/18, golden 321 gate).
- **T2/T3/T4** three DB migrations, all **APPLIED LIVE** to `eiqqqwajmcpcwhvxxnhx` + committed:
  estimator columns (`created_by`/`created_by_name`, immutable), write RPCs
  (`create_estimate_with_items` + `update_estimate_status/quote/job_number`) + `estimate_mutations_audit`
  + fixups, and `ghl_push_state` + `app_to_ghl` sync direction.
- **T5** Next 16 scaffold in `web/` (imports `_shared/pricing.ts` via shim, never forked).
- **T6** Supabase Auth (3 users, gated `(app)`, `requireUser()`, service-role `admin.ts`). Open-redirect
  hardening took 3 rounds; final `safeNext` origin-re-resolution fuzzed 71k cases clean.
- **T7** `loadRatesConfig()` reads `pricing_variables` live, throws on missing key (no DEFAULT_RATES fallback).
- **T9** GHL client (`web/src/lib/ghl/client.ts`). **Live scope smoke = GO** (token already has estimate
  scopes, 510 docs — no rotation needed).
- **T10** estimate-doc builder (`estimateDoc.ts`) — live-validated payload; **largest-remainder allocation
  (never negative, sums exact)**; ⚠️ **GHL stores `meta` keys CAMELCASED** (`lbdEstimateId`) — T12 read-back must use camelCase.
- **T8** data layer (`web/src/lib/estimates/{types,validate,map,repo}.ts` + `app/(app)/estimates/actions.ts`):
  writer contract, negative-input rejection, numeric-as-string normalization, actions each call `requireUser()`.

**Gates at pause:** web vitest **139/139**, `deno task test` **18/18**, `npm run build` green with env.
Golden gate held (engine only gained a one-word `export`). All 10 tasks passed opus review (T2, T3, T6, T9, T10 needed fix rounds — all resolved).

### REMAINING — resume here (T11 + T12 can run in parallel; both unblocked by T8):
1. **T11 — estimate builder page** (`/estimates/new`): mobile-first, live recalc via client-side
   `computeEstimate` against server-provided rates, scope picker (19 `scope_library` rows), quick vs
   itemized modes, markup preset chips, Path B toggle. **First real create = live smoke test** (create
   one estimate, confirm row + audit row + estimate number — will be ≥1416).
2. **T12 — push orchestration** (`web/src/lib/ghl/push.ts`): `pushEstimateToGhl` per-target idempotent
   via `ghl_push_state`; attach-existing + create-opportunity paths; **must** read GHL `meta` camelCase,
   **search-before-create** for opportunity idempotency (T9 review), carry GHL ids forward from parent
   for v2 (T4 review). Non-fatal, `sync_log` direction `app_to_ghl`, one row per target.
3. **T11b — list + detail + lifecycle** (after T11): quote-override (required reason), status actions,
   version chain, audit history, revise→new-version.
4. **T13 — Vercel deploy + docs close** (last): project root `web`, "include files outside root" ON,
   env vars server-only; production phone smoke; CLAUDE.md/BUILD_LOG finalize; decide merge-to-main.

### MUST-FIX findings deferred to next session (from reviews — address in the named task):
- `listEstimates` `q` is **PostgREST-filter-injectable** (`repo.ts` ~1116) — sanitize `,()` **before T11b** wires the list.
- `quotedPrice` not non-negative-guarded (`validate.ts:69`) — add `nonNegativeNumber` (→ negative GHL amount in T12).
- `updateStatus` accepts any of 6 statuses — **T11b UI offer only sent/accepted/declined**.
- `createNewVersion` on a stale parent → raw unique-violation — T11b add friendly "newer version exists" check.
- T1 doc minors + `deno.json` not in repo-structure tree → fold into T13 doc pass.

### MANUAL SETUP owed by Matt (none blocked this session; needed before local dev / deploy):
1. **`web/.env.local`** (permission layer blocked agents from writing it): `NEXT_PUBLIC_SUPABASE_URL=https://eiqqqwajmcpcwhvxxnhx.supabase.co`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ZmXLIhozN3vMWf-8e13hQQ_59AkdjnY`, and the **service-role key** (server-only).
2. **Provision 3 auth users** (Dane/Jackson/Matt) in the Supabase dashboard with `display_name`
   metadata, disable public signups; record emails in CLAUDE.md. (Only 1 pre-existing account today.)

Standing rules: (a) plan + explicit approval before any new build (small fixes exempt); (b) anything
deployed/applied to Supabase committed same session; (c) BUILD_LOG.md entry at every session close;
(d) subagent-driven with per-task opus review; (e) hybrid-lane concurrency approved — parallel
worktrees, merge each task after its review. Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field
Registry / Secrets & Credentials / People & IDs only.
