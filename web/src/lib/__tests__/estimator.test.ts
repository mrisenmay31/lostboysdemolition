import { describe, expect, it } from "vitest";
import { ESTIMATORS, isEstimatorName } from "@/lib/estimator";

describe("isEstimatorName", () => {
  it("accepts exactly the three estimators", () => {
    for (const name of ESTIMATORS) expect(isEstimatorName(name)).toBe(true);
  });
  it.each(["dane", "MATT", "", " Jackson", null, undefined, 3, ["Dane"]])(
    "rejects %j",
    (v) => expect(isEstimatorName(v)).toBe(false),
  );
});
