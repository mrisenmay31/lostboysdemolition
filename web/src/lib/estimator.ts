/** The three people allowed to create/mutate estimates. No auth — identity
 *  is self-declared via the header picker and re-validated server-side. */
export const ESTIMATORS = ["Dane", "Jackson", "Matt"] as const;
export type EstimatorName = (typeof ESTIMATORS)[number];

export function isEstimatorName(v: unknown): v is EstimatorName {
  return typeof v === "string" && (ESTIMATORS as readonly string[]).includes(v);
}

/** localStorage key the picker persists under (device-remembered). */
export const ESTIMATOR_STORAGE_KEY = "lbd-estimator";
