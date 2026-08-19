import { describe, expect, it } from "vitest";
import {
  validateEstimateDraft,
  validatePlannedProfitPctBounds,
  validateQuoteOverride,
} from "@/lib/estimates/validate";
import type { EstimateDraft } from "@/lib/estimates/types";

function baseQuickDraft(overrides: Partial<EstimateDraft> = {}): EstimateDraft {
  return {
    jobName: "Test Job",
    clientName: "Test Client",
    clientType: "Homeowner",
    laborMethod: "total_hours",
    totalJobHours: 20,
    dumpCount: 1,
    jobSpecificCosts: 100,
    markupPct: 25,
    materialsCost: 0,
    rentalsCost: 0,
    expectedDumpCost: 0,
    subcontractorsCost: 0,
    otherDirectCost: 0,
    expectedProcessingCost: 0,
    lineItems: [],
    ...overrides,
  };
}

describe("validateEstimateDraft — quick mode (no line items)", () => {
  it("accepts a valid total_hours draft with no line items", () => {
    const result = validateEstimateDraft(baseQuickDraft());
    expect(result.success).toBe(true);
  });

  it("accepts a valid days_employees draft with no line items", () => {
    const result = validateEstimateDraft(
      baseQuickDraft({
        laborMethod: "days_employees",
        totalJobHours: null,
        daysAtJob: 2,
        numEmployees: 3,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects total_hours draft missing totalJobHours", () => {
    const result = validateEstimateDraft(baseQuickDraft({ totalJobHours: null }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("totalJobHours"))).toBe(true);
    }
  });

  it("rejects days_employees draft missing daysAtJob or numEmployees", () => {
    const result = validateEstimateDraft(
      baseQuickDraft({ laborMethod: "days_employees", totalJobHours: null }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("daysAtJob"))).toBe(true);
      expect(result.errors.some((e) => e.includes("numEmployees"))).toBe(true);
    }
  });

  it("rejects an unknown/garbage input entirely", () => {
    const result = validateEstimateDraft({ nope: true });
    expect(result.success).toBe(false);
  });
});

describe("validateEstimateDraft — itemized-mode reconciliation", () => {
  const reconciledDraft = baseQuickDraft({
    totalJobHours: 12,
    dumpCount: 1.5,
    jobSpecificCosts: 200,
    lineItems: [
      {
        name: "Interior demo",
        laborHours: 8,
        dumpCount: 1,
        materialsCost: 50,
        sortOrder: 0,
      },
      {
        name: "Haul-off",
        laborHours: 4,
        dumpCount: 0.5,
        materialsCost: 75,
        sortOrder: 1,
      },
    ],
  });

  it("accepts a draft whose header totals exactly match the line item sums", () => {
    const result = validateEstimateDraft(reconciledDraft);
    expect(result.success).toBe(true);
  });

  it("accepts a mismatch within the 0.01 epsilon (float noise)", () => {
    const result = validateEstimateDraft({
      ...reconciledDraft,
      totalJobHours: 12.005,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when totalJobHours does not equal the sum of line item laborHours", () => {
    const result = validateEstimateDraft({ ...reconciledDraft, totalJobHours: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("totalJobHours"))).toBe(true);
    }
  });

  it("LOCK: accepts a mismatch exactly AT the 0.01 epsilon boundary", () => {
    // Math.abs(diff) > RECONCILE_EPSILON is a strict `>`, so a diff of
    // exactly 0.01 must still pass (only diffs strictly greater than 0.01
    // are rejected).
    const result = validateEstimateDraft({
      ...reconciledDraft,
      totalJobHours: reconciledDraft.totalJobHours! + 0.01,
    });
    expect(result.success).toBe(true);
  });

  it("LOCK: rejects a mismatch just OVER the 0.01 epsilon boundary (0.02 drift)", () => {
    const result = validateEstimateDraft({
      ...reconciledDraft,
      totalJobHours: reconciledDraft.totalJobHours! + 0.02,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("totalJobHours"))).toBe(true);
    }
  });

  it("rejects when dumpCount does not equal the sum of line item dumpCount", () => {
    const result = validateEstimateDraft({ ...reconciledDraft, dumpCount: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("dumpCount") && !e.includes("laborHours"))).toBe(
        true,
      );
    }
  });

  it("rejects when jobSpecificCosts is less than the sum of line item materialsCost", () => {
    const result = validateEstimateDraft({ ...reconciledDraft, jobSpecificCosts: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("jobSpecificCosts"))).toBe(true);
    }
  });

  it("accepts jobSpecificCosts strictly greater than the line item materials sum (buffer allowed)", () => {
    const result = validateEstimateDraft({ ...reconciledDraft, jobSpecificCosts: 1000 });
    expect(result.success).toBe(true);
  });
});

describe("validateEstimateDraft — HARD REQUIREMENT: negative-input rejection", () => {
  it.each([
    ["totalJobHours", { totalJobHours: -1 }],
    ["dumpCount (header)", { dumpCount: -1 }],
    ["jobSpecificCosts", { jobSpecificCosts: -1 }],
    ["markupPct", { markupPct: -1 }],
    ["quotedPrice", { quotedPrice: -1 }],
    ["materialsCost", { materialsCost: -1 }],
    ["rentalsCost", { rentalsCost: -1 }],
    ["expectedDumpCost", { expectedDumpCost: -1 }],
    ["subcontractorsCost", { subcontractorsCost: -1 }],
    ["otherDirectCost", { otherDirectCost: -1 }],
    ["expectedProcessingCost", { expectedProcessingCost: -1 }],
  ])("rejects negative header field: %s", (_label, overrides) => {
    const result = validateEstimateDraft(baseQuickDraft(overrides as Partial<EstimateDraft>));
    expect(result.success).toBe(false);
  });

  it("rejects negative daysAtJob / numEmployees in days_employees mode", () => {
    const daysResult = validateEstimateDraft(
      baseQuickDraft({
        laborMethod: "days_employees",
        totalJobHours: null,
        daysAtJob: -1,
        numEmployees: 3,
      }),
    );
    expect(daysResult.success).toBe(false);

    const empResult = validateEstimateDraft(
      baseQuickDraft({
        laborMethod: "days_employees",
        totalJobHours: null,
        daysAtJob: 2,
        numEmployees: -3,
      }),
    );
    expect(empResult.success).toBe(false);
  });

  it.each([
    ["laborHours", { laborHours: -1 }],
    ["dumpCount (line)", { dumpCount: -1 }],
    ["materialsCost", { materialsCost: -1 }],
  ])("rejects negative line item field: %s", (_label, overrides) => {
    const draft = baseQuickDraft({
      lineItems: [
        {
          name: "Bad line",
          laborHours: 1,
          dumpCount: 1,
          materialsCost: 1,
          sortOrder: 0,
          ...overrides,
        },
      ],
    });
    const result = validateEstimateDraft(draft);
    expect(result.success).toBe(false);
  });
});

describe("validateEstimateDraft — isPathB", () => {
  it("defaults isPathB to false and passes an explicit true through", () => {
    const base = baseQuickDraft();
    const result = validateEstimateDraft(base);
    expect(result.success).toBe(true);
    expect(result.success && result.data.isPathB).toBe(false);

    const trueResult = validateEstimateDraft({ ...base, isPathB: true });
    expect(trueResult.success).toBe(true);
    expect(trueResult.success && trueResult.data.isPathB).toBe(true);
  });
});

describe("validateQuoteOverride — override-reason rule", () => {
  it("passes when quotedPrice is null/undefined (no override at all)", () => {
    expect(validateQuoteOverride(null, 1000, null).ok).toBe(true);
    expect(validateQuoteOverride(undefined, 1000, undefined).ok).toBe(true);
  });

  it("passes when quotedPrice equals totalBid, regardless of reason", () => {
    expect(validateQuoteOverride(1000, 1000, null).ok).toBe(true);
    expect(validateQuoteOverride(1000, 1000, "").ok).toBe(true);
  });

  it("passes equal comparison after 2dp rounding (float noise)", () => {
    expect(validateQuoteOverride(1022.0600000001, 1022.06, null).ok).toBe(true);
  });

  it("fails when quotedPrice differs from totalBid and reason is missing/blank", () => {
    expect(validateQuoteOverride(900, 1000, null).ok).toBe(false);
    expect(validateQuoteOverride(900, 1000, undefined).ok).toBe(false);
    expect(validateQuoteOverride(900, 1000, "   ").ok).toBe(false);
  });

  it("passes when quotedPrice differs from totalBid and a non-blank reason is given", () => {
    const result = validateQuoteOverride(900, 1000, "Dane discounted for repeat client");
    expect(result.ok).toBe(true);
  });
});

describe("validatePlannedProfitPctBounds — review handoff #2 (numeric(7,2) storage bound)", () => {
  it("passes an ordinary planned profit pct", () => {
    expect(validatePlannedProfitPctBounds(28.56).ok).toBe(true);
    expect(validatePlannedProfitPctBounds(-15).ok).toBe(true);
    expect(validatePlannedProfitPctBounds(0).ok).toBe(true);
  });

  it("passes exactly at the ±99999.99 boundary", () => {
    expect(validatePlannedProfitPctBounds(99999.99).ok).toBe(true);
    expect(validatePlannedProfitPctBounds(-99999.99).ok).toBe(true);
  });

  it("rejects a value just over the boundary, with a clear error naming the value", () => {
    const result = validatePlannedProfitPctBounds(100000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("100000");
  });

  it("rejects a large negative value (a tiny quote against a real cost base)", () => {
    // e.g. a $1 quote against a $10,000 fully-loaded cost: plannedEconomicProfit
    // -9999, plannedProfitPct -999900% — a real planning scenario the numeric(7,2)
    // column simply cannot store.
    const result = validatePlannedProfitPctBounds(-999900);
    expect(result.ok).toBe(false);
  });

  it("rejects NaN/Infinity", () => {
    expect(validatePlannedProfitPctBounds(Number.NaN).ok).toBe(false);
    expect(validatePlannedProfitPctBounds(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(validatePlannedProfitPctBounds(Number.NEGATIVE_INFINITY).ok).toBe(false);
  });
});
