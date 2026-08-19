# Profitability v2 Phase 1 (Tasks 1–5) Implementation Plan

**Approved by Matt 2026-08-19** (plan-mode approval, this session). Development branch:
`claude/last-session-review-f7tqxw`.

## Context

Phase 0 shipped 2026-08-18 (runbook + BL-7 `workforce_profiles` boundary applied to production;
merged to main at `4dd15cc`). Phase 1 — "Commercial-to-job foundation" — is Tasks 1–5 of the
ratified program `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md`
(the complete technical contract; **this plan does not duplicate its SQL/TS specs — it references
them and records the execution structure, corrections, and decisions**).

Phase 1 outcome: preserve every presented estimate version, record acceptance/reversal as
append-only events, make **app scheduling the one action that mints `JOB-XXXX`** (with original
budget v1 snapshot), and deliver GHL/Google-Calendar/Slack side effects through an idempotent,
retryable `integration_outbox` — including two-way Calendar date sync.

### Decisions taken by Matt this session (2026-08-19)

1. **GHL minting cutover = at Phase 1 gate pass.** Task 4 deploys with the legacy Quote-Accepted
   minting path still ON (`ENABLE_GHL_ACCEPTANCE_JOB_CREATION` absent ⇒ legacy behavior, fail-safe
   default). The flip to `false` is the final step of the Phase 1 gate, after the E2E run proves
   app scheduling. Per ratified decision 1, once flipped it is permanent — rollback never
   re-enables it.
2. **Build starts now; phone smoke runs in parallel.** Tasks 1 + 3 (app-invisible) start
   immediately. Matt's phone smoke + one real estimate (≥1426) through
   https://lostboysdemolition.vercel.app is a **hard stop before Task 4's cutover work and the
   phase gate** — not before T1/T2/T3.
3. **Prod migration applies are per-task, after each task's adversarial review passes** (Phase B
   precedent; runbook step 7 approval given per task by Matt).

### Verified live facts (queried read-only 2026-08-19)

- Migration head: `20260818230956_workforce_auth_boundary` (27 applied). Note: applied version
  timestamps differ from repo filenames (repo file is `20260818143000_...`) — new files use
  ≥ 2026-08-19 prefixes so repo ordering matches apply order.
- **Zero name collisions**: none of the new enums (`job_health_status`, `cost_category`,
  `actor_assurance`, …) or tables (`estimate_financial_details`, `integration_outbox`,
  `estimate_identity_links`, `calendar_watch_channels`, …) exist yet.
- `jobs` 2 rows (JOB-1102/1104, cancelled), `jobs.job_number` has a UNIQUE constraint → valid FK
  target for all new `references public.jobs(job_number)` columns.
- `estimates` 16 rows, max `estimate_number` 1425 (all TEST); `estimate_line_items` 9 rows.
- `pricing_variables` = exactly the 6 known keys; `estimated_dump_cost_per_load` does NOT exist
  yet (Task 2 seeds it at 65).
- pg_cron: `crew-night-before-a @ 30 22 * * *` + `-b @ 30 23 * * *` — the double-slot self-gating
  pattern Task 5's dispatcher cron mirrors (at `*/5 * * * *`).
- Web layout matches the v2 Task 2 file list exactly (`web/src/lib/estimates/{types,validate,map,repo,lifecycle}.ts`,
  `web/src/lib/ghl/{client,push,estimateFields,estimateDoc}.ts` all exist).

## Global constraints (inherited, non-negotiable)

- Every schema task follows `docs/runbooks/profitability-schema-validation.md` (8-step sequence,
  branch-fidelity probes a–d, pgTAP on branches only, plain-SQL catalog assertions post-apply,
  BUILD_LOG verbatim record). None of the Phase 1 migrations touch the `auth` schema, so the
  production dry-run fallback applies only if a branch probes unfaithful.
- `ghl-job-webhook` deploys ONLY via the two-command `--no-verify-jwt` + readback invariant.
- Quote math does not change: golden-321 gate (`deno task test`) and the Jorge total `$2,543.51`
  must hold through every task. `_shared/pricing.ts` is not modified in Phase 1.
- No pricing to crew surfaces (Slack, crew calendar) — Task 5 tests pin this.
- Suites at every task close: `deno task test` (currently 317) and `cd web && npx vitest run`
  (currently 261) green, plus the task's new tests.
- Sonnet implements, strongest available model adversarially reviews every task + the whole
  branch. Reviews run concurrently with unrelated implementation lanes.
- No deletes without Matt's per-item approval; never `git add -A`; everything applied to Supabase
  is committed same session.

## Session / lane structure (concurrency map — designed in, per the 2026-08-18 directive)

Phase 1 executes as **4 build sessions + gate**, each ending with adversarial review and a
BUILD_LOG entry. Lanes within a session own disjoint files and run concurrently.

### Session 1 — Task 1 ∥ Task 3 (start immediately)

| Lane | Owns | Notes |
|---|---|---|
| A: Task 1 schema | `supabase/migrations/2026081915*_profitability_{lifecycle_types,core_schema}.sql`, `supabase/tests/profitability_core_schema_test.sql` | Full runbook cycle: branch → red → green → review → Matt-approved prod apply |
| B: Task 3 forecast engine | `web/src/lib/profitability/{types,calculateJobHealth}.ts` + tests | Pure TS, zero DB dependency — fully concurrent with Lane A; the 9 named test cases from the v2 doc are the contract |

Lane B must NOT touch `web/src/lib/estimates/` or `web/src/lib/ghl/` (Session 2 territory).
Task 1's enum value lists and Task 3's TS union types are the same names — the Task 3 reviewer
diff-checks them against the migration before merge.

### Session 2 — Task 2 (estimate economics + commercial lifecycle), 3 internal lanes → 1 integration step

| Lane | Owns |
|---|---|
| 2a: economics module | `web/src/lib/profitability/estimateEconomics.ts` + test (pure fn, spec verbatim in v2 doc) |
| 2b: migrations | `20260819*_create_estimate_economic_details.sql` (v2 RPC), `20260819*_estimate_commercial_lifecycle.sql` (identity links, presentations, acceptance events/state, `record_estimate_acceptance_event`), + pgTAP tests, + `estimated_dump_cost_per_load=65` seed |
| 2c: GHL surface | `web/src/lib/ghl/pipeline.ts` (centralized stage IDs), `web/src/lib/ghl/prefill.ts` + tests; read-only additions to `client.ts` |
| 2d (after 2a/2b/2c): integration | `web/src/lib/estimates/{types,validate,map,repo,lifecycle}.ts`, new `commercialLifecycle.ts`, `actions.ts`, `EstimateBuilder.tsx`, `web/src/lib/rates.ts` (new key) |

2a ∥ 2b ∥ 2c are fully concurrent; 2d serializes behind them (interface boundary — legitimate).
The `estimate_identity_links` backfill (deterministic, from `ghl_push_state`, never guessing on
disagreement) runs as part of 2b's prod apply; expected input is the 10 live `ghl_push_state`
rows (all TEST estimates).

**Deploy-order invariant:** the `estimated_dump_cost_per_load` seed migration MUST be applied to
prod **before** the web code that reads it deploys — `loadRatesConfig()` throws on any missing
key it reads, so a web-first deploy would 500 every estimate page.

### Session 3 — Task 4 (atomic schedule-to-job promotion), 3 lanes

| Lane | Owns |
|---|---|
| 4a: RPC migration | `20260819*_schedule_estimate_rpc.sql` (`schedule_estimate`: lock, eligibility checks, mint via `next_job_number()`, budget v1, outbox events, idempotent re-call) + pgTAP |
| 4b: web scheduling | `web/src/lib/jobs/{types,validate,repo}.ts` + tests, `web/src/app/(app)/estimates/[id]/schedule/*`, `web/src/app/(app)/jobs/actions.ts`, detail-page hook |
| 4c: webhook retirement | `supabase/functions/ghl-job-webhook/handlers.ts` + `handlers_test.ts` — Quote Accepted handler gains the `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` gate (absent ⇒ legacy ON), Job Scheduled handler gains the `app_is_schedule_authority` compat response for launch-workflow jobs |

4b wires against 4a's RPC signature (fixed verbatim in the v2 doc — no wait needed);
4c is disjoint from both. `ghl-job-webhook` redeploys via the invariant; its 139-test suite must
stay green; the flag stays un-set in prod (legacy behavior unchanged) until the gate.

### Session 4 — Task 5A: outbound (dispatcher), then Session 5 — Task 5B: inbound (calendar sync)

Split per the v2 gate's own note: *"the outbound projection must pass its gate without depending
on inbound sync being live."*

**5A (outbound):** `20260819*_outbox_claim_rpc.sql` (`claim_integration_events`,
`for update skip locked`), `supabase/functions/integration-dispatcher/*` (Calendar create/update
via new `updateCalendarEvent` in `_shared/google.ts`, GHL stage projection, one crew-safe Slack
schedule message, retry `min(60, 2**attempts)` minutes, dead-letter at attempt 5 + `job_alerts`),
cron migration `20260819*_schedule_integration_dispatcher.sql` (every 5 min, x-webhook-secret
required), `web/src/lib/jobs/scheduleActions.ts` (cancel/postpone/closed-lost actions).

**5B (inbound):** `supabase/functions/google-calendar-webhook/*`, `calendar_watch_channels`
registry + renewal-before-expiry + overlap dedup + reconciliation-fallback poll,
`resolveDeletedCalendarEvent` resolutions, revision-guarded date-only inbound writes.
**5B opens with a spike** (see Risks) before the lifecycle is built.

### Phase 1 gate (after 5A at minimum; 5B gates separately)

Precondition: Matt's phone smoke + real estimate ≥1426 — **hard stop, no exceptions.**
Gate script (v2 doc verbatim): create/link GHL opportunity → present 2 versions → accept v2 →
confirm `Quote Accepted` + no job → schedule 2-day all-day → one `JOB-XXXX`, one budget v1,
correct exclusive-end Calendar rendering, GHL `Job Scheduled` → edit dates both directions →
simulate deletion + resolve → prove retry idempotency. Runs against **live GHL with TEST-labeled
records** (Phase A/B precedent — no staging GHL exists); test jobs re-cancelled after (re-drags
revive rows — known hazard). **Final gate step: set `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false`
in prod (permanent), redeploy `ghl-job-webhook` via the invariant, live-verify a GHL Quote
Accepted drag returns `quote_accepted_awaiting_schedule` and mints nothing.**

## Spec corrections / deviations (approved via this plan)

1. **pgTAP description args everywhere.** The v2 doc's verbatim Task 1 test
   (`has_enum('public','x')`, `has_table('public','x')` with no trailing description) reproduces
   the exact overload bug Phase 0 caught. Every multi-overload assertion gets its description
   argument. `plan(n)` counts adjusted accordingly.
2. **Explicit `authenticated` revokes + ACL assertions on every new table.** v2 Task 1 says only
   "grant no access to anon" — Phase 0 proved Supabase default privileges pre-grant
   `authenticated` REFERENCES/TRIGGER/**TRUNCATE** (not RLS-gated). Every new table's migration
   revokes from `public, anon, authenticated` explicitly (service-role bypasses RLS; Task 8 adds
   authenticated policies later), and the pgTAP suite pins the ACL posture — the assertion class
   that caught the real gap in Phase 0.
3. **`search_path = public, pg_temp` pinned on every new function/RPC/trigger function**
   (`mark_job_reconciliation_required`, `record_estimate_acceptance_event`,
   `create_estimate_with_items_v2`, `schedule_estimate`, `claim_integration_events`, all
   immutability triggers). v2 doesn't state it; the 2026-08-17 hardening makes it standing.
4. **Migration filename prefixes use 2026-08-19+ dates**, not the v2 doc's 2026-08-18 ones —
   keeps repo ordering consistent with the applied head (`20260818230956`).
5. **Task 5 split 5A/5B** as above (sanctioned by the v2 gate text itself).
6. **verify_jwt posture recorded for the two new functions:** `google-calendar-webhook` MUST
   deploy `--no-verify-jwt` (Google push notifications carry no Supabase JWT; auth = channel
   token verification) — it joins `ghl-job-webhook` in the deploy invariant, readback required.
   `integration-dispatcher` follows the `crew-night-before` pattern (its `x-webhook-secret` check
   is the auth), posture recorded at deploy either way.
7. **Flag default semantics:** `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` absent ⇒ legacy minting ON
   (deploy-safe: Task 4 shipping changes nothing in prod behavior); only the literal string
   `"false"` disables. Flip happens at gate pass (Matt, this session).
8. **Sub-slice review boundaries:** each session's review gates its own merge/apply; the phase
   additionally gets a whole-branch review before the gate (standing rule).

## Risk flags

- **Google watch-channel viability is unproven** — channel registration to an edge-function URL
  may hit Google's domain-verification requirements. 5B step 1 is a **spike**: register one watch
  channel for a test calendar against a deployed stub endpoint and observe a real notification
  *before* building the lifecycle. If blocked, 5B degrades to reconciliation-polling-only
  (already specified as the fallback) — flag to Matt, don't build the channel machinery blind.
- **`ghl-job-webhook` regression surface** (Task 4c): the function is the live Phase A keystone.
  Gate: full 139-test suite + new flag tests green before deploy; invariant deploy; live re-drag
  probe on JOB-1104 after (then re-cancel it).
- **Two minting paths coexist between Task 4 deploy and gate flip** — by design (Matt's cutover
  decision). The app path writes `launch_workflow=true`; legacy path doesn't — rows are
  distinguishable and the GHL Job Scheduled handler's compat check keys off it.
- **`estimate_acceptance_state` vs existing `estimates.status`:** the estimates list/detail UI
  currently reads `status` (`sent`/`accepted`/`declined`). Task 2 keeps writing it (via existing
  `update_estimate_status`) in the same server actions that append acceptance events, so the two
  can't drift silently; the acceptance projection is the scheduling authority.
- **Outbox introduces async side effects where Phase A was synchronous** — scheduling returns
  before Calendar/Slack/GHL fire (≤5-min cron lag). Accepted; the job detail page shows outbox
  event status so Dane isn't blind while it's pending.
- Money stored `numeric(12,2)`; percentages whole-number unless `_rate` (decimal fraction) —
  `pricing_variables` new key is a per-load dollar cost, not a `_rate`.

## Verification

- **Per migration:** runbook 8-step, verbatim BUILD_LOG record (branch id, probes a–d, red/green
  pgTAP, row counts, post-apply `get_advisors`).
- **Per task:** the v2 doc's own test commands (Task 2: economics + estimates + ghl suites +
  `npm run build` + Jorge $2,543.51; Task 4: `deno test supabase/functions/ghl-job-webhook` +
  invariant readback; Task 5: dispatcher/webhook/google suites). Plus `deno task test` ≥317 and
  web vitest ≥261 at every close.
- **Phase gate:** the E2E script above, on live GHL with TEST records, then the flag flip +
  negative probe (drag mints nothing), then whole-branch review, BUILD_LOG, and
  CLAUDE.md/BUILD_PLAN status updates.

## Out of scope (Phase 1)

Tasks 6–17 (dashboard, ledger, auth'd checklists, change orders, closure, Slack digests, D1
adapter, BILL, Stripe webhook, launch). Owner promotion of Matt's `workforce_profiles` row
(Task 8 runbook). BL-6 echo guard (separate draft awaiting review). Removing
`create_estimate_with_items` v1 (post-launch cleanup). Historical estimate import (declined).

## First execution steps on approval

1. Land this plan as `docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md`; commit +
   push to `claude/last-session-review-f7tqxw`.
2. Dispatch Session 1: Lane A (Task 1 schema, runbook cycle) ∥ Lane B (Task 3 engine) ∥ their
   reviews as they complete.
