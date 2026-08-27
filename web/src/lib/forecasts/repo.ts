import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ForecastOverrideRow } from "@/lib/jobs/map";
import type { ForecastOverrideInput } from "./types";

export class ForecastOverrideError extends Error {
  code: "unknown_job" | "insert_failed";
  constructor(code: "unknown_job" | "insert_failed", message: string) {
    super(message);
    this.name = "ForecastOverrideError";
    this.code = code;
  }
}

/**
 * Append-only insert into job_forecast_overrides (v2 Task 9). No update
 * or delete path exists by design — a wrong override is corrected by
 * appending a newer one (map.ts's pickLaborForecastSource and the
 * per-category latest-wins loop both read newest-first). RLS on the
 * table has no policies; this service-role write happens ONLY behind
 * createForecastOverrideAction's requireActiveOwner() gate.
 *
 * `created_by` carries the authenticated owner's real auth.users id —
 * the first writer in the system to do so under the post-no-login model.
 */
export async function createForecastOverride(
  input: ForecastOverrideInput,
  actor: { authUserId: string; displayName: string },
): Promise<ForecastOverrideRow> {
  const supabase = createAdminClient();
  const row = {
    job_number: input.jobNumber,
    category: input.kind === "category" ? input.category : null,
    remaining_workdays: input.kind === "labor" ? input.remainingWorkdays : null,
    expected_crew_size: input.kind === "labor" ? input.expectedCrewSize : null,
    hours_per_day: input.kind === "labor" ? input.hoursPerDay : null,
    expected_remaining_cost: input.kind === "category" ? input.expectedRemainingCost : null,
    reason: input.reason,
    created_by: actor.authUserId,
    created_by_name: actor.displayName,
  };
  const { data, error } = await supabase
    .from("job_forecast_overrides")
    .insert(row)
    .select("id, job_number, category, remaining_workdays, expected_crew_size, hours_per_day, expected_remaining_cost, reason, created_by_name, created_at")
    .single();
  if (error) {
    if (error.code === "23503") {
      throw new ForecastOverrideError("unknown_job", `No job ${input.jobNumber}.`);
    }
    throw new ForecastOverrideError("insert_failed", error.message);
  }
  return data as unknown as ForecastOverrideRow;
}
