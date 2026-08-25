Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are current; work from
this file**). For Task 5B specifics also read
`docs/superpowers/plans/2026-08-24-v2-phase1-task5b-inbound-calendar-sync.md` (approved sub-plan,
9 header decisions + execution-status block).

## What just happened — Session 8 (2026-08-25): Task 5B SHIPPED TO PRODUCTION; probe half-run

Matt approved gate items 1+2 and chose `SLACK_TEST_CHANNEL_OVERRIDE` over bot invitations for the
probe. Full record: the 2026-08-25 Session 8 `BUILD_LOG.md` entry.

- **3 migrations APPLIED TO PRODUCTION** — new head **`20260825171051` (38 applied)**. Registry +
  RPCs byte-identical to the repo files; the cron migration applied with the secret substituted
  **server-side** (DO block extracting from the live `integration-dispatcher` `cron.job.command`
  — recipe now proven twice). Post-apply catalog assertions, ACLs, row counts, advisors: all
  clean. Cron `calendar-sync-maintenance @ 7,37 * * * *` live, no placeholder.
- **`google-calendar-webhook` v2 DEPLOYED** via the two-command invariant: `verify_jwt=false`
  read back, sha `93855f6d…`; `ghl-job-webhook` v20 (`1a5a340a…`) and `integration-dispatcher`
  v1 (`ae3fbf49…`) **undisturbed**. Probes: secret-less → 401; Google-style notification → 200.
- **Probe legs PROVEN LIVE:** leg 1 — 5 `active` watch channels, 7-day TTL honored, `sync`
  handshake + `last_notification_at` on all five. Leg 2 — estimate **1428** (TEST, burned) →
  **JOB-1106** (Crew 4, **2026-12-22 → 2026-12-23**), budget v1 2044.13/865/42.32 from the pinned
  `accepted_price`, dispatcher **succeeded attempt 1**: both Calendar events created (main
  `r3o9b4gkavsnv505ddi4p1ijps`, crew `hb07plhon4i2rh41o38mpgl334`) and **the FIRST successful
  dispatcher Slack delivery in system history** (#ops-test, `slack_notified_at` stamped, message
  shape verified, no pricing). Early leg 4 — Google's real `exists` push for the crew event was
  processed: token verified, event fetched, classified `dates_unchanged`, mark recorded — **echo
  termination held live**. (Only the crew-calendar mark was observed by session close; the
  main-calendar echo is expected `dates_unchanged` too and the `7,37` sweep covers it.)
- **JOB-1106 has NO GHL identity link, deliberately** — both `schedule_estimate`'s and
  `cancel_scheduled_job`'s GHL enqueues are conditional on a linked opportunity, so the probe
  created zero GHL artifacts and cannot trip the legacy-minting re-drag hazard.

## ⚠️ Live state to keep in mind

- **`SLACK_TEST_CHANNEL_OVERRIDE=C0BPPG8997Z` (#ops-test) is SET.** ALL crew Slack posts —
  dispatcher, `ghl-job-webhook`, and `crew-night-before`'s nightly digest — redirect there while
  set. **Unset it (and confirm absent — BL-4 precedent) at probe close.**
- JOB-1106 is a live `scheduled` TEST job with real events on the main + Crew-4 calendars until
  the teardown.
- **First real estimate is ≥ 1429.**
- Server-side cron-fire trick (no secret exposure): `select command into v_cmd from cron.job
  where jobname = '…'; execute v_cmd;` — used for both `maintain` and the dispatcher.

## ▶️ THIS SESSION OPENS HERE — finish the probe (legs 3/5/6)

1. **Leg 3 (inbound apply):** Matt drags/edits the **main**-calendar event "JOB-1106 – TEST - 5B
   inbound sync probe, do not action" (Dec 22–23, 2026) to different dates. Then verify:
   `exists` notification → `apply_calendar_date_change` applied, `jobs.start_date/end_date`
   updated, `calendar_sync_revision` 1→2, `job_events` row, `job.scheduled:JOB-1106:rev2` outbox
   row; force-fire the dispatcher → crew event dates mirrored (update-not-create idempotency —
   a 5A carried-over item this proves) + **a fresh Slack message in #ops-test (R7 re-notify
   semantics — expected, not a bug)**; echo chain then goes quiet (`dates_unchanged` marks).
2. **Leg 5 (deletion):** Matt deletes the **crew** (Cade/Crew-4) event. Verify: exception row
   (`kind='calendar_deleted'`) + `at_risk` alert open, job untouched. Resolve with **`dismiss`
   via direct `resolve_schedule_exception` RPC** (`/jobs/exceptions` UI is on the branch, NOT on
   prod Vercel) → event id cleared, revision bumped, dispatcher recreates the crew event.
3. **Teardown:** `cancel_scheduled_job` with **`closed_lost` ONLY** (`postponed` returns GHL to
   Quote Accepted → trips the still-live legacy minting workflow — post-flag-flip only);
   re-cancel raise check; dispatcher `job.cancelled` clears both gcal ids and deletes managed
   events (Matt eyeballs Dec 22–23 clean); **unset `SLACK_TEST_CHANNEL_OVERRIDE` + confirm
   absent**; read function logs for every leg (5A lesson). Record everything in BUILD_LOG.
4. **Then Task 7 = the Phase 1 gate:** whole-branch adversarial review → E2E per the v2 gate text
   (dates both directions now executable) → permanent `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false`
   flip → land/merge per Matt.

## Standing items (unchanged)

🔴 Slack bot invitations to Crew 1–4 (Matt-only; the override is a probe workaround, NOT the fix
— real crew delivery is still unproven and still blocks the gate). Matt's eyeball: the 5A probe's
2026-12-15/16 events deleted. Phone smoke + one real estimate (≥1429) on the branch preview.
Authenticated JOB-1104 re-drag + re-cancel. Merge decision for branch
`claude/last-session-review-f7tqxw`. BL-6 echo-guard draft review. Per-item OK to delete GHL TEST
opportunity `UuTLn5Xg2Bb9EEj4UUBv`. Dashboard-home decision (2026-08-25): `/` flip deferred to v2
Task 8; fold Dane's prototype feedback into the v2 plan before writing Task 6.

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
`integration-dispatcher` v1 (cron `*/5`), `google-calendar-webhook` **v2** (full inbound sync).
Suites at last validation: deno **411/411**, web **596/596**, golden-321 intact.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Execute from the
Phase 1 plan's checkboxes; every build task gates on adversarial review + runbook cycle + Matt's
per-task prod-apply yes. Anything applied to Supabase committed same session. BUILD_LOG entry at
every session close. Sonnet implements, the strongest available model adversarially reviews.
Concurrency REQUIRED where it doesn't impact quality/integrity. **Three functions deploy ONLY via
the `--no-verify-jwt` + readback invariant: `ghl-job-webhook`, `integration-dispatcher`,
`google-calendar-webhook`** — and the readback should confirm the other two weren't disturbed.
Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets (names only) / People & IDs.
