import type { CostCategory } from "@/lib/profitability/types";

/** Discriminated override input: a labor override supplies the FULL
 *  crew-days triple (v2 Task 9 contract — "either a labor override
 *  (remainingWorkdays, expectedCrewSize, hoursPerDay) or one category
 *  ETC override"); a category override supplies one expected remaining
 *  cost. Exactly one kind per submission — one appended
 *  job_forecast_overrides row each. */
export type ForecastOverrideInput =
  | {
      kind: "labor";
      jobNumber: string;
      remainingWorkdays: number;
      expectedCrewSize: number;
      hoursPerDay: number;
      reason: string;
    }
  | {
      kind: "category";
      jobNumber: string;
      category: CostCategory;
      expectedRemainingCost: number;
      reason: string;
    };

export type ForecastOverrideValidation =
  | { ok: true; value: ForecastOverrideInput }
  | { ok: false; errors: string[] };
