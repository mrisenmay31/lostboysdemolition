Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are current; work from
this file**). For Task 5B history also see
`docs/superpowers/plans/2026-08-24-v2-phase1-task5b-inbound-calendar-sync.md` (complete).

## What just happened — Session 10 (2026-08-25): Task 7 Step 1 DONE — whole-branch review passed

Same-day continuation of Session 9. No prod applies, no deploys, no GHL/calendar writes. Full
record: the 2026-08-25 Session 10 `BUILD_LOG.md` entry.

- **Whole-branch adversarial review (4 concurrent lanes: SQL w/ live-DB verification, edge
  functions, web, cross-task seams) over all 41 commits: MERGE-READY after one fix round — 0
  BLOCKING, 3 IMPORTANT, 17 MINOR.** Repo↔prod proven functionally identical (comment-stripped
  md5 on all 9 RPC bodies); every seam check passed (enum parity, outbox contract, raise-text
  needles verbatim, deviation-12 accepted_price pin end to end, calendar date round-trip
  symmetry, `launch_workflow` seam, 11 doc claims).
- **Fix round shipped as `604ddc5`** (web-only, nothing deployed): `presentEstimate` gained the
  missing acceptance-state guard (an accepted family could be regressed to Quote Sent + status
  mirror broken from a stale tab); `resolveJobPipelineStages()` moved inside the F2 non-fatal
  path in all three lifecycle functions and skipped on link-less reversals; two
  `classifyScheduleError` needles added / two dead ones removed; stale `jobs/types.ts` comment
  fixed. Suites post-fix: deno **411/411**, web **604/604** (+8), build green.
- **The un-fixed IMPORTANT (⚠️ needs Matt's confirm):** `mark_job_reconciliation_required()`
  enqueues outbox kind `slack_reconciliation_required` which the dispatcher does NOT handle —
  unreachable until Phase 3 (zero callers). Proposed: build the handler with the first Phase-3
  dispatcher touch instead of redeploying now.
- **Second ⚠️ confirm item (intended-behavior check):** a version accepted, then superseded by a
  never-presented draft, remains schedulable (`schedule_estimate` keys eligibility solely on
  acceptance-state currency — the migration's own documented ruling).
- Pre-gate live-state readback all clean: flag ABSENT, override ABSENT, `verify_jwt=false` ×3,
  4 crons active, 5 watch channels (earliest expiry 2026-09-01), outbox drained, 0 open alerts,
  jobs 4/4 cancelled, max estimate 1428. **First real estimate is still ≥ 1429.**

## ▶️ THIS SESSION OPENS HERE — Task 7 Steps 2–4: E2E, permanent cutover, landing

**Preconditions AMENDED by Matt 2026-08-25 (Session 10, later): ALL four Matt-only items —
Slack bot invitations, phone smoke + real estimate, authenticated JOB-1104 fire, calendar
eyeballs — are BACKLOGGED → BUILD_PLAN BL-8, and the gate proceeds without them.** Slack stays
confined to #ops-test: the Step 2 E2E sets `SLACK_TEST_CHANNEL_OVERRIDE=#ops-test` for the probe
window and unsets it at close. Consequence recorded in BL-8: until the bot is invited, real
scheduled jobs' crew-Slack legs dead-letter loudly and crews get no Slack notification. Matt's
answers on the two ⚠️ confirm items above still wanted.

1. ~~**Step 1:** Whole-branch review~~ — ✅ DONE Session 10 (see above; plan checkbox updated).
2. **Step 2 (E2E, live GHL, TEST-labeled, per-step Matt go):** create/link opportunity → present
   two versions → accept v2 → `Quote Accepted` + no job → schedule 2-day all-day → one JOB-XXXX,
   one budget v1, exclusive-end Calendar rendering, GHL `Job Scheduled` → **edit dates both
   directions (5B live)** → simulate deletion + resolve → prove retry idempotency. Re-cancel
   test jobs after (re-drags revive rows — known hazard; `closed_lost` only until the flip).
3. **Step 3 (permanent):** set `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` in prod, redeploy
   `ghl-job-webhook` via the invariant, live-verify Quote Accepted returns
   `quote_accepted_awaiting_schedule` and mints nothing. **This flip never re-enables** (ratified
   decision 1). Post-flip, `postponed` resolutions become probe-safe.
4. **Step 4:** Land: BUILD_LOG, CLAUDE.md + BUILD_PLAN.md updates, NEXT_SESSION_PROMPT
   regenerated, merge per Matt's instruction.

## Standing items

**BL-8 (backlogged 2026-08-25, no longer gate-blocking):** Slack bot invitations to Crew 1–4
(Matt-only; real crew delivery never proven — real jobs dead-letter their Slack leg until done);
calendar eyeballs 2026-12-28/29 (5B) + 2026-12-15/16 (5A); phone smoke + one real estimate
(≥1429); authenticated JOB-1104 re-drag + re-cancel. The two ⚠️ Session-10 confirm items
(slack_reconciliation_required deferral; superseded-but-accepted schedulability). Merge decision for branch
`claude/last-session-review-f7tqxw`. BL-6 echo-guard draft review. Per-item OK to delete GHL
TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv`. Dashboard-home decision (2026-08-25): `/` flip deferred
to v2 Task 8; fold Dane's prototype feedback into the v2 plan before writing Task 6.

## Deferred (fold into the next touch of each area — full ledger in the Session 10 BUILD_LOG entry)

Pre-Session-10 items: exceptions list should filter `kind='calendar_deleted'`; crew-calendar
function test; case-2 sync test hardening; registry hygiene bundle (superseded→expired,
`updated_at` bumps, `calendarKeyFor` null logging); `job_alerts.resolved_by` stamp; pgTAP M5
additions; exception-resolution `job_events` row for postponed/closed_lost; fold the inline
server action into `jobs/actions.ts`. For v2 Tasks 6/12: `calendar_watch:*` alerts have no
resolution path; `renewal_failed` channels degrade to poll-only ≤24h by design; 404/410 deletion
path re-calls its RPC every pass (benign, prune-bounded — Session 10 found the mechanism: a
fresh-timestamp mark key that can never match).

New from the Session 10 review (highlights; see BUILD_LOG for all 15 deferred minors):
`google-calendar-webhook` admin-auth `?? ""` fails open on an unset secret (align with the
dispatcher's fail-closed pattern at next deploy); `updateCalendarEvent` `res.json()` needs the
siblings' `.catch` so a non-JSON 404 still fallback-creates; `recordEstimateAcceptanceAction`
lacks Zod at the boundary; **Task 6's cancel/postpone UI server action MUST add the
estimator-allowlist gate** (`cancelScheduledJob` Zod accepts any nonblank name); comment-only
prosrc drift on 6 RPCs (re-apply repo text at next touch); `resolve_schedule_exception` pairs
alerts only under `calendar_deleted:` fingerprints; `watch_channel_status` `'expired'` has no
writer.

## State that hasn't changed

Production Vercel serves `main` (pre-Session-2 build), no login, network-open. Branch
`claude/last-session-review-f7tqxw` NOT merged to main. Live functions: `ghl-job-webhook` v20
(flag UNSET ⇒ legacy minting), `crew-night-before` v11, `airtable-client-sync` v29,
`integration-dispatcher` v1 (cron `*/5`), `google-calendar-webhook` v2 (cron `7,37`; 5 active
watch channels, expire 2026-09-01). Migration head `20260825171051`, 38 applied. Suites at last
validation: deno **411/411**, web **604/604**, golden-321 intact. `jobs` holds 4 cancelled TEST
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
