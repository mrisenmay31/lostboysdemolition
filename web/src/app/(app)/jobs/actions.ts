"use server";

import { revalidatePath } from "next/cache";
import { isEstimatorName } from "@/lib/estimator";
import { validateScheduleEstimateInput } from "@/lib/jobs/validate";
import { scheduleEstimate } from "@/lib/jobs/repo";
import { ScheduleEstimateError } from "@/lib/jobs/types";
import type { ScheduleEstimateErrorCode, ScheduledJobRow } from "@/lib/jobs/types";
import { cancelScheduledJob, CancelScheduledJobError } from "@/lib/jobs/scheduleActions";
import type { CancelJobErrorCode, CancelledJob } from "@/lib/jobs/scheduleActions";
import {
  friendlyResolveErrorMessage,
  resolveDeletedCalendarEvent,
  ResolveExceptionError,
} from "@/lib/jobs/exceptionActions";
import type {
  ResolveDeletedCalendarEventInput,
  ResolveExceptionErrorCode,
  ResolvedException,
} from "@/lib/jobs/exceptionActions";
import { resolveJobAlert } from "@/lib/jobs/alertActions";
import {
  validateCostEntryInput,
  validateCostCorrectionInput,
  validateRevenueEntryInput,
} from "@/lib/ledger/validate";
import { LedgerError } from "@/lib/ledger/types";
import type { LedgerErrorCode } from "@/lib/ledger/types";
import { createCostEntry, correctCostEntry, createRevenueEntry } from "@/lib/ledger/repo";
import type { JobCostEntryRow, JobRevenueEntryRow } from "@/lib/jobs/map";

/**
 * Server action for the atomic schedule-to-job promotion (Phase 1, v2
 * Task 4 / profitability v2 Phase 1 Session 3, lane 4b). Same
 * "these actions ARE the trust boundary in front of the service-role
 * client" pattern as @/app/(app)/estimates/actions.ts's module doc
 * comment — there is no login (see CLAUDE.md "No-login estimate tool"),
 * so `estimatorName` is a client-declared string re-validated here
 * against the fixed 3-name allowlist BEFORE anything reaches
 * @/lib/jobs/repo.ts's service-role RPC call. `p_actor` stays `null` on
 * every call (see repo.ts's scheduleEstimate doc comment) — there is no
 * `auth.users` row backing a picker name to pass instead.
 */

export type ScheduleActionResult =
  | { ok: true; job: ScheduledJobRow }
  | {
      ok: false;
      error: string;
      code?: ScheduleEstimateErrorCode;
      /** Present when the failure is (or resembles) an already-scheduled
       *  family and a job number could be recovered from the RPC's
       *  message — see repo.ts's classifyScheduleError/extractJobNumber.
       *  Lets the UI offer "go to the job" instead of a bare error. */
      jobNumber?: string | null;
      fieldErrors?: string[];
    };

/**
 * Validates the schedule form input, resolves the picker-declared actor,
 * and calls @/lib/jobs/repo.ts's scheduleEstimate. On success,
 * revalidates the estimate's own pages (its `job_number` and the
 * schedule route's "already scheduled" branch both depend on this
 * write) — there is no `/jobs/[jobNumber]` route to revalidate yet
 * (that ships in v2 Task 6), so this deliberately does not reference one.
 */
export async function scheduleEstimateAction(
  input: unknown,
  estimatorName: string,
): Promise<ScheduleActionResult> {
  if (!isEstimatorName(estimatorName)) {
    return { ok: false, error: "Pick who's estimating first." };
  }

  const validated = validateScheduleEstimateInput(input);
  if (!validated.success) {
    return {
      ok: false,
      error: validated.errors.join("; "),
      fieldErrors: validated.errors,
    };
  }

  try {
    const job = await scheduleEstimate(validated.data, null, estimatorName);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${validated.data.estimateId}`);
    revalidatePath(`/estimates/${validated.data.estimateId}/schedule`);
    return { ok: true, job };
  } catch (err) {
    if (err instanceof ScheduleEstimateError) {
      return { ok: false, error: err.message, code: err.code, jobNumber: err.jobNumber };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Cancel / resolve-exception / resolve-alert (v2 Task 6, Lane D)
//
// All three follow scheduleEstimateAction's exact shape above:
// isEstimatorName gate first (actorName never trusted from the client
// input object — always the separately-validated `estimatorName`
// argument), lib call in try/catch, typed-error mapping, revalidatePath.
// ============================================================

export type CancelJobActionResult =
  | { ok: true; job: CancelledJob }
  | { ok: false; error: string; code?: CancelJobErrorCode };

/**
 * Postpones or closed-loses an already-scheduled job via
 * @/lib/jobs/scheduleActions.ts's cancelScheduledJob. `actorName` for the
 * RPC call always comes from the validated `estimatorName` argument, not
 * `input` — `input` carries no actor field to begin with, but the point
 * holds for every action in this file: client-declared identity is never
 * trusted for attribution. Revalidates `/jobs` (the job list), the job's
 * own detail route, and `/estimates` (the originating estimate's
 * scheduled-state display depends on this job's status).
 */
export async function cancelScheduledJobAction(
  input: { jobNumber: string; resolution: "postponed" | "closed_lost"; reason: string },
  estimatorName: string,
): Promise<CancelJobActionResult> {
  if (!isEstimatorName(estimatorName)) {
    return { ok: false, error: "Pick who's estimating first." };
  }

  try {
    const job = await cancelScheduledJob({ ...input, actorName: estimatorName });
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${input.jobNumber}`);
    revalidatePath("/estimates");
    return { ok: true, job };
  } catch (err) {
    if (err instanceof CancelScheduledJobError) {
      return { ok: false, error: err.message, code: err.code };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** What the client sends — everything `resolveDeletedCalendarEvent` needs
 *  EXCEPT `actorName`, which this action supplies itself from the
 *  re-validated picker name (never trusted from the client directly).
 *  Moved here from exceptions/ResolveExceptionForm.tsx (v2 Task 6, Lane
 *  D) now that the server action itself lives in this file rather than
 *  inline in exceptions/page.tsx — the form imports this type back. */
export type ResolveExceptionActionInput = Omit<
  ResolveDeletedCalendarEventInput,
  "actorName"
>;

export type ResolveExceptionActionResult =
  | { ok: true; result: ResolvedException }
  | { ok: false; error: string; code?: ResolveExceptionErrorCode };

/**
 * Resolves an open calendar-deletion schedule exception. This is the
 * VERBATIM body of what was previously an inline "use server" action
 * defined inside exceptions/page.tsx's JobExceptionsPage component (v2
 * Task 5B Step 2) — moved here, not rewritten, now that this file is
 * in-lane for the exceptions queue too. See
 * @/lib/jobs/exceptionActions.ts's friendlyResolveErrorMessage doc
 * comment for why the raw Postgres raise text is never returned directly
 * to the client.
 */
export async function resolveExceptionAction(
  input: ResolveExceptionActionInput,
  estimatorName: string,
): Promise<ResolveExceptionActionResult> {
  if (!isEstimatorName(estimatorName)) {
    return { ok: false, error: "Pick who's estimating first." };
  }

  try {
    const result = await resolveDeletedCalendarEvent({
      ...input,
      actorName: estimatorName,
    });
    revalidatePath("/jobs/exceptions");
    return { ok: true, result };
  } catch (err) {
    if (err instanceof ResolveExceptionError) {
      return {
        ok: false,
        error: friendlyResolveErrorMessage(err.code, err.message),
        code: err.code,
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ResolveAlertActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolves one open `job_alerts` row via @/lib/jobs/alertActions.ts's
 * resolveJobAlert. No `code` field on the result — unlike its cancel /
 * resolve-exception siblings, resolveJobAlert throws only plain `Error`s
 * (see that module's doc comment), so there is no typed code to surface.
 * Revalidates `/jobs` ONLY — an alert id does not carry a job number, so
 * there is no job-detail route to target here; the detail page's own
 * refresh (if it renders alerts) is expected to come from
 * `router.refresh()` client-side, same as the exceptions queue's
 * not_open handling.
 */
export async function resolveJobAlertAction(
  input: { alertId: string; note: string },
  estimatorName: string,
): Promise<ResolveAlertActionResult> {
  if (!isEstimatorName(estimatorName)) {
    return { ok: false, error: "Pick who's estimating first." };
  }

  try {
    await resolveJobAlert({
      alertId: input.alertId,
      note: input.note,
      actorName: estimatorName,
    });
    revalidatePath("/jobs");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Manual ledger entries (v2 Task 7, Lane C)
//
// All three follow scheduleEstimateAction's exact shape at the top of
// this file: isEstimatorName gate first (estimatorName is always the
// separately-validated argument — never taken from the client `input`
// object), a validate* call next (fieldErrors on failure, the repo layer
// never touched), the repo call in try/catch, typed LedgerError `code`
// passthrough, then revalidatePath. Consumes @/lib/ledger/repo.ts's
// createCostEntry/correctCostEntry/createRevenueEntry (Task 3) against
// the fixed signatures this plan specifies: `(input, actorName) =>
// Promise<Row>`, every failure mode a thrown LedgerError.
// ============================================================

export type LedgerActionResult<T> =
  | { ok: true; entry: T }
  | { ok: false; error: string; code?: LedgerErrorCode; fieldErrors?: string[] };

/**
 * Validates a cost-entry-creation payload, then calls
 * @/lib/ledger/repo.ts's createCostEntry. Revalidates `/jobs`, the job's
 * own detail route, and its costs sub-route — the job number comes from
 * the VALIDATED INPUT here (a new cost entry always names its own
 * `jobNumber`; contrast with correctCostEntryAction below, whose input
 * carries only an entry id).
 */
export async function createCostEntryAction(
  input: unknown,
  estimatorName: string,
): Promise<LedgerActionResult<JobCostEntryRow>> {
  if (!isEstimatorName(estimatorName)) {
    return { ok: false, error: "Pick who's estimating first." };
  }

  const validated = validateCostEntryInput(input);
  if (!validated.success) {
    return {
      ok: false,
      error: validated.errors.join("; "),
      fieldErrors: validated.errors,
    };
  }

  try {
    const entry = await createCostEntry(validated.data, estimatorName);
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${validated.data.jobNumber}`);
    revalidatePath(`/jobs/${validated.data.jobNumber}/costs`);
    return { ok: true, entry };
  } catch (err) {
    if (err instanceof LedgerError) {
      return { ok: false, error: err.message, code: err.code };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Validates a cost-correction payload, then calls
 * @/lib/ledger/repo.ts's correctCostEntry. Revalidates `/jobs`, the job's
 * own detail route, and its costs sub-route using the RETURNED row's
 * `job_number` — a correction's client input carries only `entryId` and a
 * patch, never a job number, so there is nothing to revalidate against
 * until the repo call resolves.
 */
export async function correctCostEntryAction(
  input: unknown,
  estimatorName: string,
): Promise<LedgerActionResult<JobCostEntryRow>> {
  if (!isEstimatorName(estimatorName)) {
    return { ok: false, error: "Pick who's estimating first." };
  }

  const validated = validateCostCorrectionInput(input);
  if (!validated.success) {
    return {
      ok: false,
      error: validated.errors.join("; "),
      fieldErrors: validated.errors,
    };
  }

  try {
    const entry = await correctCostEntry(validated.data, estimatorName);
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${entry.job_number}`);
    revalidatePath(`/jobs/${entry.job_number}/costs`);
    return { ok: true, entry };
  } catch (err) {
    if (err instanceof LedgerError) {
      return { ok: false, error: err.message, code: err.code };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Validates a revenue-entry payload, then calls
 * @/lib/ledger/repo.ts's createRevenueEntry. Revalidates `/jobs`, the
 * job's own detail route, and its revenue sub-route — the job number
 * comes from the VALIDATED INPUT (a revenue entry always names its own
 * `jobNumber`, same as a cost-entry creation above).
 */
export async function createRevenueEntryAction(
  input: unknown,
  estimatorName: string,
): Promise<LedgerActionResult<JobRevenueEntryRow>> {
  if (!isEstimatorName(estimatorName)) {
    return { ok: false, error: "Pick who's estimating first." };
  }

  const validated = validateRevenueEntryInput(input);
  if (!validated.success) {
    return {
      ok: false,
      error: validated.errors.join("; "),
      fieldErrors: validated.errors,
    };
  }

  try {
    const entry = await createRevenueEntry(validated.data, estimatorName);
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${validated.data.jobNumber}`);
    revalidatePath(`/jobs/${validated.data.jobNumber}/revenue`);
    return { ok: true, entry };
  } catch (err) {
    if (err instanceof LedgerError) {
      return { ok: false, error: err.message, code: err.code };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
