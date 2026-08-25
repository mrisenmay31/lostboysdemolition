Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract; **Phase 2 is the active phase**). For what Phase 1
shipped, `docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` is COMPLETE (all
checkboxes done; its deviations 1–12 and review-handoff blocks remain the authority for the
shipped surface) — read it for reference, not for work.

## What just happened — Session 10 (2026-08-25): TASK 7 CLOSED, MERGED, DEPLOYED — v2 PHASE 1 IS COMPLETE

Full record: the 2026-08-25 Session 10 `BUILD_LOG.md` entry (four parts: whole-branch review,
BL-8 amendment, E2E + permanent cutover, merge + deploy verification).

- **Whole-branch review MERGE-READY** (4 lanes, 41 commits, 0 blocking; 2 IMPORTANT fixed in
  `604ddc5`; repo↔prod proven functionally identical). Matt confirmed two review escalations:
  the dispatcher's missing `slack_reconciliation_required` handler is DEFERRED to the first
  Phase-3 dispatcher touch (Phase-3 obligation — see Deferred), and superseded-but-accepted
  schedulability is intended behavior.
- **Gate E2E PASSED** (estimate 1429 v1→v2 → **JOB-1107**, Crew 2): deviation-12 `accepted_price`
  pin verified live end to end into budget v1; both negative raises verbatim; dispatcher
  attempt-1 everywhere; echo `dates_unchanged` on both calendars (= exclusive-end round-trip
  proof); **reactivation FIRST-PROVEN** (cancel → re-schedule new dates → same job, rev 1→2, no
  second budget); clean teardown. Physical calendar drag/delete legs stand on Session 9's
  same-day live proof (BL-8; the in-session Google connector has no ACL on the five group
  calendars).
- **THE PERMANENT CUTOVER IS LIVE:** `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` set,
  `ghl-job-webhook` **v25** deployed via the invariant. Live-verified through the REAL GHL
  workflow (dispatcher-driven Quote Accepted stage move on the 5A TEST opportunity → 200
  `quote_accepted_awaiting_schedule`, skipped audit rows, NOTHING minted; opportunity restored
  to Closed Lost). **App scheduling (`schedule_estimate`) is the SOLE job-minting path;
  `postponed` resolutions are now probe-safe; never re-enables (ratified decision 1).**
- **MERGED TO MAIN + DEPLOYED:** fast-forward `4dd15cc..2085f42` (+ docs `58928c3`); production
  Vercel deploy VERIFIED READY at https://lostboysdemolition.vercel.app — `/` 307→`/estimates`
  (pre-Task-8 decision), `/estimates` and `/jobs/exceptions` 200. The Phase 1 web surface
  (economics inputs, present/accept/reverse lifecycle UI, `/estimates/[id]/schedule`,
  `/jobs/exceptions`) is live, network-open, no login.
- `SLACK_TEST_CHANNEL_OVERRIDE` unset + confirmed absent. **First real estimate is ≥ 1430**
  (`estimate_number_seq` last_value 1429). `jobs` = 5 cancelled TEST rows (1102/1104/1105/1106/
  1107).

## ▶️ THIS SESSION OPENS HERE — v2 Phase 2

1. **Reconcile Dane's Job Dashboard prototype feedback into the v2 plan BEFORE writing Task 6**
   (standing note since 2026-08-25). Prototype: branch `codex/job-dashboard-prototype` @
   `c2e117a`, draft PR #2, published for Dane at the private artifact
   https://claude.ai/code/artifact/b4b07754-5c34-463f-86e5-800cbc54a0f9. It will now conflict
   with main in `BUILD_LOG.md` when merged (main moved past its base). Ratified prototype
   decisions that must survive into Task 6: no "portfolio" terminology; `payment_processing` is
   a capture-only category (below Gross Profit, not in Total Direct).
2. **Then the v2 Phase 2 task sequence per the program doc** — Task 6 builds the dashboard at
   `/jobs` + an "Estimates" nav link (the `/` flip to the dashboard defers to Task 8, owner
   auth — 2026-08-25 amendment in BUILD_PLAN). Standard execution model applies: plan → Matt
   approval → concurrent Sonnet lanes → adversarial review per task → runbook cycle for any
   migration → Matt's per-task prod-apply yes.

## Standing items

**BL-8 (backlogged 2026-08-25, not gate-blocking):** Slack bot invitations to Crew 1–4
(Matt-only; until done, each REAL scheduled job's crew-Slack leg dead-letters loudly with a
`job_alerts` row — calendars/GHL unaffected — and crews get NO Slack notification; all Slack
testing stays in #ops-test); phone smoke + one real estimate (≥1430) through the now-live
production builder; authenticated JOB-1104 re-drag + re-cancel; calendar eyeballs 2026-12-15/16
+ 2026-12-28/29. Per-item OK to delete GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv` (finished at
Closed Lost (Declined)). BL-6 echo-guard design draft awaiting Matt's review
(`docs/superpowers/plans/2026-08-18-bl6-echo-guard-design-DRAFT.md`).

## Deferred (fold into the next touch of each area — full ledger in the Session 10 BUILD_LOG entry)

**Phase-3 obligation (Matt-confirmed):** build the dispatcher's `slack_reconciliation_required`
handler with the first Phase-3 task that touches `integration-dispatcher` —
`mark_job_reconciliation_required()` (zero callers until Phase 3) enqueues a kind the dispatcher
dead-letters today.
**For v2 Task 6 specifically:** the cancel/postpone UI's wrapping server action MUST add the
estimator-allowlist gate (`cancelScheduledJob`'s Zod accepts any nonblank `actorName`);
exceptions list should filter `kind='calendar_deleted'`; `calendar_watch:*` alerts have no
resolution path; fold the inline exceptions server action into `jobs/actions.ts`.
Other: `google-calendar-webhook` at next deploy — admin-auth `?? ""` fails open on an unset
secret (align with the dispatcher's fail-closed `!` pattern), and the 404/410 deletion branch's
mark dedup never matches (benign every-pass RPC re-call, prune-bounded); `updateCalendarEvent`
`res.json()` needs the siblings' `.catch` so a non-JSON 404 still fallback-creates;
`recordEstimateAcceptanceAction` lacks Zod at the boundary; comment-only prosrc drift on 6 RPCs
(re-apply repo text at next touch); `resolve_schedule_exception` pairs alerts only under
`calendar_deleted:` fingerprints; `watch_channel_status` `'expired'` has no writer; registry
hygiene bundle; `job_alerts.resolved_by` stamp; pgTAP M5 additions; exception-resolution
`job_events` row for postponed/closed_lost; crew-calendar function test; case-2 sync test
hardening; `renewal_failed` degrades to poll-only ≤24h by design. E2E choreography note:
estimate 1429 v1's `status='sent'` hop was a direct UPDATE (no mutations-audit row for it).

## State

**main == production everywhere.** Production Vercel serves main (`58928c3` line) at
https://lostboysdemolition.vercel.app — Phase 1 web code live, no login, network-open. Branch
`claude/last-session-review-f7tqxw` fully merged (kept on origin; safe to delete only with
Matt's per-item OK). Live functions: `ghl-job-webhook` **v25** (flag=`false`, permanent cutover
live), `crew-night-before` (v11 line), `airtable-client-sync` (v29 line),
`integration-dispatcher` (v1 line, cron `*/5`), `google-calendar-webhook` (v2 line, cron
`7,37`; 5 watch channels, expire 2026-09-01, cron-renewed). Version counters read higher than
line numbers — cosmetic CLI bumps; verify by sha. Migration head `20260825171051`, 38 applied
(Task 7 shipped no migrations). Suites at close: deno **411/411** (golden-321 intact), web
**604/604**, `npm run build` green. Outbox drained; 0 open exceptions/alerts; secrets:
`ENABLE_GHL_ACCEPTANCE_JOB_CREATION` present (=false), `SLACK_TEST_CHANNEL_OVERRIDE` absent.
Recipes: server-side cron-fire `select command into v_cmd from cron.job where jobname='…';
execute v_cmd;` — the POST leaves the DB only at COMMIT, so check outbox status from the NEXT
statement batch; manual `integration_outbox` inserts need `aggregate_type`/`aggregate_id`
(`'job'`/job number); crafted `ghl.stage.requested` outbox rows are a credential-free GHL
actuator (dispatcher holds the credentials).

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Every build task
gates on adversarial review + runbook cycle + Matt's per-task prod-apply yes. Anything applied
to Supabase committed same session. BUILD_LOG entry at every session close. Sonnet implements,
the strongest available model adversarially reviews. Concurrency REQUIRED where it doesn't
impact quality/integrity; plans are written for concurrent lanes up front. **Three functions
deploy ONLY via the `--no-verify-jwt` + readback invariant: `ghl-job-webhook`,
`integration-dispatcher`, `google-calendar-webhook`** — readback confirms the other two
undisturbed (by sha, not version counter). Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field
Registry / Secrets (names only) / People & IDs.
