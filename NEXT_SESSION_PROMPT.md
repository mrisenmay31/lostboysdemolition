Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the Phase 1 execution plan —
now COMPLETE through Task 7; its deviations 1–12 and review-handoff blocks remain the authority
for what shipped).

## What just happened — Session 10 (2026-08-25): TASK 7 COMPLETE — THE PHASE 1 GATE IS PASSED

Full record: the 2026-08-25 Session 10 `BUILD_LOG.md` entry (three parts: review, BL-8
amendment, E2E + cutover).

- **Step 1 — whole-branch adversarial review: MERGE-READY** (4 lanes over all 41 commits; 0
  blocking; 2 IMPORTANT fixed in `604ddc5`; repo↔prod proven functionally identical; deferral
  ledger in the entry). Two Matt confirms recorded: the `slack_reconciliation_required`
  dispatcher handler is DEFERRED to the first Phase-3 dispatcher touch; superseded-but-accepted
  schedulability is CONFIRMED intended.
- **BL-8 amendment (Matt):** Slack bot invitations, phone smoke + real estimate, authenticated
  JOB-1104 fire, and calendar eyeballs all moved to backlog; gate proceeded without them; all
  Slack testing stays in #ops-test until the bot is invited.
- **Step 2 — gate E2E PASSED** (server-side choreography, Slack via #ops-test override, unset +
  confirmed absent at close): estimate 1429 v1→v2 (present both, accept v2, `accepted_price`
  $2,432.25 pinned server-side, no job at acceptance, negative raises verbatim) →
  `schedule_estimate` → **JOB-1107** (Crew 2 — first exercise; budget v1 from the pin;
  idempotent re-call proven) → dispatcher attempt-1 everywhere → echo `dates_unchanged` both
  calendars (= exclusive-end round-trip proof) → **reactivation FIRST-PROVEN** (cancel →
  re-schedule new dates → same job, rev 1→2, no second budget) → teardown, M7 rev-share,
  re-cancel raise verbatim, outbox drained, 0 exceptions/alerts. Physical drag/delete legs
  stand on Session 9's same-day live proof (BL-8; connector has no group-calendar ACL).
- **Step 3 — THE PERMANENT CUTOVER IS LIVE:** `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` set,
  `ghl-job-webhook` **v25** deployed via the invariant (`verify_jwt=false` read back, siblings'
  shas undisturbed; own sha change explained — 5A-era `_shared/google.ts` addition in the
  bundle). Live-verified through the REAL GHL workflow: Quote Accepted → 200
  `quote_accepted_awaiting_schedule`, sync_log/job_events skipped rows, **nothing minted**;
  TEST opportunity restored to Closed Lost. **App scheduling is the SOLE minting path;
  `postponed` resolutions are now probe-safe. Never re-enables (ratified decision 1).**
- **First real estimate is now ≥ 1430** (1429 burned by the gate E2E). `jobs` holds 5 cancelled
  TEST rows (1102/1104/1105/1106/1107).

## ▶️ THIS SESSION OPENS HERE

1. **Merge decision (the one remaining Task 7 item):** branch `claude/last-session-review-f7tqxw`
   → main, per Matt's instruction. Note the dashboard-prototype branch note: merging alongside
   `codex/job-dashboard-prototype` conflicts in `BUILD_LOG.md` only. After merge, production
   Vercel picks up the branch's web code (prod serves `main`) — the estimate tool gains the
   economics inputs, lifecycle UI, schedule flow, and `/jobs/exceptions`.
2. **Then v2 Phase 2** per the program doc — starting with reconciling Dane's dashboard-prototype
   feedback into the v2 plan before writing Task 6 (standing note), and the Phase-2 task
   sequence from the v2 doc.

## Standing items

**BL-8 (backlogged, no longer gate-blocking):** Slack bot invitations to Crew 1–4 (Matt-only;
real crew-channel delivery never proven — until done, each real scheduled job's Slack leg
dead-letters loudly with an alert; calendars/GHL unaffected); phone smoke + one real estimate
(≥1430); authenticated JOB-1104 re-drag + re-cancel; calendar eyeballs 2026-12-15/16 +
2026-12-28/29 (JOB-1107's 2027-01-18/19 events were dispatcher-deleted at teardown — eyeball
optional). Merge decision (above). BL-6 echo-guard draft review. Per-item OK to delete GHL TEST
opportunity `UuTLn5Xg2Bb9EEj4UUBv`. Dashboard-home decision: `/` flip deferred to v2 Task 8;
Task 6 builds `/jobs` + an Estimates nav link only.

## Deferred (fold into the next touch of each area — full ledger in the Session 10 BUILD_LOG entry)

**Phase-3 obligation (Matt-confirmed deferral):** build the dispatcher's
`slack_reconciliation_required` handler with the first Phase-3 task that touches the dispatcher
— `mark_job_reconciliation_required()` enqueues a kind the dispatcher can't process today.
Pre-Session-10 items: exceptions list should filter `kind='calendar_deleted'`; crew-calendar
function test; case-2 sync test hardening; registry hygiene bundle; `job_alerts.resolved_by`
stamp; pgTAP M5 additions; exception-resolution `job_events` row for postponed/closed_lost; fold
the inline server action into `jobs/actions.ts`; `calendar_watch:*` alerts have no resolution
path; `renewal_failed` degrades to poll-only ≤24h by design; 404/410 deletion path re-calls its
RPC every pass (benign, prune-bounded — mechanism: fresh-timestamp mark key never matches).
Session-10 review minors: `google-calendar-webhook` admin-auth `?? ""` fails open on unset
secret (align with dispatcher's fail-closed pattern at next deploy); `updateCalendarEvent`
`res.json()` needs the siblings' `.catch`; `recordEstimateAcceptanceAction` lacks Zod at the
boundary; **Task 6's cancel/postpone UI server action MUST add the estimator-allowlist gate**;
comment-only prosrc drift on 6 RPCs; `resolve_schedule_exception` pairs alerts only under
`calendar_deleted:` fingerprints; `watch_channel_status` `'expired'` has no writer. E2E
choreography note: 1429 v1's `status='sent'` hop was a direct UPDATE (no mutations-audit row).

## State

Production Vercel serves `main` (pre-Phase-1 web build until merge), no login, network-open.
Branch `claude/last-session-review-f7tqxw` NOT merged (44 commits ahead at session close). Live
functions: `ghl-job-webhook` **v25** (flag SET `false` — permanent cutover live),
`crew-night-before` v11-line, `airtable-client-sync` v29-line, `integration-dispatcher` v1-line
(cron `*/5`), `google-calendar-webhook` v2-line (cron `7,37`; 5 watch channels, expire
2026-09-01, cron-renewed). Version counters read higher (cosmetic CLI bumps — check shas).
Migration head `20260825171051`, 38 applied — Task 7 shipped NO migrations. Suites: deno
**411/411** (golden-321 intact), web **604/604**, build green. Outbox drained; 0 open
exceptions/alerts; secrets: `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` present (=false),
`SLACK_TEST_CHANNEL_OVERRIDE` absent. Server-side cron-fire trick: `select command into v_cmd
from cron.job where jobname='…'; execute v_cmd;` — the POST leaves the DB only at COMMIT, so
check outbox status from the NEXT statement batch. `integration_outbox` manual inserts need
`aggregate_type`/`aggregate_id`.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Every build task
gates on adversarial review + runbook cycle + Matt's per-task prod-apply yes. Anything applied
to Supabase committed same session. BUILD_LOG entry at every session close. Sonnet implements,
the strongest available model adversarially reviews. Concurrency REQUIRED where it doesn't
impact quality/integrity. **Three functions deploy ONLY via the `--no-verify-jwt` + readback
invariant: `ghl-job-webhook`, `integration-dispatcher`, `google-calendar-webhook`** — readback
confirms the other two undisturbed (sha, not version counter). Pipeline Reference base
`appA7uj7FhnPp9Bvg` = Field Registry / Secrets (names only) / People & IDs.
