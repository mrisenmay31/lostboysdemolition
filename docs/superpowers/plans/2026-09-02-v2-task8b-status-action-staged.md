# v2 Task 8b (amended) — owner job-status action + manual-phase engine rules — STAGED

> **Status: rulings recorded, plan drafted, NOT started.** Matt ruled (Session 17, 2026-09-02) that the estimate
> builder redesign builds first (`2026-09-02-estimate-builder-redesign.md`); this plan executes right after it.
> Auth dormancy (originally a lane here) moved into the redesign build (Lane A). Build Planning Rule: re-present
> the task list to Matt at dispatch (rulings and design are locked; only the dispatch is pending).

## Rulings (Matt, 2026-09-02)
1. **8b scope** = an owner/picker-side **"Mark started / Mark completed"** action on the job detail page: a status
   RPC + GHL stage projection through the existing dispatcher. Foreman area, offline queue, photos, custom SMTP,
   `submit_job_checklist`, `job.checklist.submitted` → backlog.
2. **Who enters actuals** = anyone with app access (Matt, Dane, Jackson; foremen via Dane/Jackson). Owner auth
   dormant; picker stays Dane / Jackson / Matt.
3. **Engine, manual phase** = status-aware freshness (only `in_progress`) with 7-day thresholds in one constant
   block; completed / invoiced / paid → forecast = actuals (ETC 0).
4. Ratified alongside: v2 Phases 4–6 frozen as backlog; milestone = 30 days of real jobs through the manual loop,
   then automate the most painful step (bet: BILL / Task 14, then time / Task 13).

## Design (locked)
- **Migration `job_status_transitions`**: `jobs.started_at`, `jobs.completed_at` (timestamptz);
  `advance_job_status(p_job_number text, p_target text, p_actor uuid, p_actor_name text) returns public.jobs` —
  plain INVOKER, pinned, service-role only; `select … for update`; guards with raise texts (cross-lane API):
  `advance_job_status: actor name is required` · `advance_job_status: invalid target status %` ·
  `advance_job_status: no job found for %` · `advance_job_status: job % cannot be started from status %`
  (target `in_progress` requires `scheduled`) · `advance_job_status: job % cannot be completed from status %`
  (target `completed` requires `in_progress`). Update `status_v2` + `started_at`/`completed_at` + `updated_at`
  (no trigger). `job_events` 6→7 / 7→8, `function_name 'advance_job_status'`, `trigger_source 'app_status'`
  (verified: no CHECK on that column). Outbox `ghl.stage.requested` only when `ghl_opportunity_id is not null`,
  idempotency keys `ghl.stage.requested:<job>:started` / `:completed` (non-`:rev`), stages `Job In Progress` /
  `Job Completed`. **Dispatcher needs no handler change** (`resolveStageId` substring-matches; both names unique) —
  add the two stages to `makePipelines()` in `handlers_test.ts` + two tests (copy lines 615-637).
  `action_path` fix: `create or replace` `open_category_overrun_alert` (`20260826150000:73`) and
  `mark_job_reconciliation_required` (`20260819151000:499`) with `'/jobs/' || p_job_number || '/costs'`, bodies
  otherwise byte-identical; 0 open alerts live. pgTAP suite fixture range 9500xx.
- **Web**: `web/src/lib/jobs/statusActions.ts` (mirrors `scheduleActions.ts`; codes `not_found` /
  `not_transitionable` / `invalid_input` / `other`; exported classifier), `advanceJobStatusAction(input, estimatorName)`
  picker-gated in `jobs/actions.ts` (revalidate `/jobs`, `/jobs/<n>`), `_components/JobStatusPanel.tsx` (mirrors
  `CancelJobPanel`; "Mark started" on `scheduled`, "Mark completed" on `in_progress`; `not_transitionable` →
  "This job's status changed — refresh."), page wiring (started/completed timestamps; `showCancelPanel` narrowed to
  `scheduled` because the cancel RPC never allowed in-progress cancel; the locked section-order header comment
  updated), `JOB_COLUMNS` + `JobRow` gain the two fields.
- **Engine** (`calculateJobHealth.ts`): `jobStatus ∈ {completed, invoiced, paid}` → `expectedRemainingHours = 0` and
  non-labor remaining = 0 (overrides ignored); freshness legs apply only while `in_progress`;
  `MANUAL_PHASE_FRESHNESS` block: checklist/time/expense = 168h each (automated-phase 36/12/24 recorded in the
  comment for Tasks 13/14); reason texts "within 7 days"; checklist leg reworded "Crew-days forecast (checklist or
  override) is stale or missing". `healthRepo.ts`: crew-days watermark = newer of latest checklist `submitted_at` and
  latest labor override `created_at`. `map.ts`: `export const DEFAULT_HOURS_PER_DAY = 8` replacing three literals
  (365/373/377) and page.tsx:214. Tests updated (existing 12h/24h cases re-expressed; new: scheduled + null
  watermarks → high; completed + remaining override → 0; in_progress 8-day-old → stale).
- **Lanes:** A SQL ∥ B web action ∥ D engine ∥ E dispatcher tests ∥ F docs; B consumes D's Wave-0 exports.
- **Live smoke:** TEST estimate → schedule → Mark started → `job_events` 6→7 → dispatcher attempt-1 → GHL Job In
  Progress → one cost + one revenue entry → confidence high → Mark completed → 7→8 → GHL Job Completed → forecast =
  actuals, job under the "completed" filter → re-run raises `not_transitionable`. Teardown of a completed test job
  is Matt's call (permanent residue like JOB-1107/1108, or raw-SQL cancel + hand-enqueued `job.cancelled`).
  `SLACK_TEST_CHANNEL_OVERRIDE=#ops-test` for the window, unset after.

## Backlog to record with this build
Foreman area (8b-as-specced) · `SLACK_OPS_CHANNEL` + Task 12 · cancel from `in_progress` · undo a transition ·
day-N crew reminders (`crew-night-before` selects `scheduled` only) · `job_checklists` unused · Dane's owner invite
(auth dormant) · pagination past `QUERY_ROW_CAP`.

## Exploration facts (Session 17, so nothing is re-derived)
`isStale(null) === true` (every missing watermark counts stale today) · `computeConfidence` gates only the checklist
leg on `in_progress`; time/expense legs are unconditional · no `started_at`/`completed_at` on `jobs` · line-item
immutability trigger raises on any UPDATE/DELETE · `CancelJobPanel` renders for `in_progress` but
`cancel_scheduled_job` permits `scheduled` only · `job_events.trigger_source` has no CHECK · stage integers 7/8 are
written nowhere yet (CLAUDE.md pipeline table is the source).
