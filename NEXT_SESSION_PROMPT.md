Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract; **Phase 2 is the active phase, Task 6 done, Task 7
next**). For what Task 6 shipped, `docs/superpowers/plans/2026-08-26-v2-task6-job-dashboard.md`
is the executed implementation plan (its Global Constraints — the locked `payment_processing`
presentation above all — bind Task 7's rendering too).

## What just happened — Session 11 (2026-08-26): v2 TASK 6 SHIPPED — the Job Dashboard is LIVE

Full record: the 2026-08-26 Session 11 `BUILD_LOG.md` entry.

- **Phase 2 opened with the reconciliation commit** (`c3d4e48` on main): the two ratified
  2026-08-21 prototype decisions (no "portfolio"; `payment_processing` capture-only presentation)
  were ported from the prototype branch into main's v2 plan — main's copy had never received
  them. **Dane's prototype feedback has still NOT arrived** (the artifact has zero comment
  threads); Matt ruled Task 6 proceeds on the ratified decisions — reconcile Dane's feedback
  into the v2 plan whenever it lands.
- **v2 Task 6 built, reviewed, MERGED (`c3d4e48..5663a46`, pushed), production deploy VERIFIED:**
  `/jobs` (Job Dashboard — six status filters, health cards, exceptions banner, "Jobs" nav) and
  `/jobs/[jobNumber]` (profitability detail — locked comparison presentation, honest-null
  rendering, labor productivity variance with rate-variance honestly deferred to Task 13,
  cancel/postpone UI behind the estimator gate, alert resolution, audit timeline) are **LIVE at
  https://lostboysdemolition.vercel.app**. `/` still 307→`/estimates` — the flip is Task 8's.
- New modules: `web/src/lib/jobs/map.ts` (pure math — the locked chain is single-sourced here,
  payment_processing exclusion proof-tested) and `web/src/lib/jobs/healthRepo.ts`
  (batched reads → `calculateJobHealth`; `job_forecast_snapshots` persisted only on detail reads
  when input watermarks change; **`QUERY_ROW_CAP=1000` sentinel THROWS on PostgREST's silent
  row cap** — pagination deliberately deferred to Phase C volumes).
- Session-10 deferral items discharged: exceptions server action folded into `jobs/actions.ts`;
  estimator-allowlist gate on `cancelScheduledJobAction`; `listOpenScheduleExceptions` filters
  `kind='calendar_deleted'`; `resolveJobAlertAction`/`alertActions.ts` give every open alert
  (incl. `calendar_watch:*`) a resolution path — `resolved_by` stays null under no-login, actor
  stamped into `resolution_note` as `[Name] note`.
- Review record: 5 task gates + final whole-branch review (strongest model), one fix wave
  (`995dc55`: locked "Processing Fees" label, Denver timestamps on `incurred_at`/`occurred_at`,
  lint hygiene, banner copy, "Cancelled" spelling), scoped re-reviews all clean. Live-proven:
  all six filters 200 (first live run of the `.not-in` completed-filter form), JOB-1107's
  budget-v1 chain cross-checks to the cent (1,717.25 − 460.00 − 82.25 = 1,175.00), snapshot
  invariant held (zero rows written by cancelled-job renders), unknown job → 404.

## ▶️ THIS SESSION OPENS HERE — v2 Task 7 (manual profitability, completes Phase 2)

1. **v2 Task 7 — manual cost, commitment, and revenue capture** per the program doc
   (`lib/ledger/*`, `/jobs/[jobNumber]/costs` + `/revenue` forms, `correct_job_cost_entry`
   audited corrections, alert on category overrun, revalidate after writes). Standard model:
   plan → Matt approval → concurrent lanes → adversarial review per task → Matt's merge yes.
   Note Task 7's routes nest under Task 6's `[jobNumber]` directory; its entries feed the
   already-live health engine and comparison table (states: provisional/committed/approved/void;
   `source_system='manual'`, server-generated `source_record_id`).
2. **Phase 2 gate** (after Task 7): on a staged scheduled job, enter manual labor/materials/
   rental/dump/subcontractor/other-direct/processing/invoice/credit/refund/payment facts; Dane
   sees original/current/actual+committed/forecast, health/confidence, leading variance, audit
   detail. Existing quote golden tests unchanged.
3. **Whenever Dane's dashboard feedback arrives:** reconcile it into the v2 plan doc first;
   it may amend the shipped Task 6 surface.

## Carried into Task 7/9/13 briefs (from Task 6's final review — do not lose)

- **Task 9 (forecast overrides UI):** Zod-reject empty-string numeric inputs at the boundary
  (`coerceNullableNum("")` → 0, not null); require positive `hours_per_day`/`expected_crew_size`.
- **Task 9/13:** zero-divisor guard for crew-days (`hours_per_day=0` → Infinity today; no writer
  exists yet).
- A hypothetical legacy `status_v2='invoiced'` row matches no dashboard filter (invisible, not
  mis-ranked) — no v2 writer produces it; revisit only if one surfaces.
- Deferred minors triaged OK-TO-DEFER live in the SDD ledger:
  `.superpowers/sdd/2026-08-26-v2-task6-job-dashboard/progress.md` (git-ignored scratch, KEPT —
  delete only with Matt's per-item OK).

## Standing items

**BL-8 (unchanged, Matt-only):** Slack bot invitations to Crew 1–4 (until done, real jobs'
crew-Slack legs dead-letter loudly and crews get NO Slack; all Slack testing stays in #ops-test);
phone smoke + one real estimate (≥1430) — **the phone smoke now also covers the dashboard's
390px eyeball** (mobile stacking is markup-verified only; the build env's window min ~1300px);
authenticated JOB-1104 re-drag + re-cancel; calendar eyeballs 2026-12-15/16 + 2026-12-28/29.
Per-item OK to delete GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv`. BL-6 echo-guard design draft
still awaiting Matt's review. **Phase-3 obligation:** build the dispatcher's
`slack_reconciliation_required` handler at the first Phase-3 dispatcher touch.

## State

**main == production everywhere.** Production Vercel serves main (`5663a46`) at
https://lostboysdemolition.vercel.app — Phase 1 web surface + the Task 6 Job Dashboard live,
no login, network-open. Branch `claude/v2-task6-job-dashboard` fully merged (kept; delete only
with Matt's per-item OK). Live functions unchanged this session (nothing deployed to Supabase):
`ghl-job-webhook` v25 (flag=false permanent), `crew-night-before` v11 line,
`airtable-client-sync` v29 line, `integration-dispatcher` v1 line (cron `*/5`),
`google-calendar-webhook` v2 line (cron `7,37`; watch channels cron-renewed). Migration head
unchanged `20260825171051` (38 applied — Task 6 shipped no migrations). Suites at close: web
**650/650**, deno **411/411** (golden-321 intact), lint 0 errors/1 pre-existing warning,
`npm run build` green. `jobs` = 5 cancelled TEST rows; `job_forecast_snapshots` 0 rows (by
design — cancelled jobs are never engine-scored); 0 open alerts/exceptions; first real estimate
still ≥1430.

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
