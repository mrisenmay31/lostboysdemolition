import { describe, expect, it } from "vitest";
import { computeEstimate } from "@/lib/pricing";

describe("pricing shim — cross-runtime contract", () => {
  it("reproduces the Jorge's Interior golden-master case under Node/Vitest", () => {
    // Same case the Deno suite pins in pricing_test.ts
    // ("total_hours method matches live record Jorge's Interior").
    const result = computeEstimate({
      laborMethod: "total_hours",
      totalJobHours: 34,
      dumpCount: 1,
      jobSpecificCosts: 0,
      markupPct: 25,
    });

    expect(result.totalBid).toBe(2543.51);
  });
});
