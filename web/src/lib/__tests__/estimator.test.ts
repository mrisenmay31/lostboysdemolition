import { describe, expect, it } from "vitest";
import { ESTIMATORS, isEstimatorName } from "@/lib/estimator";

describe("ESTIMATORS — the allowlist trust boundary (review finding I-2a)", () => {
  it("is pinned to exactly [Dane, Jackson, Matt] — a roster edit must be a deliberate, test-visible act", () => {
    expect(ESTIMATORS).toEqual(["Dane", "Jackson", "Matt"]);
  });
});

describe("isEstimatorName", () => {
  it("accepts exactly the three estimators", () => {
    for (const name of ESTIMATORS) expect(isEstimatorName(name)).toBe(true);
  });
  it.each(["dane", "MATT", "", " Jackson", null, undefined, 3, ["Dane"]])(
    "rejects %j",
    (v) => expect(isEstimatorName(v)).toBe(false),
  );
});
