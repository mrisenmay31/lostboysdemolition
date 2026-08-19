"use server";

import { revalidatePath } from "next/cache";
import { isEstimatorName } from "@/lib/estimator";
import { validateScheduleEstimateInput } from "@/lib/jobs/validate";
import { scheduleEstimate } from "@/lib/jobs/repo";
import { ScheduleEstimateError } from "@/lib/jobs/types";
import type { ScheduleEstimateErrorCode, ScheduledJobRow } from "@/lib/jobs/types";

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
