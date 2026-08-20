# Profitability v2 Phase 1 (Tasks 1–5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution model: parallel Sonnet implementer lanes with disjoint file ownership; adversarial Opus review per task + whole branch; orchestrator serializes only at the integrity boundaries (branch validation, prod applies, commits).

**Goal:** Ship v2 Phase 1 — "Commercial-to-job foundation": preserve every presented estimate version, record acceptance/reversal as append-only events, make **app scheduling the one action that mints `JOB-XXXX`** (with original budget v1 snapshot), and deliver GHL/Google-Calendar/Slack side effects through an idempotent, retryable `integration_outbox` including two-way Calendar date sync.

**Architecture:** Additive schema first (v2 Task 1) in parallel with the pure TS forecast engine (v2 Task 3); then estimate economics + commercial lifecycle (v2 Task 2); then the atomic schedule-to-job RPC + GHL-webhook retirement flag (v2 Task 4); then the outbox dispatcher split outbound (5A) / inbound calendar sync (5B). Every migration follows `docs/runbooks/profitability-schema-validation.md`. Prod applies are per-task after adversarial review, with Matt's approval each time.

**Tech Stack:** Supabase Postgres 17 (project `eiqqqwajmcpcwhvxxnhx`) + pgTAP (branches only), Supabase MCP, Deno 2 edge functions, Next 16 App Router + vitest (in `web/`), GHL API, Google Calendar API, Slack API, pg_cron.

**Spec:** `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` — Task 1 (lines 272–686), Task 2 (689–999), Task 3 (1003–1138), Task 4 (1142–1237), Task 5 (1241–1358), Phase 1 gate (1360–1362). **The v2 doc is the complete technical contract — this plan does not duplicate its SQL/TS specs; it records execution structure, corrections, and decisions.**

**Approved by Matt 2026-08-19** (plan-mode approval). Development branch: `claude/last-session-review-f7tqxw`.

## Context

Phase 0 shipped 2026-08-18 (runbook + BL-7 `workforce_profiles` boundary applied to production; merged to main at `4dd15cc`). Phase 1 is the first production-code phase of the ratified program.

### Decisions taken by Matt this session (2026-08-19)

1. **GHL minting cutover = at Phase 1 gate pass.** v2 Task 4 deploys with the legacy Quote-Accepted minting path still ON (`ENABLE_GHL_ACCEPTANCE_JOB_CREATION` absent ⇒ legacy behavior, fail-safe default). The flip to `false` is the final step of the Phase 1 gate, after the E2E run proves app scheduling. Per ratified decision 1, once flipped it is permanent — rollback never re-enables it.
2. **Build starts now; phone smoke runs in parallel.** v2 Tasks 1 + 3 (app-invisible) start immediately. Matt's phone smoke + one real estimate (≥1426) through https://lostboysdemolition.vercel.app is a **hard stop before v2 Task 4's cutover work and the phase gate** — not before Tasks 1/2/3.
3. **Prod migration applies are per-task, after each task's adversarial review passes** (Phase B precedent; runbook step 7 approval given per task by Matt).
4. **(later same day) Task 1 prod apply approved and DONE** — both migrations applied 2026-08-19, post-apply verification + advisors clean, disposable branch deleted. New migration head `20260819052245`.
5. **(later same day) Price source = pin at acceptance.** The quoted_price/customer_price gap (Session 1 review escalation) is DECIDED: the immutable `estimate_acceptance_events` row records the accepted price; `schedule_estimate` mints budget-v1 revenue from it and recomputes planned profit at budget-mint time. Satisfies the reviewer's caveat by construction (acceptance events are append-only, so the accepted price cannot drift). **Becomes deviation 12**: Task 2's `estimate_acceptance_events` gains an `accepted_price numeric(12,2)` column (required on `accepted` events), and Task 4's RPC sources `approved_revenue` from the current acceptance's `accepted_price` instead of `estimate_financial_details.customer_price` (details row stays the planning-economics record).

### Verified live facts (queried read-only 2026-08-19)

- Migration head: `20260818230956_workforce_auth_boundary` (27 applied). Applied version timestamps differ from repo filenames — new files use ≥ 2026-08-19 prefixes so repo ordering matches apply order.
- **Zero name collisions**: none of the new enums (`job_health_status`, `cost_category`, `actor_assurance`, …) or tables (`estimate_financial_details`, `integration_outbox`, `estimate_identity_links`, `calendar_watch_channels`, …) exist yet.
- `jobs` 2 rows (JOB-1102/1104, cancelled); `jobs.job_number` has a UNIQUE constraint → valid FK target for the new `references public.jobs(job_number)` columns.
- `estimates` 16 rows, max `estimate_number` 1425 (all TEST); `estimate_line_items` 9 rows; `ghl_push_state` 10 rows (Task 2's backfill input).
- Legacy row-count baseline for runbook step 2: `users` 0, `crews` 0, `time_entries` 0, `workforce_profiles` 1.
- `pricing_variables` = exactly the 6 known keys; `estimated_dump_cost_per_load` does NOT exist yet (v2 Task 2 seeds it at 65).
- pg_cron: `crew-night-before-a @ 30 22 * * *` + `-b @ 30 23 * * *` — the self-gating pattern the dispatcher cron mirrors (at `*/5 * * * *`).
- Web layout matches the v2 Task 2 file list exactly (`web/src/lib/estimates/{types,validate,map,repo,lifecycle}.ts`, `web/src/lib/ghl/{client,push,estimateFields,estimateDoc}.ts` all exist).
- Branch cost $0.01344/hr (org `nhzbxchbcjjhvdloflip`) — `confirm_cost` at each branch creation; delete branches when validation is done.

## Global Constraints

- Every schema task follows `docs/runbooks/profitability-schema-validation.md` (8-step sequence, fidelity probes a–d, pgTAP on branches only, plain-SQL catalog assertions post-apply, verbatim BUILD_LOG record). No Phase 1 migration touches the `auth` schema, so the production dry-run fallback applies only if a branch probes unfaithful.
- `ghl-job-webhook` deploys ONLY via the two-command `--no-verify-jwt` + readback invariant.
- Quote math does not change: golden-321 gate (`deno task test`) and the Jorge total `$2,543.51` must hold through every task. `_shared/pricing.ts` is not modified in Phase 1.
- No pricing to crew surfaces (Slack, crew calendar) — 5A tests pin this.
- Suites at every task close: `deno task test` (currently 317) and `cd web && npx vitest run` (currently 261) green, plus the task's new tests.
- Sonnet implements; adversarial Opus review for every task + the whole branch. Reviews run concurrently with unrelated implementation lanes; reviewers do not run the full suite mid-flight and do not report on files they don't own.
- No deletes without Matt's per-item approval; never `git add -A`; everything applied to Supabase is committed same session; BUILD_LOG entry at every session close.

## Spec deviations (approved via this plan — these override the v2 doc's verbatim text)

1. **pgTAP description args everywhere.** The v2 doc's verbatim Task 1 test (`has_enum('public','x')`, `has_table('public','x')` with no trailing description) reproduces the exact overload bug Phase 0 caught. Every multi-overload assertion gets its description argument; `plan(n)` counts adjusted.
2. **Explicit `authenticated` revokes + ACL assertions on every new table.** v2 Task 1 says only "grant no access to anon" — Phase 0 proved Supabase default privileges pre-grant `authenticated` REFERENCES/TRIGGER/**TRUNCATE** (not RLS-gated). Every new table's migration revokes from `public, anon, authenticated` explicitly (service role bypasses RLS; Task 8 adds authenticated policies later), and the pgTAP suite pins the ACL posture.
3. **`set search_path = public, pg_temp` pinned on every new function/RPC/trigger function** (`mark_job_reconciliation_required`, `record_estimate_acceptance_event`, `create_estimate_with_items_v2`, `schedule_estimate`, `claim_integration_events`, all immutability triggers), EXECUTE revoked from `public, anon, authenticated`. v2 doesn't state it; the 2026-08-17 hardening makes it standing.
4. **Migration filename prefixes use 2026-08-19+ dates**, not the v2 doc's 2026-08-18 ones — keeps repo ordering consistent with the applied head.
5. **v2 Task 5 split 5A (outbound) / 5B (inbound)** — sanctioned by the v2 gate text itself ("the outbound projection must pass its gate without depending on inbound sync being live"). 5B opens with a watch-channel spike before the lifecycle is built.
6. **verify_jwt posture recorded for the two new functions:** `google-calendar-webhook` MUST deploy `--no-verify-jwt` (Google push notifications carry no Supabase JWT; auth = channel token verification) — it joins `ghl-job-webhook` in the deploy invariant, readback required. `integration-dispatcher` follows the `crew-night-before` pattern (`x-webhook-secret` check is the auth), posture recorded at deploy either way.
7. **Flag default semantics:** `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` absent ⇒ legacy minting ON (deploy-safe: v2 Task 4 shipping changes nothing in prod behavior); only the literal string `"false"` disables. Flip happens at gate pass (Matt, this session).
8. **Sub-slice review boundaries:** each session's review gates its own merge/apply; the phase additionally gets a whole-branch review before the gate (standing rule).
9. **`JobHealthInput.jobStatus` widened to all 7 live `job_lifecycle` values** (adds `accepted`, `invoiced`) — Session 1 review finding: the v2 contract's 5-value union would force a lossy `status_v2` remap in Tasks 5/6 (`invoiced` is reachable). Runtime-neutral: only `in_progress` alters behavior (checklist freshness).
10. **`mark_job_reconciliation_required`'s outbox `idempotency_key` is `alert:<job_alerts.id>`** — keyed on the alert row the call itself opened (`on conflict do nothing returning id`; early return when the alert was already open), deviating from the spec's literal "same idempotency key". Session 1 review *demonstrated* both failure modes of string-derived keys: a global fingerprint drops the Slack event when the source recurs on another job, and a job-scoped string still drops it when the source recurs after the first alert resolved (the dedup window reopens on resolution). The intended semantics — one Slack ping per newly opened alert — are exactly what alert-id keying encodes. The `job_alerts` fingerprint itself stays spec-exact.
11. **`job_forecast_overrides` gains `check ((category is not null and category is distinct from 'direct_labor') or expected_remaining_cost is null)`** — the forecast engine ignores a labor `expected_remaining_cost` by contract (labor ETC always flows from the crew-days/remaining-hours model), and a NULL-category dollar override has no home either (`remainingCostOverrides` is keyed by category); this CHECK stops Task 9 from persisting either legal-but-silently-ignored shape.

**Review-resolved clarification (no schema change):** `estimate_financial_details` being fully immutable with PK `estimate_id` is correct by design, not a Task 2 collision — the Task 2 backfill is for `estimate_identity_links` only; no economic-details backfill exists (historical import declined 2026-08-14). A details row is 1:1 with an immutable estimate version, inserted in the same `create_estimate_with_items_v2` transaction; corrections flow through a new estimate version, same as line items.

**⚠️ OPEN DESIGN ITEM for Session 2 (Task 2) / Session 3 (Task 4) — decide before Task 2's economics wiring ships (Session 1 review escalation):** `quoted_price`/`quote_override_reason` are ratified as mutable post-insert with NO new estimate version (v2 ledger + live Phase B `update_estimate_quote`), but `estimate_financial_details.customer_price`/`discount_amount`/`planned_economic_profit` are pinned immutably at create time, and v2 Task 4 mints `job_budget_versions` v1 FROM the details row. Consequence if unaddressed: Dane discounts after create → details row keeps the pre-discount price → `approved_revenue` overstates → every discounted job carries a phantom revenue shortfall through every forecast, retention %, health status, and closure snapshot, unrepairably. Candidate resolutions: (a) a quote change mints a new version+details row (contradicts the ratified mutable set — needs Matt); (b) **recommended:** `schedule_estimate` derives budget-v1 revenue from the accepted commercial price (`coalesce(quoted_price, customer_price)`) and recomputes planned profit at budget-mint time — keeps ratified mutability, budget reflects commercial reality at scheduling — **caveat (reviewer): (b) only holds if the accepted/presented price is itself pinned immutably at acceptance time; if `quoted_price` can still move after acceptance, (b) relocates the drift rather than removing it — confirm when deciding**; (c) write details at presentation time instead of create time. Nothing in Task 1's schema blocks any option.

## Concurrency map

Per Matt's standing directive, lanes are designed in up front. File ownership is disjoint; one shared worktree on the development branch is sufficient (BL-4/Phase-0 precedent).

| Session | Lane | v2 Task | Files owned | Can run alongside |
|---|---|---|---|---|
| 1 | A | Task 1 schema | `supabase/migrations/20260819150000_*.sql`, `20260819151000_*.sql`, `supabase/tests/profitability_core_schema_test.sql` | Lane B entirely |
| 1 | B | Task 3 engine | `web/src/lib/profitability/{types,calculateJobHealth}.ts` + tests | Lane A entirely; must NOT touch `web/src/lib/estimates/`, `web/src/lib/ghl/`, `supabase/` |
| 2 | 2a | Task 2 economics | `web/src/lib/profitability/estimateEconomics.ts` + test | 2b, 2c |
| 2 | 2b | Task 2 migrations | `20260819*_create_estimate_economic_details.sql`, `20260819*_estimate_commercial_lifecycle.sql` + pgTAP + `estimated_dump_cost_per_load=65` seed | 2a, 2c |
| 2 | 2c | Task 2 GHL surface | `web/src/lib/ghl/pipeline.ts`, `web/src/lib/ghl/prefill.ts` + tests; additive changes to `client.ts` | 2a, 2b |
| 2 | 2d | Task 2 integration | `web/src/lib/estimates/*`, `commercialLifecycle.ts`, `actions.ts`, `EstimateBuilder.tsx`, `web/src/lib/rates.ts` | nothing (interface boundary behind 2a/2b/2c) |
| 3 | 4a | Task 4 RPC | `20260819*_schedule_estimate_rpc.sql` + pgTAP | 4b, 4c |
| 3 | 4b | Task 4 web | `web/src/lib/jobs/{types,validate,repo}.ts` + tests, `web/src/app/(app)/estimates/[id]/schedule/*`, `web/src/app/(app)/jobs/actions.ts`, detail-page hook | 4a (wires against the RPC signature fixed verbatim in the v2 doc), 4c |
| 3 | 4c | Task 4 webhook | `supabase/functions/ghl-job-webhook/handlers.ts` + `handlers_test.ts` | 4a, 4b |
| 4 | 5A | Task 5 outbound | `20260819*_outbox_claim_rpc.sql`, `supabase/functions/integration-dispatcher/*`, `_shared/google.ts` (additive `updateCalendarEvent`), `20260819*_schedule_integration_dispatcher.sql`, `web/src/lib/jobs/scheduleActions.ts` + tests | reviews of Session 3 |
| 5 | 5B | Task 5 inbound | `supabase/functions/google-calendar-webhook/*`, `calendar_watch_channels` migration, reconciliation poll | nothing until the spike resolves |
| — | Review | each task | none (read-only) | any unrelated implementation lane |
| — | Serial tail | gate + landing | prod DB, env flag, `BUILD_LOG.md`, `CLAUDE.md`, `BUILD_PLAN.md`, `NEXT_SESSION_PROMPT.md` | nothing (integrity boundary) |

---

### Task 0: Land this plan in the repo — ✅ done 2026-08-19

**Files:** Create: `docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md`

- [x] **Step 1:** Committed as `165f11b` and pushed to `claude/last-session-review-f7tqxw`; upgraded to skill-standard format same session.

---

### Task 1 (Session 1 Lane A — v2 Task 1): Canonical profitability schema

**Files:**
- Create: `supabase/migrations/20260819150000_profitability_lifecycle_types.sql`
- Create: `supabase/migrations/20260819151000_profitability_core_schema.sql`
- Create: `supabase/tests/profitability_core_schema_test.sql`

**Interfaces:**
- Consumes: existing `jobs(job_number)`, `estimates(id)`, `auth.users(id)`, `next_job_number()`.
- Produces: the 13 enums, 13 new `jobs` columns, 15 tables, `mark_job_reconciliation_required()`, immutability triggers, indexes — exact names per v2 lines 272–686; Tasks 2–17 depend on them.

- [x] **Step 1 (Sonnet lane):** Author both migrations + the pgTAP suite per the v2 contract with deviations 1–4 applied. House style: `20260818143000_workforce_auth_boundary.sql` (revokes/pinning/header), `20260814151948_phase_b_estimates_fixups.sql` (immutability triggers), `workforce_auth_boundary_test.sql` (pgTAP with descriptions). Test extends the spec's 20 existence assertions with: all 13 enums, all 15 tables, `jobs` column spot-checks, RLS-enabled checks on every new table, ACL assertions (anon + authenticated hold nothing), `function_privs_are` on `mark_job_reconciliation_required`, partial-unique-index + trigger existence checks.
- [x] **Step 2 (orchestrator):** Runbook cycle on disposable branch `v2-phase1-task1`: fidelity probes a–d → pgTAP install → RED pre-migration → apply both migrations → GREEN → `deno task test` + `cd web && npx vitest run` green → record verbatim (branch id, probes, red/green output, row counts).
- [x] **Step 3 (Opus review):** Adversarial review of the SQL lane (logic + live-DB read-only; does not run the suite). Fix round if findings; re-validate on branch if the migration changed.
- [x] **Step 4 (orchestrator):** Commit the identical SQL that passed (`feat: add canonical job profitability schema`), push.
- [x] **Step 5 (Matt approval, then orchestrator):** Apply to production via `apply_migration`; plain-SQL post-apply catalog assertions + row counts (legacy `jobs`/`users`/`crews`/`time_entries` unchanged); `get_advisors` security read; delete the disposable branch. Record in BUILD_LOG.

### Task 2 (Session 1 Lane B — v2 Task 3): Pure job forecast and health engine

**Files:**
- Create: `web/src/lib/profitability/types.ts`
- Create: `web/src/lib/profitability/calculateJobHealth.ts`
- Create: `web/src/lib/profitability/__tests__/calculateJobHealth.test.ts`

**Interfaces:**
- Consumes: `roundToCent` from `@/lib/pricing` only. Zero DB dependency.
- Produces: `calculateJobHealth(input: JobHealthInput, now?: Date): JobHealthResult` — types verbatim from v2 lines 1016–1074; used by v2 Tasks 5, 6, 10, 15. Union names must match Task 1's SQL enums character-for-character (reviewer diff-checks).

- [x] **Step 1 (Sonnet lane, TDD):** The 9 named cases from v2 lines 1076–1086 written first and failing; implement the rules from lines 1088–1127 (health precedence, freshness windows 36h/12h/24h, confidence High/Medium/Low, `plannedProfit <= 0` → retention 0 + at_risk, overhead never inside `CategoryAmounts`); edge tests (revenue 0, null watermarks, completed-job checklist relaxation).
- [x] **Step 2:** Full web suite green (`cd web && npx vitest run`).
- [x] **Step 3 (Opus review):** Adversarial review incl. enum-name diff against Task 1's migration. Fix round if findings.
- [x] **Step 4 (orchestrator):** Commit (`feat: add deterministic job forecast and health engine`), push.

### Task 3 (Session 2 — v2 Task 2): Versioned commercial estimates and economic details

**Files:** per the v2 doc's Task 2 file list (lines 691–709), with migration prefixes per deviation 4.

**Interfaces:**
- Consumes: `computeEstimate()`, `roundToCent()`, `EstimateDraft`, `estimate_financial_details` (Task 1).
- Produces: `computeEstimateEconomics()`, `create_estimate_with_items_v2` (v1 kept during rollout), `estimate_identity_links`/`estimate_presentations`/`estimate_acceptance_events`/`estimate_acceptance_state` + `record_estimate_acceptance_event`, `presentEstimate`/`recordEstimateAcceptance`/`reverseEstimateAcceptance`, centralized `pipeline.ts` stage IDs, GHL-first prefill, category cost inputs in the builder.

- [x] **Step 1 (lanes 2a ∥ 2b ∥ 2c, Sonnet):** economics module (spec-verbatim tests first, Jorge case `$2,543.51`); migrations + pgTAP (deviations 1–4; deterministic idempotent `estimate_identity_links` backfill from the 10 `ghl_push_state` rows — disagreeing families open manual-review exceptions, never guessed); GHL pipeline/prefill.
- [x] **Step 2 (lane 2d, Sonnet, after 2a/2b/2c):** integration — draft/schema/map/repo/actions/builder wiring; `jobSpecificCosts` aggregate keeps quote math unchanged; `expectedDumpCost` defaults `dumpCount × estimated_dump_cost_per_load`, never added to the quote; `loadRatesConfig()` gains the new key. Existing `estimates.status` keeps being written in the same server actions that append acceptance events (no silent drift); the acceptance projection is the scheduling authority.

  **Review handoffs binding on lane 2d (from the 2a/2b/2c adversarial reviews, 2026-08-19):**
  1. The six new cost draft fields get `nonNegativeNumber` Zod validation, and all cost inputs are cent-rounded BEFORE calling `computeEstimateEconomics` (its inputs map 1:1 to `numeric(12,2)` columns; the derived totals are unpersisted).
  2. Clamp/reject the extreme-pct edge before insert (`planned_profit_pct` is `numeric(7,2)` — a tiny quote against a real cost overflows it).
  3. Before any `updateOpportunityStage` call, assert `opportunity.pipelineId === resolveJobPipelineStages().pipelineId` (query-string-supplied opportunities can live in other pipelines).
  4. `presentEstimate()` inserts `estimate_presentations` with `on conflict (estimate_id) do nothing` — the table is UNIQUE-per-version AND immutable, so an upsert-with-update would hit the trigger.
  5. `reverseEstimateAcceptance` must handle the RPC's raise on "no active acceptance to reverse" / "not the accepted version" deliberately (double-reverse retries now raise, not no-op).
  6. **Quote-drift surfacing (review F15):** `update_estimate_quote` (untouched legacy RPC) remains callable after acceptance, which would silently diverge `quoted_price` from the pinned `accepted_price`. 2d's quote-override server action MUST re-check `estimate_acceptance_state` and refuse the override once the family is accepted (correction path = reversal, or a change order once Task 10 exists).
  7. Live-verify at integration time: one real `fetchJobPipelineStages()` dump to settle the stage-name wording across docs, and confirm GHL's `eq` phone filter behavior against a formatted vs E.164 number.
- [x] **Step 3 (orchestrator):** Runbook cycle for both migrations on a fresh disposable branch; v2 line 976–988 test commands + full suites + `npm run build`.
- [x] **Step 4 (Opus review + fix round).**
- [x] **Step 5 (orchestrator):** Commit (`feat: version estimate economics and commercial acceptance`), push. **Deploy-order invariant:** Matt-approved prod apply of the migrations (including the rates seed) MUST precede the Vercel deploy of web code reading the new key — `loadRatesConfig()` throws on a missing key, so a web-first deploy would 500 every estimate page.

### Task 4 (Session 3 — v2 Task 4): Atomic schedule-to-job promotion

**Files:** per v2 lines 1144–1155, prefixes per deviation 4.

**Interfaces:**
- Consumes: `estimate_acceptance_state` → accepted presented estimate with financial details and no job.
- Produces: `schedule_estimate(p_estimate_id, p_schedule, p_actor, p_actor_name)` (lock, eligibility checks, mint via `next_job_number()`, jobs insert with `launch_workflow=true`, budget v1, `job_events`, `job.scheduled` + `ghl.stage.requested` outbox events, idempotent re-call returning the linked job); `scheduleEstimateAction()` + `/estimates/[id]/schedule` UI; flag-gated webhook retirement.

- [x] **Step 0 (HARD STOP check):** Matt authorized build+test pre-smoke (2026-08-19, this session, explicit). Cutover-related deploys withheld: the Task 4 prod apply and the `ghl-job-webhook` deploy are NOT done — both await Matt (see Step 4).
- [x] **Step 1 (lanes 4a ∥ 4b ∥ 4c, Sonnet):** RPC migration + pgTAP; web scheduling lib/UI against the RPC signature; `ghl-job-webhook` — Quote Accepted handler gains `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` gate (deviation 7 semantics, response `quote_accepted_awaiting_schedule` when disabled), Job Scheduled handler gains the `app_is_schedule_authority` compat response for `launch_workflow` jobs. NOTE: the "139 existing tests" figure was stale — the live suite was 193 pre-existing; all stayed green untouched, +14 new = 207 scoped.
- [x] **Step 2 (orchestrator):** Runbook cycle done (branch `v2-phase1-task4`, probes a–d FAITHFUL, RED 15/15 not-ok, GREEN **82/82**, branch deleted); scoped webhook suite 207/207; full suites deno **331/331** + web **537/537** + `npm run build` green. ⚠️ The canonical `deno task test` needed a scoped env grant (`--allow-env=ENABLE_GHL_ACCEPTANCE_JOB_CREATION` added to deno.json) — the missing grant failed all 29 handleQuoteAccepted tests with NotCapable while `--allow-all` scoped runs passed.
- [x] **Step 3 (adversarial review + fix rounds):** 4a — 2 rounds + micro round (SECURITY DEFINER→invoker; F2 moved-acceptance guard; F3 GHL ids at mint; F4 coverage; R1 dead clamp; R2 raise-text misclassification), final APPROVE. 4b — 1 round (MAJOR: schedule link trapped in `canRevise` block; server-side crew enum), APPROVE (fix verified). 4c — 1 round (flag-branched error text; comment fix), APPROVE (fix verified).
- [x] **Step 4 (orchestrator):** Committed and pushed: `d72878c` (4b), `51ad5fb` (4c + deno.json grant), `7028b63` (4a, post-GREEN per runbook step 6). **Matt approved same session ("1 and 2 approved"):** migration **APPLIED TO PRODUCTION** (head `20260819191046`, 32 applied; post-apply catalog assertions clean, row counts unchanged, zero new advisor WARNs); `ghl-job-webhook` **v20 DEPLOYED** via the two-command invariant, `verify_jwt=false` read back, flag confirmed ABSENT from prod secrets (legacy minting unchanged). Deploy probed secret-less (function-level 401 + clean logs — the GHL secret value is not in any sanctioned readable store); the **authenticated live fire (JOB-1104 re-drag per BL-5 procedure, then re-cancel) is Matt's to-do**, alongside the phone smoke + real estimate ≥1426 (Matt: to-do, NOT a blocker — but both remain required before the Phase 1 gate/cutover per ratified decision 1). **Crew decision (Matt, same session): "Jackson"/"Other" fifth option DROPPED — Crew 1–4 only** (already what 4a/4b enforce; 4b review finding 3 resolved).

### Task 5 (Session 4 — v2 Task 5A): Outbox dispatcher — outbound projections

**Files:** `supabase/migrations/20260819*_outbox_claim_rpc.sql`, `supabase/functions/integration-dispatcher/{index,handlers,handlers_test}.ts`, `supabase/functions/_shared/google.ts` (additive `updateCalendarEvent`), `supabase/migrations/20260819*_schedule_integration_dispatcher.sql`, `web/src/lib/jobs/scheduleActions.ts` + tests.

**Interfaces:**
- Consumes: pending `integration_outbox` rows (Task 1 table, Task 4 producers).
- Produces: `claim_integration_events(p_limit)` (`for update skip locked`); idempotent all-day Calendar create/update (inclusive dates → exclusive `end.date`, `extendedProperties.private.managedBy`); GHL stage projection; one crew-safe Slack schedule message; retry `min(60, 2**attempts)` minutes; dead-letter at attempt 5 + `job_alerts`; 5-min self-gating cron with `x-webhook-secret`; explicit cancel/postpone/closed-lost actions.

- [x] **Step 1 (Sonnet, TDD):** DONE 2026-08-20 — three concurrent lanes (SQL migrations ∥ dispatcher function ∥ web scheduleActions), disjoint files. 40 dispatcher tests (outbound subset incl. both named cases + cancel/config-throw/bookkeeping coverage), 19 web tests, pgTAP plan(65). Additions vs the v2 text, all orchestrator-ruled (see BUILD_LOG): `cancel_scheduled_job` RPC + `job.cancelled` event with calendar-event cleanup; claim RPC reclaims stale AND NULL-locked `processing` rows; missing crew/calendar/channel config THROWS (dead-letters loudly) instead of silently succeeding.
- [x] **Step 2 (orchestrator):** DONE — runbook cycle on branch `v2-phase1-task5a` (probes a–d FAITHFUL; RED 13/13 not-ok + documented 42883 abort; all 3 migrations applied; GREEN **65/65 first execution**; branch deleted). Full suites: deno **371/371**, web **556/556**, build green, golden-321 intact.
- [x] **Step 3 (Opus review + fix round):** DONE — SQL: approved w/ 2 Important → 1 fix round → re-review clean. FN: needs-fixes (4 Important, silent-success family) → 1 fix round → re-review all addressed. WEB: approved clean, 0 fix rounds. Deferred minors recorded in the SDD ledger + BUILD_LOG.
- [x] **Step 4a (orchestrator):** Committed and pushed (`ba8993e` web, `5cadc53`+`d24d3a0` SQL, `78b6a75`+`fb945dc` dispatcher).
- [x] **Step 4b (Matt approved same session, "go on 1 and 2"):** `integration-dispatcher` v1 DEPLOYED `--no-verify-jwt`, readback `verify_jwt: false` ✓, secret-less 401 probe clean; all 3 migrations APPLIED TO PRODUCTION (head `20260820152300`, 35 applied; cron secret substituted SERVER-SIDE from the live crew-night-before cron command — never entered the session; post-apply assertions + advisors clean, row counts unchanged); first cron fire verified. See BUILD_LOG same-session update.
- [ ] **Step 4c (still open):** live probe with a TEST job end-to-end (schedule → outbox → dispatcher → Calendar/Slack/GHL; cancel → cleanup; re-cancel hygiene). Until then every cron tick is an empty-batch no-op (outbox 0 rows).

### Task 6 (Session 5 — v2 Task 5B): Inbound Calendar sync — spike first

- [ ] **Step 1 (SPIKE, orchestrator or Sonnet):** register ONE watch channel for a test calendar against a deployed stub `google-calendar-webhook` (deployed `--no-verify-jwt` per deviation 6) and observe a real notification. If Google's domain-verification blocks edge-function URLs, STOP: 5B degrades to reconciliation-polling-only (already the spec'd fallback) — flag to Matt before building channel machinery.
- [ ] **Step 2 (Sonnet):** `calendar_watch_channels` registry migration + renewal-before-expiry + overlap dedup + reconciliation fallback poll; revision-guarded date-only inbound writes; deletion → `job_schedule_exceptions` + alert (never auto-unschedule); `resolveDeletedCalendarEvent` resolutions; the three inbound/channel test cases from the v2 list.
- [ ] **Step 3:** Runbook cycle, Opus review, commit, Matt-approved prod apply + deploy. 5B gates separately from the phase gate.

### Task 7: Phase 1 gate + permanent cutover

**Precondition (hard stop, no exceptions):** Matt's phone smoke + real estimate ≥1426.

- [ ] **Step 1:** Whole-branch adversarial Opus review (standing rule).
- [ ] **Step 2 (E2E, live GHL with TEST-labeled records — no staging GHL exists; Phase A/B precedent):** create/link opportunity → present two versions → accept v2 → confirm `Quote Accepted` + no job → schedule 2-day all-day → one `JOB-XXXX`, one budget v1, correct exclusive-end Calendar rendering, GHL `Job Scheduled` → edit dates both directions (5B live) or outbound-only (5B pending) → simulate deletion + resolve → prove retry idempotency. Re-cancel test jobs after (re-drags revive rows — known hazard).
- [ ] **Step 3 (permanent):** set `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` in prod, redeploy `ghl-job-webhook` via the invariant, live-verify a Quote Accepted drag returns `quote_accepted_awaiting_schedule` and mints nothing.
- [ ] **Step 4:** Land the session: BUILD_LOG entry (verbatim runbook records), CLAUDE.md + BUILD_PLAN.md status updates, `NEXT_SESSION_PROMPT.md` regenerated, merge per Matt's instruction.

## Risk flags

- **Google watch-channel viability is unproven** — hence the Task 6 spike before any lifecycle code.
- **`ghl-job-webhook` regression surface** (Task 4): live Phase A keystone; 139-test suite + invariant deploy + live re-drag probe gate it.
- **Two minting paths coexist between Task 4 deploy and gate flip** — by design (Matt's cutover decision). App path writes `launch_workflow=true`; rows are distinguishable and the compat check keys off it.
- **Outbox makes side effects async where Phase A was synchronous** (≤5-min cron lag) — accepted; job detail surfaces outbox status so Dane isn't blind while pending.
- Money `numeric(12,2)`; percentages whole-number unless `_rate` (decimal fraction) — the new pricing key is a per-load dollar cost, not a `_rate`.

## Verification (end-to-end)

- Per migration: runbook 8-step with verbatim BUILD_LOG record (branch id, probes a–d, red/green pgTAP, row counts, post-apply `get_advisors`).
- Per task: the v2 doc's own test commands; plus `deno task test` ≥317 and web vitest ≥261 at every close; Jorge `$2,543.51` wherever estimate code is touched.
- Phase gate: Task 7 above.

## Explicitly out of scope

v2 Tasks 6–17 (dashboard, ledger, auth'd checklists, change orders, closure, Slack digests, D1 adapter, BILL, Stripe webhook, launch). Owner promotion of Matt's `workforce_profiles` row (v2 Task 8 runbook). BL-6 echo guard (separate draft awaiting Matt's review). Removing `create_estimate_with_items` v1 (post-launch cleanup). Historical estimate import (declined 2026-08-14).
