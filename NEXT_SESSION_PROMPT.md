Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are current; work from
this file**).

## What just happened — v2 Phase 1 Session 4 (2026-08-20, local): Task 5A SHIPPED TO PROD (dispatcher live, cron live; TEST-job probe still owed)

Branch: **`claude/last-session-review-f7tqxw`** (still NOT merged to main — Matt decides when).
Read the 2026-08-20 Session 4 entry (incl. its same-session update) at the top of `BUILD_LOG.md`.
Headlines:

- **v2 Task 5A (outbound dispatcher) is LIVE ON PRODUCTION** (Matt approved same session): the 3
  migrations applied (head `20260820152300`, 35 applied — `claim_integration_events` w/
  NULL-locked crash recovery; `cancel_scheduled_job` w/ 5 byte-pinned raise texts +
  `job.cancelled`/`ghl.stage.requested:cancel` outbox events; `*/5` pg_cron with the secret
  substituted SERVER-SIDE from the live crew-night-before cron command — never entered the
  session), `integration-dispatcher` **v1 deployed `--no-verify-jwt`** (`verify_jwt: false` read
  back, secret-less 401 probe clean, first cron fire verified). Post-apply assertions + advisors
  clean, row counts unchanged. The outbox is 0 rows, so every cron tick is an empty-batch no-op
  until something schedules. Also on the branch: additive `updateCalendarEvent`/
  `deleteCalendarEvent` in `_shared/google.ts` and `web/src/lib/jobs/scheduleActions.ts`
  (cancel/postpone/closed-lost, `classifyCancelError`).
- Runbook: branch `v2-phase1-task5a` probes FAITHFUL, RED 13/13 not-ok, **GREEN 65/65 first
  execution**, branch deleted. Suites: deno **371/371**, web **556/556**, build green, golden-321
  intact. Commits `ba8993e, 5cadc53, 78b6a75, fb945dc, d24d3a0`, pushed.
- Review chain: WEB clean; SQL 1 fix round (fixture-scoped claim tests + pre-drain; NULL-locked
  reclaim = ruling R12); FN 1 fix round (silent-success family: skip-reason threading,
  missing-config legs now THROW, `bookkeepingError` surfacing, pipeline.ts-style stage needles +
  ambiguity guards). All re-reviews clean. Deferred minors + all rulings: SDD ledger
  `.superpowers/sdd/2026-08-19-profitability-v2-phase1/progress.md` + the BUILD_LOG entry.

## 🚨 Hard-won facts — don't rediscover these

- **The Supabase MCP SQL runner executes a batch as ONE implicit transaction returning only the
  LAST statement's result.** TAP-capture recipe (worked again this session, 65/65): strip
  begin/rollback, wrap every TAP-emitting `select` as `insert into tap_out(line) select …`, final
  `select line from tap_out order by ln`. ⚠️ New wrinkle: a mechanical wrapper also catches the
  `select` continuation of `create temporary table … as select …` — strip those two back out or
  the insert type-errors.
- **pgTAP needs `plan(N)` before any assertion even in partial RED runs** ("You tried to run a
  test without a plan!").
- `claim_integration_events` claim order is real: FOR UPDATE CTE materializes, ordering columns
  never written, re-sort reproduces claim order — verified by live EXPLAIN. `WITH ORDINALITY` is
  the right way to assert it.
- **Raise texts are a cross-lane API (again):** `cancel_scheduled_job`'s five texts are byte-pinned
  in the migration header and needle-matched by `classifyCancelError`
  (`web/src/lib/jobs/scheduleActions.ts`) — separate classifier from `classifyScheduleError`, no
  shared needles. A status LABEL can still be interpolated into the wrong-status text
  (e.g. 'accepted') — harmless only while cancel errors never route through the schedule
  classifier.
- **Cancel does NOT bump `calendar_sync_revision`** (preserves facts), so `job.scheduled:…:revN`
  and `job.cancelled:…:revN` share a rev — a backed-off `job.scheduled` retry can fire AFTER its
  own cancel; ordering falls to `available_at`. Cross-lane note for 5B's inbound logic (ledger M7).
- Dispatcher policy decisions that bind future work: missing required-leg config (crew outside
  Crew 1–4, unset `GOOGLE_CALENDAR_CREW*`/`SLACK_CREW*_CHANNEL`) THROWS → dead-letters loudly;
  outbox bookkeeping failures surface as `bookkeepingError`; unknown event types ride the normal
  retry path to dead_letter.

## 🔴 Open for Matt — Task 5A close-out

1. ✅ ~~Prod apply~~ and ✅ ~~deploy~~ — DONE 2026-08-20 (same session, Matt's "go on 1 and 2").
2. **Live probe with a TEST job** end-to-end (schedule → outbox → dispatcher → Calendar/Slack/GHL;
   cancel → event cleanup; re-cancel hygiene). This is the remaining Task 5A close-out item; a
   natural fit at the start of Session 5 or folded into the Phase 1 gate E2E.
3. Standing to-dos (unchanged, required before the Phase 1 gate): phone smoke + one real estimate
   ≥1426 on the branch preview
   https://lostboysdemolition-git-claude-la-f27ac4-matt-risenmays-projects.vercel.app; authenticated
   JOB-1104 re-drag + re-cancel; merge decision; BL-6 draft review.

## Next work — Session 5 (v2 Task 5B: inbound calendar sync)

**OPENS WITH THE WATCH-CHANNEL SPIKE** (plan Task 6 Step 1): register ONE watch channel for a test
calendar against a deployed stub `google-calendar-webhook` (deploy `--no-verify-jwt` — Google push
carries no JWT; auth = channel token). If Google blocks edge-function URLs → STOP, flag to Matt,
degrade to reconciliation-polling-only (the spec'd fallback). Only then build
`calendar_watch_channels` + renewal + overlap dedup + revision-guarded date-only inbound writes +
`job_schedule_exceptions` + `resolveDeletedCalendarEvent`. 5B gates separately from the phase gate.
Then Task 7 = Phase 1 gate (whole-branch review → E2E → permanent flag flip → land/merge per Matt).

## State that hasn't changed

Production Vercel serves `main` (pre-Session-2 build), no login, network-open. `ghl-job-webhook`
v20 (flag UNSET ⇒ legacy minting), `crew-night-before` v11, `airtable-client-sync` v29,
`integration-dispatcher` v1 (cron `*/5` live). Prod migration head `20260820152300` (35 applied).
`integration_outbox` and `job_alerts` are 0 rows on prod. Estimates ≤1425 TEST residue;
JOB-1102/1104 cancelled; 3 TEST identity-link rows. JOB-9200xx fixtures existed only on the
deleted validation branch.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Execute from the
Phase 1 plan's checkboxes; every task gates on adversarial review + runbook cycle + Matt's
per-task prod-apply yes. Anything applied to Supabase committed same session. BUILD_LOG entry at
every session close. Sonnet implements, the strongest available model adversarially reviews.
Concurrency REQUIRED where it doesn't impact quality/integrity. `ghl-job-webhook` (and now
`google-calendar-webhook` when it exists) deploy ONLY via the `--no-verify-jwt` + readback
invariant. Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets (names only) /
People & IDs.
