// ============================================================
// Lost Boys Demolition — web app — schedule-to-job promotion types
// (Phase 1, v2 Task 4 / profitability v2 Phase 1 Session 3, lane 4b)
//
// This is the web-side half of the atomic schedule-to-job promotion —
// the ONE action that mints `JOB-XXXX` (v2 doc lines 1142-1237,
// docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md;
// deviation 1 "GHL minting cutover" — see BUILD_PLAN.md / the Phase 1 plan).
// It calls `schedule_estimate(p_estimate_id, p_schedule, p_actor,
// p_actor_name)`, a Postgres RPC owned by lane 4a
// (supabase/migrations/20260819*_schedule_estimate_rpc.sql — NOT this
// file's concern) against a FIXED signature this file wires to verbatim.
// ============================================================

/** UI-facing input (camelCase) — collected by ScheduleEstimateForm,
 *  validated by validate.ts, passed to jobs/actions.ts's
 *  scheduleEstimateAction. `startDate`/`endDate` are INCLUSIVE service
 *  dates in `YYYY-MM-DD` form — the Google Calendar adapter (a later
 *  task, v2 Task 5A) is what converts them to Calendar's exclusive
 *  all-day `end.date`. Nothing in this file (or Task 4 at all) adds a
 *  day to either date. */
export interface ScheduleEstimateInput {
  estimateId: string;
  crew: string;
  startDate: string;
  endDate: string;
}

/** The 7 live `job_lifecycle` enum values (CLAUDE.md's `jobs` table entry,
 *  widened by Phase 1 plan deviation 9). Kept as a plain string union here
 *  rather than imported from @/lib/profitability/types — that module
 *  independently declares its own `JobHealthInput.jobStatus`, which is the
 *  SAME full 7-value union (kept character-identical to this one and to
 *  the `job_lifecycle` SQL enum — see that file's own doc comment), not a
 *  narrower subset. Two separate declarations of the same union, not one
 *  wider and one narrower. */
export type JobLifecycleStatus =
  | "accepted"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "invoiced"
  | "paid"
  | "cancelled";

/**
 * Normalized `jobs` row shape as returned by `schedule_estimate` (which
 * returns the created/reactivated job row per v2 doc Step 2.8, "Return
 * the created job row"). Deliberately loose/partial on fields this app
 * doesn't render yet (e.g. `gcal_main_event_id`, `bill_job_code`) — see
 * `normalizeJobRow` in repo.ts, which spreads the raw row through and
 * only coerces the numeric-over-the-wire-as-string columns this file
 * actually reads. Column set per CLAUDE.md's `jobs` table entry plus the
 * v2 Task 1 additions (`original_estimate_id`, `original_estimate_number`,
 * `current_budget_version`, `financial_status`, `launch_workflow`, …).
 */
export interface ScheduledJobRow {
  job_number: string;
  status_v2: JobLifecycleStatus | string;
  client_name: string | null;
  client_contact_name: string | null;
  business_name: string | null;
  client_type: string | null;
  client_phone: string | null;
  job_address: string | null;
  city: string | null;
  crew: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  scope_summary: string | null;
  ghl_opportunity_id: string | null;
  ghl_contact_id: string | null;
  estimate_value: number | null;
  original_estimate_id: string | null;
  original_estimate_number: number | null;
  current_budget_version: number | null;
  financial_status: string | null;
  launch_workflow: boolean | null;
  updated_at: string;
  [extra: string]: unknown;
}

/** Classification of a `schedule_estimate` RPC failure — see
 *  `classifyScheduleError` in repo.ts. Mirrors the
 *  `AcceptanceEventErrorCode` pattern in
 *  @/lib/estimates/commercialLifecycle.ts: callers (the server action,
 *  the form) must handle these deliberately rather than blindly retry,
 *  since the RPC's guard conditions (v2 doc Step 2's eligibility list)
 *  are real and permanent for the current state, not transient.
 *
 *  `already_scheduled` is the one code that is NOT necessarily an error
 *  in the ordinary sense — v2 doc Step 2 requires a repeated call for the
 *  same estimate family to "return the already linked job" rather than
 *  raise, so the RPC's happy path already covers the common case (see
 *  repo.ts's `scheduleEstimate` doc comment). This code exists for the
 *  narrower case where the RPC DOES raise on an already-scheduled family
 *  (e.g. a race between two tabs, or a caller bypassing the page's own
 *  pre-check) — repo.ts classifies that raise here so the UI can still
 *  offer a "go to the job" affordance instead of a bare error. */
export type ScheduleEstimateErrorCode =
  | "not_accepted"
  | "superseded"
  | "already_scheduled"
  | "missing_financial_details"
  | "other";

export class ScheduleEstimateError extends Error {
  code: ScheduleEstimateErrorCode;
  /** Populated only when the RPC's raise (or its message) let us recover
   *  a job number to link to — best-effort, may be null even for
   *  `already_scheduled` if the raise text carried no parseable number. */
  jobNumber: string | null;

  constructor(message: string, code: ScheduleEstimateErrorCode, jobNumber: string | null = null) {
    super(message);
    this.name = "ScheduleEstimateError";
    this.code = code;
    this.jobNumber = jobNumber;
  }
}
