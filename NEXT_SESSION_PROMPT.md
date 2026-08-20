Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are current; work from
this file**).

## What just happened — v2 Phase 1 Session 5 (2026-08-20, local): 5A probed live, 5B spike PASSED

Branch: **`claude/last-session-review-f7tqxw`** (still NOT merged to main — Matt decides when).
Read the two 2026-08-20 entries at the top of `BUILD_LOG.md` (the Session 5 entry carries both
halves of this session).

**No migrations were applied and no prod applies happened this session.** One new function was
deployed (`google-calendar-webhook` v1, the spike scaffold). Commits `1444651`, `fca739c`, pushed.

### Half 1 — Task 5A live TEST-job probe (plan Task 5, Step 4c → PARTIAL)

Ran the full chain against production: estimate 1427 (TEST) → `schedule_estimate` → **JOB-1105**
(Crew 4, 2026-12-15/16, far-future on purpose so `crew-night-before` couldn't pick it up) → outbox
→ `*/5` cron → dispatcher → Calendar + GHL → `cancel_scheduled_job` → cleanup → re-cancel.

**Proven live:** mint + budget v1 with the deviation-12 `accepted_price` pin (2044.13); both
Calendar events created and ids persisted; GHL stage projection **both** directions (Job Scheduled,
then Closed Lost (Declined)) with `sync_log app_to_ghl`; retry/backoff over two real attempts;
cancel preserving every fact; gcal ids cleared on `job.cancelled`; re-cancel raising the pinned
text, which correctly hits `classifyCancelError`'s needle (cross-lane raise-text API verified live,
not just in unit tests).

**🎁 Unprompted bonus — a Phase 1 gate item proved itself.** The dispatcher's GHL stage move fired
the REAL `Phase A: Job Created (Job Scheduled)` workflow into `ghl-job-webhook` 29 s later, and
**Task 4's `app_is_schedule_authority` compat check skipped it with zero side effects**
(`job_events`: "Skipped — app is schedule authority (launch_workflow=true)"). That guard had never
executed in production; without it there'd now be a duplicate pair of calendar events. **The plan's
"two minting paths coexist" risk flag is retired as empirically safe.**

### Half 2 — Task 5B Step 1 watch-channel spike → ✅ **PASSED, 5B is GO**

`events.watch` on the main calendar → HTTP 200; Google delivered a real `sync` notification **0.3 s
later** with `X-Goog-Channel-Token` round-tripped; channel stopped afterwards (204), nothing left
live. **The polling-only fallback is NOT needed.**

## 🚨 Hard-won facts — don't rediscover these

- 🔴 **THE SLACK BOT IS NOT IN THE CREW CHANNELS.** `Slack post failed: not_in_channel` on Crew 4.
  Diagnostic: **not** `channel_not_found` (ids are valid), **not** `missing_scope` (token is fine) —
  never invited. `sync_log direction='supabase_to_slack'` holds **10 rows in the system's entire
  history: 9 skips + ONE real post, Crew 1, 2026-08-13.** Crews 2/3/4 have never been delivered to.
  **No test could catch this** — the dispatcher's tests inject a fake `postSlackMessage` and
  `crew-night-before` has hit the "no jobs tomorrow" skip every night since 2026-08-14. A green
  suite says nothing about channel membership.
- **Google Calendar push needs NO domain verification** — the widely-cited "verify in Search
  Console + register in the GCP Push section" requirement (and the `Unauthorized WebHook callback
  channel` folklore) is **stale**; it still applies to the Drive API, which is likely the source of
  the confusion. Google's *current* official push guide says SSL only, and it is correct.
  `*.supabase.co` was accepted as-is.
- **Spike facts banked for 5B Step 2:** the notification body is **empty** (`bodyLength: 0`) — you
  MUST fetch the changed event by stored id; the channel token round-trips, so `token_hash` auth is
  viable; Google honors the requested TTL to the second, so renewal can trust the returned
  `expiration`; the notification route and admin routes need **different** auth and cannot share one
  check (Google sends no `x-webhook-secret`), and the notification route must always 200 — a non-2xx
  makes Google retry and then kill the channel.
- **Cross-lane constraint for 5B (ledger M7):** cancel does NOT bump `calendar_sync_revision`, so
  `job.scheduled:…:revN` and `job.cancelled:…:revN` share a rev and ordering falls to
  `available_at`. **The inbound revision guard must not assume rev monotonicity separates them.**
- **Server-side secret invocation recipe (reused twice now):** drive secret-gated functions from SQL
  via `net.http_post`, extracting the shared secret from the live `cron.job.command` with
  `regexp_match`. The header is built with `jsonb_build_object`, so the pattern is
  `'x-webhook-secret'\s*,\s*'([^']+)'` — **NOT** the JSON-colon shape. Secret never enters session,
  repo, or logs. Read results from `net._http_response` by request id.
- **`estimates` CHECK constraints bite:** `job_type` ∈ {Residential, Commercial}, `client_type` ∈
  {Contractor, Homeowner}, `labor_method` ∈ {total_hours, days_employees},
  `estimate_presentations.presented_via` ∈ {ghl, email, print, other}. A violation still burns the
  `estimate_number` sequence (nextval doesn't roll back).
- The MCP SQL runner returns **only the last statement's result** and runs the batch as one implicit
  transaction — a mid-batch failure rolls the whole thing back.

## 🔴 Open for Matt (both block the Phase 1 gate)

1. **Invite the Slack bot to the Crew 1–4 channels** and confirm. Cannot be done in-session (the
   Slack MCP available locally is CTA Integrity's workspace, not Lost Boys).
2. **Eyeball 2026-12-15/16 on the main and Cade/Crew-4 calendars** and confirm the probe's two
   events are gone. `deleteCalendarEvent` treats 404/410 as success so a clean return isn't proof,
   and no calendar in-session has read access to the Lost Boys calendars.
3. Standing to-dos, unchanged: phone smoke + one real estimate (**now ≥1428** — 1426 was burned by a
   failed CHECK, 1427 by the probe) on the branch preview
   https://lostboysdemolition-git-claude-la-f27ac4-matt-risenmays-projects.vercel.app; authenticated
   JOB-1104 re-drag + re-cancel; merge decision; BL-6 draft review.
4. GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv` ("TEST - 5A dispatcher probe (delete me)") sits at
   Closed Lost (Declined) — harmless. **Awaiting per-item OK to delete.**

## Next work — Task 5B Step 2 (the real inbound implementation)

A full build task on the normal gate (parallel Sonnet lanes → adversarial Opus review → runbook
cycle → Matt-approved prod apply): `calendar_watch_channels` registry migration + renewal-before-
expiry + overlap dedup by `(resource_id, event id, event updated)` + reconciliation fallback poll +
revision-guarded **date-only** inbound writes + deletion → `job_schedule_exceptions` and alert
(never auto-unschedule) + `resolveDeletedCalendarEvent`. **The deployed spike scaffold is NOT a
foundation — it has zero DB access by design and Step 2 replaces it.** Its first integration test
should pin an `exists` notification (only `sync` was observed; transport is identical).

Then Task 7 = Phase 1 gate: whole-branch review → E2E → permanent
`ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` flip → land/merge per Matt.

## Still-unproven 5A items, carried into the gate

Crew Slack delivery (blocked on #1); Calendar event *deletion* (blocked on #2); calendar
update-not-create idempotency (needs a second successful `job.scheduled`, so blocked behind Slack);
dead-letter + `job_alerts` (operator forced the row succeeded on Matt's instruction, ~3 attempts
short — `job_alerts` is still 0 rows). `postponed` cancel resolution is also unexercised,
**deliberately** — it returns GHL to Quote Accepted, which would trip the still-live legacy minting
workflow. Probe it only after the gate flag flip.

## State that hasn't changed

Production Vercel serves `main` (pre-Session-2 build), no login, network-open. Prod migration head
`20260820152300` (35 applied) — **unchanged this session**. `ghl-job-webhook` v20 (flag UNSET ⇒
legacy minting), `crew-night-before` v11, `airtable-client-sync` v29, `integration-dispatcher` v1
(cron `*/5` live), **`google-calendar-webhook` v1 (new)**. Suites: deno **382/382** (was 371),
web 556/556, golden-321 intact.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Execute from the
Phase 1 plan's checkboxes; every build task gates on adversarial review + runbook cycle + Matt's
per-task prod-apply yes. Anything applied to Supabase committed same session. BUILD_LOG entry at
every session close. Sonnet implements, the strongest available model adversarially reviews.
Concurrency REQUIRED where it doesn't impact quality/integrity. **Three functions now deploy ONLY
via the `--no-verify-jwt` + readback invariant: `ghl-job-webhook`, `integration-dispatcher`,
`google-calendar-webhook`** — and the readback should confirm the other two weren't disturbed.
Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets (names only) / People & IDs.
