import { describe, expect, it } from "vitest";
import { calculateJobHealth } from "@/lib/profitability/calculateJobHealth";
import type { CategoryAmounts, JobHealthInput } from "@/lib/profitability/types";

const NOW = new Date("2026-08-19T12:00:00.000Z");

function iso(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function zeroAmounts(overrides: Partial<CategoryAmounts> = {}): CategoryAmounts {
  return {
    direct_labor: 0,
    materials: 0,
    rentals: 0,
    dump: 0,
    subcontractors: 0,
    other_direct: 0,
    payment_processing: 0,
    ...overrides,
  };
}

/**
 * Fully-current baseline: all category budgets/actuals/committed zero (so
 * forecastCost defaults to 0 and forecastProfit == approvedRevenue,
 * letting most tests control retention directly via revenue/plannedProfit
 * without fighting category arithmetic), no crew-days override (falls back
 * to budgetHours - actualHours, which is 0 - 0 = 0), all three watermarks
 * fresh (1h old), zero unassigned expenses, no scope change. Each test
 * states only its deltas from this.
 */
function makeInput(overrides: Partial<JobHealthInput> = {}): JobHealthInput {
  return {
    jobStatus: "in_progress",
    financialStatus: "invoice_review",
    approvedRevenue: 10000,
    plannedProfit: 10000,
    plannedProfitPct: 100,
    budgetHours: 0,
    overheadRate: 23,
    categoryBudget: zeroAmounts(),
    approvedActual: zeroAmounts(),
    provisionalActual: zeroAmounts(),
    committed: zeroAmounts(),
    remainingCostOverrides: {},
    approvedHours: 0,
    provisionalHours: 0,
    remainingWorkdays: null,
    expectedCrewSize: null,
    hoursPerDay: 8,
    expectedRemainingLaborRate: 25,
    checklistUpdatedAt: iso(1),
    timeUpdatedAt: iso(1),
    expenseUpdatedAt: iso(1),
    unassignedExpenseCount: 0,
    unresolvedScopeChange: false,
    ...overrides,
  };
}

describe("calculateJobHealth", () => {
  it("on track with current data and 95 percent profit retention", () => {
    const result = calculateJobHealth(
      makeInput({ approvedRevenue: 9500, plannedProfit: 10000 }),
      NOW,
    );
    expect(result.forecastProfit).toBe(9500);
    expect(result.profitRetentionPct).toBe(95);
    expect(result.confidence).toBe("high");
    expect(result.health).toBe("on_track");
    expect(result.reasons[0]).toMatch(/on track/i);
  });

  it("watch at 80 percent profit retention", () => {
    const result = calculateJobHealth(
      makeInput({ approvedRevenue: 8000, plannedProfit: 10000 }),
      NOW,
    );
    expect(result.profitRetentionPct).toBe(80);
    expect(result.health).toBe("watch");
    expect(result.reasons[0]).toMatch(/80(\.0)?% of plan, below the 90% watch threshold/);
  });

  it("at risk below 75 percent profit retention", () => {
    const result = calculateJobHealth(
      makeInput({ approvedRevenue: 7000, plannedProfit: 10000 }),
      NOW,
    );
    expect(result.profitRetentionPct).toBe(70);
    expect(result.forecastProfit).toBeGreaterThan(0); // this is a retention failure, not a loss
    expect(result.health).toBe("at_risk");
    expect(result.reasons[0]).toMatch(/70(\.0)?% of plan, below the 75% at-risk threshold/);
  });

  it("negative profit is always at risk", () => {
    const result = calculateJobHealth(
      makeInput({
        approvedRevenue: 100,
        plannedProfit: 200, // positive plan — isolates the negative-forecast-profit rule
        categoryBudget: zeroAmounts({ materials: 500 }),
        committed: zeroAmounts({ materials: 500 }),
      }),
      NOW,
    );
    expect(result.forecastCategoryCost.materials).toBe(500);
    expect(result.forecastProfit).toBe(100 - 500);
    expect(result.health).toBe("at_risk");
    expect(result.reasons[0]).toMatch(/forecast profit is negative/i);
  });

  it("medium or low confidence downgrades on track to watch", () => {
    // Otherwise perfectly on-track (100% retention, no overrun, no scope
    // change) — confidence alone must be the thing that forces watch.
    const medium = calculateJobHealth(
      makeInput({ jobStatus: "scheduled", timeUpdatedAt: null }),
      NOW,
    );
    expect(medium.confidence).toBe("medium");
    expect(medium.profitRetentionPct).toBe(100);
    expect(medium.health).toBe("watch");
    expect(medium.reasons[0]).toMatch(/confidence is medium/i);

    const low = calculateJobHealth(
      makeInput({ jobStatus: "scheduled", timeUpdatedAt: null, expenseUpdatedAt: null }),
      NOW,
    );
    expect(low.confidence).toBe("low");
    expect(low.profitRetentionPct).toBe(100);
    expect(low.health).toBe("watch");
    expect(low.reasons[0]).toMatch(/confidence is low/i);
  });

  it("crew days drive remaining labor and overhead", () => {
    // budgetHours is deliberately large so the budget-diff fallback (200 -
    // 10 = 190 remaining hours) would give a very different answer than
    // the crew-days path (3 workdays * 2 crew * 8h = 48h) — proving the
    // override path is actually taken, not the fallback.
    const result = calculateJobHealth(
      makeInput({
        budgetHours: 200,
        approvedHours: 10,
        remainingWorkdays: 3,
        expectedCrewSize: 2,
        hoursPerDay: 8,
        expectedRemainingLaborRate: 25,
        overheadRate: 23,
      }),
      NOW,
    );
    // actualHours 10 + expectedRemainingHours 48 = 58
    expect(result.forecastHours).toBe(58);
    // remainingLaborCost = 48 * 25 = 1200; approved/provisional labor actuals are 0
    expect(result.forecastCategoryCost.direct_labor).toBe(1200);
    // forecastAllocatedOverhead = 58 * 23 = 1334
    expect(result.forecastAllocatedOverhead).toBe(1334);
  });

  it("nonlabor ETC defaults to unused category budget", () => {
    const result = calculateJobHealth(
      makeInput({
        categoryBudget: zeroAmounts({ materials: 1000 }),
        approvedActual: zeroAmounts({ materials: 200 }),
        provisionalActual: zeroAmounts({ materials: 100 }),
        committed: zeroAmounts({ materials: 100 }),
      }),
      NOW,
    );
    // consumed = 400, remaining = max(0, 1000 - 400) = 600, forecast = 1000
    expect(result.forecastCategoryCost.materials).toBe(1000);
  });

  it("actual plus committed above budget forecasts the overrun", () => {
    const result = calculateJobHealth(
      makeInput({
        categoryBudget: zeroAmounts({ dump: 300 }),
        approvedActual: zeroAmounts({ dump: 250 }),
        provisionalActual: zeroAmounts({ dump: 100 }),
        committed: zeroAmounts({ dump: 50 }),
      }),
      NOW,
    );
    // consumed = 400 > budget 300, remaining = max(0, -100) = 0, forecast = 400
    expect(result.forecastCategoryCost.dump).toBe(400);
  });

  it("unapproved changed scope forces watch", () => {
    const result = calculateJobHealth(
      makeInput({ unresolvedScopeChange: true }),
      NOW,
    );
    expect(result.profitRetentionPct).toBe(100);
    expect(result.confidence).toBe("high");
    expect(result.health).toBe("watch");
    expect(result.reasons[0]).toMatch(/unresolved scope change/i);
  });

  // --- Additional edge cases ---

  it("plannedProfit <= 0 forces retention 0 and at_risk without dividing by zero", () => {
    const zero = calculateJobHealth(makeInput({ plannedProfit: 0, approvedRevenue: 5000 }), NOW);
    expect(zero.profitRetentionPct).toBe(0);
    expect(zero.health).toBe("at_risk");
    expect(Number.isFinite(zero.profitRetentionPct)).toBe(true);

    const negative = calculateJobHealth(makeInput({ plannedProfit: -500, approvedRevenue: 5000 }), NOW);
    expect(negative.profitRetentionPct).toBe(0);
    expect(negative.health).toBe("at_risk");
  });

  it("approvedRevenue of 0 yields forecastProfitPct 0 rather than NaN/Infinity", () => {
    const result = calculateJobHealth(makeInput({ approvedRevenue: 0, plannedProfit: 100 }), NOW);
    expect(result.forecastProfitPct).toBe(0);
    expect(Number.isFinite(result.forecastProfitPct)).toBe(true);
  });

  it("a completed job with a stale checklist keeps high confidence — only the in-progress checklist rule counts", () => {
    const result = calculateJobHealth(
      makeInput({ jobStatus: "completed", checklistUpdatedAt: iso(1000) }),
      NOW,
    );
    expect(result.confidence).toBe("high");
    expect(result.health).toBe("on_track");
  });

  it("a null watermark counts as a failed freshness condition", () => {
    const result = calculateJobHealth(
      makeInput({ jobStatus: "in_progress", checklistUpdatedAt: null }),
      NOW,
    );
    expect(result.confidence).toBe("medium");
    expect(result.health).toBe("watch");
  });

  it("unassigned expenses alone push confidence below high", () => {
    const result = calculateJobHealth(makeInput({ unassignedExpenseCount: 3 }), NOW);
    expect(result.confidence).toBe("medium");
    expect(result.health).toBe("watch");
    expect(result.reasons.some((r) => r.includes("3 unassigned expenses"))).toBe(true);
  });

  it("forecast hours exceeding budget by more than 10 percent forces watch", () => {
    // overheadRate 0 isolates the hours-overrun rule from the overhead
    // cost that scaling forecastHours would otherwise also add.
    const result = calculateJobHealth(
      makeInput({ budgetHours: 100, approvedHours: 115, overheadRate: 0 }),
      NOW,
    );
    // actualHours 115, expectedRemainingHours = max(0, 100-115) = 0, forecastHours = 115 > 110
    expect(result.forecastHours).toBe(115);
    expect(result.health).toBe("watch");
    expect(result.reasons[0]).toMatch(/exceed budget hours/);
  });

  it("direct_labor forecast ignores any remainingCostOverrides entry for direct_labor", () => {
    // Per the contract, labor's ETC is always the crew-days/remaining-hours
    // formula — a stray override for direct_labor must not short-circuit it.
    const result = calculateJobHealth(
      makeInput({
        budgetHours: 50,
        approvedHours: 20,
        remainingCostOverrides: { direct_labor: 999999 },
        expectedRemainingLaborRate: 25,
      }),
      NOW,
    );
    // expectedRemainingHours = max(0, 50-20) = 30; remainingLaborCost = 30*25 = 750
    expect(result.forecastCategoryCost.direct_labor).toBe(750);
  });

  it("does not mutate its input", () => {
    const input = makeInput({ categoryBudget: zeroAmounts({ materials: 500 }) });
    const snapshot = JSON.parse(JSON.stringify(input));
    calculateJobHealth(input, NOW);
    expect(input).toEqual(snapshot);
  });

  // --- Fix-round additions ---

  describe("input validation (F1)", () => {
    it("throws when a non-null scalar field is non-finite (undefined masquerading as the nullable type)", () => {
      expect(() =>
        calculateJobHealth(makeInput({ expectedCrewSize: undefined as unknown as null }), NOW),
      ).toThrow(/expectedCrewSize/);
    });

    it("throws when a CategoryAmounts field is NaN, naming the offending field", () => {
      expect(() =>
        calculateJobHealth(
          makeInput({ categoryBudget: zeroAmounts({ materials: NaN }) }),
          NOW,
        ),
      ).toThrow(/categoryBudget\.materials/);
    });

    it("does NOT throw on a null remainingWorkdays/expectedCrewSize pair (the documented fallback path)", () => {
      expect(() =>
        calculateJobHealth(makeInput({ remainingWorkdays: null, expectedCrewSize: null }), NOW),
      ).not.toThrow();
    });
  });

  describe("nonlabor override guard (F2)", () => {
    it("a null remainingCostOverrides entry falls back to the budget rule instead of zeroing remaining ETC", () => {
      const result = calculateJobHealth(
        makeInput({
          categoryBudget: zeroAmounts({ materials: 1000 }),
          approvedActual: zeroAmounts({ materials: 0 }),
          remainingCostOverrides: { materials: null as unknown as number },
        }),
        NOW,
      );
      // consumed = 0, override is invalid -> remaining = max(0, 1000 - 0) = 1000, forecast = 1000
      expect(result.forecastCategoryCost.materials).toBe(1000);
    });
  });

  describe("retention boundary pins (F4)", () => {
    it("retention that pre-rounds to 74.996 rounds to exactly 75 and is watch, not at_risk", () => {
      const result = calculateJobHealth(
        makeInput({ approvedRevenue: 74996, plannedProfit: 100000 }),
        NOW,
      );
      expect(result.profitRetentionPct).toBe(75);
      expect(result.health).toBe("watch");
    });

    it("retention exactly 90 is on_track (at the watch threshold, not below it)", () => {
      const result = calculateJobHealth(
        makeInput({ approvedRevenue: 9000, plannedProfit: 10000 }),
        NOW,
      );
      expect(result.profitRetentionPct).toBe(90);
      expect(result.confidence).toBe("high");
      expect(result.health).toBe("on_track");
    });
  });

  describe("additional assertions (F5)", () => {
    it("scheduled job with a null checklistUpdatedAt and everything else current stays high/on_track", () => {
      const result = calculateJobHealth(
        makeInput({ jobStatus: "scheduled", checklistUpdatedAt: null }),
        NOW,
      );
      expect(result.confidence).toBe("high");
      expect(result.health).toBe("on_track");
    });

    it("at 70 percent retention, reasons carries no watch-threshold line (suppressed by retentionAtRisk)", () => {
      const result = calculateJobHealth(
        makeInput({ approvedRevenue: 7000, plannedProfit: 10000 }),
        NOW,
      );
      expect(result.health).toBe("at_risk");
      expect(result.reasons.some((r) => r.includes("below the 90%"))).toBe(false);
    });

    it.each(["paid", "cancelled", "invoiced"] as const)(
      "checklist staleness is ignored for jobStatus %s (only in_progress applies the checklist rule)",
      (jobStatus) => {
        const result = calculateJobHealth(
          makeInput({ jobStatus, checklistUpdatedAt: iso(1000) }),
          NOW,
        );
        expect(result.confidence).toBe("high");
        expect(result.health).toBe("on_track");
      },
    );
  });
});
