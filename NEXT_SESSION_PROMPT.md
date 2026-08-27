Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract; **PHASE 2 IS COMPLETE — the Phase 2 gate PASSED
2026-08-27; Phase 3 opens on Tasks 8 + 9**). Executed implementation plans:
`docs/superpowers/plans/2026-08-26-v2-task6-job-dashboard.md` (Task 6) and
`docs/superpowers/plans/2026-08-26-v2-task7-manual-ledger.md` (Task 7 — its Design decisions
section is the canonical record of the ledger's locked conventions).

## What just happened — Session 13 (2026-08-27): THE PHASE 2 GATE IS PASSED

Full record: the 2026-08-27 Session 13 `BUILD_LOG.md` entry.

- **Full gate E2E on estimate 1430 → JOB-1108, Matt phone-driving every app screen** (first
  phone-driven probe; chips at BL-8's phone smoke). All 11 manual facts, two live corrections
  (note preservation + quantity-only patch proven through the real UI), comparison table to the
  cent, 6 predicted overrun alerts (processing correctly none), health/confidence/leading variance
  on card + banner, dispatcher attempt-1 both directions, Slack to #ops-test confirmed, clean
  `closed_lost` teardown, override UNSET + confirmed absent, golden 411/411.
- **Gate finding fixed + deployed mid-gate:** `job_cost_entry_audit` had NO UI surface ("full
  audit detail" clause failed on first check). Branch `claude/gate-audit-render` (Sonnet build,
  adversarial review caught void-vs-amount title priority defect, fix round) merged fast-forward
  `01d48a3..91a5531`, Vercel deploy verified, rendering live-verified against JOB-1108's real
  audit rows (`Audit (3)`, newest-first interleave, review-locked title priority: void > amount >
  state > generic). Web tests 728→**758**.
- **Two gate findings BACKLOGGED (Matt's call, not scheduled):** (1) overrun alert `action_path`
  self-links to `/jobs/<job>` — "Open" appears dead; should be `/jobs/<job>/costs`; one-line RPC
  migration + runbook cycle at the next migration window. (2) Costs-screen edit discoverability —
  "Add cost entries" link + per-entry "Correct / void" disclosures don't advertise editing.

## ▶️ THIS SESSION OPENS HERE — v2 Phase 3

1. **Task 8** — owner auth via `workforce_profiles` (owner promotion runbook — the backfilled
   Matt row is still `role='pending'`/`active=false` by design), owner-gate the financial routes,
   flip `/` to the Job Dashboard (authenticated active owner → `/jobs`, everyone else →
   `/estimates`; the no-login estimator picker flow stays reachable). Standard model: plan → Matt
   approval → concurrent lanes → adversarial review per task → Matt's gates.
2. **Task 9** — forecast overrides UI. Its brief MUST Zod-reject empty-string numerics
   (`z.number()` only) and require positive `hours_per_day`/`expected_crew_size`; Tasks 9/13 both
   need the crew-days zero-divisor guard.
3. **Phase-3 obligation:** build the dispatcher's `slack_reconciliation_required` handler at the
   first Phase-3 dispatcher touch.
4. **Whenever Dane's dashboard feedback arrives** (artifact still has zero comments): reconcile it
   into the v2 plan first; it may amend the shipped Task 6/7 surfaces.

## Standing items

**BL-8 (Matt-only):** Slack bot invitations to Crew 1–4 (until done, real jobs' crew-Slack legs
dead-letter loudly and crews get NO Slack; all Slack testing stays in #ops-test); rest of the
phone smoke + one real estimate (**now ≥1431** — 1430 burned by the Phase 2 gate);
authenticated JOB-1104 re-drag + re-cancel; calendar eyeballs 2026-12-15/16 + 2026-12-28/29.
**Backlogged gate findings:** alert `action_path` self-link (RPC migration); costs-edit
discoverability (UX). **Per-item cleanup DONE at Session 13 close (Matt's approvals):** the three
merged task branches, both task worktrees, and the two Task 6/7 SDD scratch ledgers are deleted;
**Matt ruled the JOB-1107 + JOB-1108 DB residue is KEPT permanently** (cancelled TEST rows;
JOB-1108's rows are the only real example data on the audit timeline + ledger screens until real
jobs flow — do not re-ask). Only remaining per-item OK: delete GHL TEST opportunity
`UuTLn5Xg2Bb9EEj4UUBv`. BL-6 echo-guard design draft still awaiting Matt's review. **Accepted minors
from Task 7's reviews** (ledgered in the SDD scratch): $0-budget categories alert on their first
entry (CONFIRMED live at the gate — 4 of the 6 alerts; revisit if annoying); stale-tab un-void via
the correction form's seeded `state`; no double-submit idempotency on manual create; overrun can
under-fire under concurrent same-category inserts (self-heals).

## State

**main == production everywhere.** Production Vercel serves main (`91a5531`) at
https://lostboysdemolition.vercel.app — estimate builder + Phase 1 surface + Job Dashboard +
ledger screens + **audit-history rendering (new this session)**, no login, network-open. `/`
still 307→`/estimates` (the flip is Task 8's). Live functions unchanged (nothing deployed to
Supabase functions this session): `ghl-job-webhook` v25 (flag=false permanent),
`crew-night-before` v11 line, `airtable-client-sync` v29 line, `integration-dispatcher` v1 line
(cron `*/5`), `google-calendar-webhook` v2 line (cron `7,37`). **Migration head `20260826180811`
(39 applied — no migrations this session).** Suites at close: web **758/758**, deno **411/411**
(golden-321 intact), lint 0 errors/1 pre-existing warning, build green. `jobs` = 6 cancelled TEST
rows (JOB-1108 new); JOB-1108 residue: 7 cost entries, 2 audit rows, 4 revenue rows (net $850),
5 forecast snapshots, 6 resolved alerts. 0 open alerts/exceptions; outbox drained; 5 calendar
channels active. `SLACK_TEST_CHANNEL_OVERRIDE` ABSENT. First real estimate ≥1431.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Every build task
gates on adversarial review (+ runbook cycle for any migration) + Matt's per-task prod-apply/merge
yes. Anything applied to Supabase committed same session. BUILD_LOG entry at every session close.
Sonnet implements, the strongest available model adversarially reviews. Concurrency REQUIRED
where it doesn't impact quality/integrity; plans are written for concurrent lanes up front.
**Three functions deploy ONLY via the `--no-verify-jwt` + readback invariant: `ghl-job-webhook`,
`integration-dispatcher`, `google-calendar-webhook`** — readback confirms the other two
undisturbed (by sha, not version counter). Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field
Registry / Secrets (names only) / People & IDs.
