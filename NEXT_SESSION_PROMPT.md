Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are current; work from
this file**). For Task 5B specifics also read
`docs/superpowers/plans/2026-08-24-v2-phase1-task5b-inbound-calendar-sync.md` (approved sub-plan,
9 header decisions + execution-status block).

## What just happened — v2 Phase 1 Session 6 (2026-08-24): Task 5B Step 2 BUILT AND FULLY REVIEWED, stopped at the Matt gate

Branch: **`claude/last-session-review-f7tqxw`** (still NOT merged to main — Matt decides when).
Commits `cf240a2..8553aa2` (7), pushed. **NO migrations applied to prod, NO deploys, NO
GHL/Calendar/Slack traffic this session.** Read the 2026-08-24 `BUILD_LOG.md` entry — it carries
the verbatim runbook record and the full review chain.

**Built on the branch (deploy-ready, NOT live):**
- 3 migrations: `20260824150000_calendar_watch_registry` (registry + `calendar_inbound_marks`
  dedup keyed on **calendar_id**, `job_schedule_exceptions_one_open` partial unique, sync_log
  direction widened with `'google_to_supabase'`), `20260824151000_calendar_inbound_rpcs`
  (`apply_calendar_date_change` / `open_calendar_deletion_exception` /
  `resolve_schedule_exception`, 8 byte-pinned raise texts, M7 benign skips), `20260824152000`
  (cron `calendar-sync-maintenance` `7,37 * * * *`, `__WEBHOOK_SECRET__` placeholder). pgTAP
  plan(147), branch-validated RED 32/32 → GREEN 147/147 first execution.
- `google-calendar-webhook` REWRITE (replaces the deployed v1 spike at deploy time): token-hash
  notification auth, always-200 rule, one shared push/poll reconcile path, channel lifecycle
  (7-day TTL, renew <24h, register-before-stop), per-calendar failure isolation, marks recorded
  only AFTER a completed RPC outcome. 40 Deno tests; full `deno task test` **411/411**.
- `/jobs/exceptions` + `exceptionActions.ts` (`resolveDeletedCalendarEvent` keyed on
  `exceptionId` — recorded deviation from the v2 spec's `jobNumber`). 40 web tests; full suite
  **596/596**; build green. No pricing on the page (final-review-swept).

**Two ruled plan amendments (binding, in the sub-plan's execution-status block):**
`dismiss` on a non-scheduled job = acknowledge-and-close (exception + alert closed, ZERO
jobs/outbox writes — this is how a stuck exception on a moved-on job gets closed); comparator
checks `deleted` before `unmanaged`.

## 🚨 Hard-won facts — don't rediscover these

- **A mirrored inbound date change PINGS THE CREW SLACK CHANNEL** (R7 reschedule semantics, plan
  decision 3, final-review-verified single-fire). Matt should know before the probe: dragging
  dates on the calendar now messages the crew.
- **The mirror loop provably terminates**: dates-equal echo check runs BEFORE the revision guard
  in both TS and SQL; the dispatcher's stale guard can never skip the mirror of an applied change.
- **Rev-scoped idempotency keys are collision-free** across all four outbox writers
  (schedule_estimate, cancel_scheduled_job, apply_calendar_date_change,
  resolve_schedule_exception) — every rev bump happens under the jobs row lock in the same
  transaction as the insert; cancel's shared-rev M7 case is separated by event-type prefix.
- **`resource_id` is reassigned on channel renewal** — that's WHY `calendar_inbound_marks` dedups
  on `calendar_id`. Don't "fix" it back to the spec's literal tuple.
- The Session-3 tap_out recipe scales to a 147-assertion suite in one implicit transaction
  (fixtures commit to the disposable branch — fine, branch gets deleted).
- A `cd web` persists across Bash calls and silently empties a repo-root-relative path-filtered
  `git diff` — a 7-line review package is a symptom, not a small diff.

## 🔴 The Matt gate (Task 5B Step 3 remainder — per-item approval required)

1. **Prod apply** the 3 migrations (EXACT repo files; cron secret substituted server-side from the
   live `cron.job.command` via the `regexp_match` recipe — pattern `'x-webhook-secret'\s*,\s*'([^']+)'`),
   then post-apply catalog assertions + row counts + `get_advisors`.
2. **Deploy** `google-calendar-webhook` via the two-command `--no-verify-jwt` invariant; readback
   must show `verify_jwt=false` AND `ghl-job-webhook`/`integration-dispatcher` sha-undisturbed.
3. **Live probe** (sub-plan Task 4 Step 5): PREREQUISITE = Slack bot invited to Crew 1–4 (or
   `SLACK_TEST_CHANNEL_OVERRIDE` to a channel the bot is in); **`closed_lost` teardown only**
   (postponed returns GHL to Quote Accepted → trips the still-live legacy minting workflow); the
   probe burns one estimate number.
4. Standing items unchanged: bot invitations + 2026-12-15/16 calendar eyeball (both still block
   the Phase 1 gate); phone smoke + one real estimate on the branch preview; authenticated
   JOB-1104 re-drag + re-cancel; merge decision; BL-6 draft review; per-item OK to delete GHL TEST
   opportunity `UuTLn5Xg2Bb9EEj4UUBv`.

## Then: Task 7 = Phase 1 gate

Whole-branch review → E2E (v2 gate text: present two versions, accept v2, schedule 2-day all-day,
edit dates both directions — now executable once 5B is live — simulate deletion + resolve, prove
retry idempotency) → permanent `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` flip → land/merge per
Matt.

## Deferred (final-review-triaged FIX SOON — fold into the next touch of each area)

Exceptions list should filter `kind='calendar_deleted'`; crew-calendar function test; case-2 sync
test hardening; registry hygiene bundle (superseded→expired, `updated_at` bumps, `calendarKeyFor`
null logging); `job_alerts.resolved_by` stamp; pgTAP M5 additions; exception-resolution
`job_events` row for postponed/closed_lost; fold the inline server action into `jobs/actions.ts`.
For v2 Tasks 6/12: `calendar_watch:*` alerts have no resolution path; `renewal_failed` channels
degrade to poll-only ≤24h by design; 404/410 deletion path re-calls its RPC every pass (benign,
prune-bounded).

## State that hasn't changed

Production Vercel serves `main` (pre-Session-2 build), no login, network-open. Prod migration head
`20260820152300` (35 applied) — **unchanged this session**. Live functions: `ghl-job-webhook` v20
(flag UNSET ⇒ legacy minting), `crew-night-before` v11, `airtable-client-sync` v29,
`integration-dispatcher` v1 (cron `*/5`), `google-calendar-webhook` v1 (still the spike). Suites at
close: deno **411/411**, web **596/596**, golden-321 intact. First real estimate still ≥1428.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Execute from the
Phase 1 plan's checkboxes; every build task gates on adversarial review + runbook cycle + Matt's
per-task prod-apply yes. Anything applied to Supabase committed same session. BUILD_LOG entry at
every session close. Sonnet implements, the strongest available model adversarially reviews.
Concurrency REQUIRED where it doesn't impact quality/integrity. **Three functions deploy ONLY via
the `--no-verify-jwt` + readback invariant: `ghl-job-webhook`, `integration-dispatcher`,
`google-calendar-webhook`** — and the readback should confirm the other two weren't disturbed.
Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets (names only) / People & IDs.
