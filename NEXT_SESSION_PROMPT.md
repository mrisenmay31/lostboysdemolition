Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are current; work from
this file**). For Task 5B history also see
`docs/superpowers/plans/2026-08-24-v2-phase1-task5b-inbound-calendar-sync.md` (complete — all
checkboxes done, execution-status block final).

## What just happened — Session 9 (2026-08-25): 5B probe COMPLETE, Task 5B is DONE

Same-day continuation of Session 8. No code, no migrations, no deploys — probe legs 3/5/6 ran
live and everything passed. Full record: the 2026-08-25 Session 9 `BUILD_LOG.md` entry.

- **Leg 3 (inbound apply):** Matt's date drag (via the **crew** copy — accepted variance, one
  shared code path) → `apply_calendar_date_change` → JOB-1106 dates 2026-12-28→29, rev **1→2**,
  `job_events` row, `rev2` outbox → dispatcher succeeded attempt 1 with **both event ids
  unchanged — update-not-create idempotency (the 5A carried item) PROVEN** — plus the R7
  re-notify Slack message (#ops-test, log-verified, no pricing). Echo bounced once
  (`dates_unchanged` ×2) and died; the main-calendar mark doubles as proof the mirror updated
  the main event.
- **Leg 5 (deletion):** crew-event delete → `calendar_deleted` exception (full
  `previous_schedule`, cancelled resource captured) + `at_risk` alert, **job untouched**.
  `dismiss` via direct RPC → exception dismissed + alert resolved, rev **2→3**, crew id cleared,
  dispatcher **recreated** the crew event (new id `rpaopqpc…`) attempt 1; echo quiet. Note:
  Google did NOT strip `extendedProperties` on this cancelled resource — deleted-before-unmanaged
  stays a defensive ruling, not a necessity.
- **Leg 6 (teardown):** `closed_lost` cancel → rev stays 3 (**M7 rev-share observed live**:
  `job.cancelled:JOB-1106:rev3`), **no `ghl.stage.requested`** (no GHL link — zero GHL artifacts
  all probe), re-cancel raised the pinned text verbatim, dispatcher cleared both gcal ids +
  deleted both events, deletion notifications terminated in silence (cancelled job with cleared
  ids drops out of the reconcile set).
- **`SLACK_TEST_CHANNEL_OVERRIDE` UNSET + confirmed absent** (secrets-list readback, BL-4
  precedent). Crew Slack routing is back to normal — which re-exposes the 🔴 bot-membership gate
  blocker.
- No estimate burned. **First real estimate is still ≥ 1429.**

## ▶️ THIS SESSION OPENS HERE — Task 7: the Phase 1 gate + permanent cutover

Phase 1 plan Task 7, all steps. **Hard precondition before the flip: Matt's phone smoke + one
real estimate (≥1429) on the branch preview, and the 🔴 Slack bot invitations** (Matt-only; real
crew delivery has never been proven — the one Crew 1 post of 2026-08-13 predates the dispatcher).

1. **Step 1:** Whole-branch adversarial review of `claude/last-session-review-f7tqxw` (standing
   rule; strongest available model).
2. **Step 2 (E2E, live GHL, TEST-labeled):** create/link opportunity → present two versions →
   accept v2 → `Quote Accepted` + no job → schedule 2-day all-day → one JOB-XXXX, one budget v1,
   exclusive-end Calendar rendering, GHL `Job Scheduled` → **edit dates both directions (5B is
   live — both directions now executable)** → simulate deletion + resolve → prove retry
   idempotency. Re-cancel test jobs after (re-drags revive rows — known hazard; `closed_lost`
   only until the flip).
3. **Step 3 (permanent):** set `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` in prod, redeploy
   `ghl-job-webhook` via the invariant, live-verify Quote Accepted returns
   `quote_accepted_awaiting_schedule` and mints nothing. **This flip never re-enables** (ratified
   decision 1). Post-flip, `postponed` resolutions become probe-safe.
4. **Step 4:** Land: BUILD_LOG, CLAUDE.md + BUILD_PLAN.md updates, NEXT_SESSION_PROMPT
   regenerated, merge per Matt's instruction.

## Standing items

🔴 Slack bot invitations to Crew 1–4 (Matt-only; blocks the gate). Matt's calendar eyeballs:
2026-12-28/29 clean (5B teardown) + 2026-12-15/16 clean (5A) — requested at Session 9 close,
confirm/record. Phone smoke + one real estimate (≥1429) on the branch preview. Authenticated
JOB-1104 re-drag + re-cancel. Merge decision for branch `claude/last-session-review-f7tqxw`.
BL-6 echo-guard draft review. Per-item OK to delete GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv`.
Dashboard-home decision (2026-08-25): `/` flip deferred to v2 Task 8; fold Dane's prototype
feedback into the v2 plan before writing Task 6.

## Deferred (final-review-triaged FIX SOON — fold into the next touch of each area)

Exceptions list should filter `kind='calendar_deleted'`; crew-calendar function test; case-2 sync
test hardening; registry hygiene bundle (superseded→expired, `updated_at` bumps, `calendarKeyFor`
null logging); `job_alerts.resolved_by` stamp; pgTAP M5 additions; exception-resolution
`job_events` row for postponed/closed_lost; fold the inline server action into `jobs/actions.ts`.
For v2 Tasks 6/12: `calendar_watch:*` alerts have no resolution path; `renewal_failed` channels
degrade to poll-only ≤24h by design; 404/410 deletion path re-calls its RPC every pass (benign,
prune-bounded).

## State that hasn't changed

Production Vercel serves `main` (pre-Session-2 build), no login, network-open. Branch
`claude/last-session-review-f7tqxw` NOT merged to main. Live functions: `ghl-job-webhook` v20
(flag UNSET ⇒ legacy minting), `crew-night-before` v11, `airtable-client-sync` v29,
`integration-dispatcher` v1 (cron `*/5`), `google-calendar-webhook` v2 (cron `7,37`; 5 active
watch channels, expire 2026-09-01). Migration head `20260825171051`, 38 applied. Suites at last
validation: deno **411/411**, web **596/596**, golden-321 intact. `jobs` holds 4 cancelled TEST
rows (1102/1104/1105/1106). Server-side cron-fire trick (no secret exposure): `select command
into v_cmd from cron.job where jobname = '…'; execute v_cmd;`.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Execute from the
Phase 1 plan's checkboxes; every build task gates on adversarial review + runbook cycle + Matt's
per-task prod-apply yes. Anything applied to Supabase committed same session. BUILD_LOG entry at
every session close. Sonnet implements, the strongest available model adversarially reviews.
Concurrency REQUIRED where it doesn't impact quality/integrity. **Three functions deploy ONLY via
the `--no-verify-jwt` + readback invariant: `ghl-job-webhook`, `integration-dispatcher`,
`google-calendar-webhook`** — and the readback should confirm the other two weren't disturbed.
Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets (names only) / People & IDs.
