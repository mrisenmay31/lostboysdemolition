import { describe, expect, it } from "vitest";

// PURE module under test — no "server-only" stub needed (see map.ts's
// module header): unlike repo.test.ts / scheduleActions.test.ts, this
// file imports no Supabase admin client and mocks nothing.
import {
  budgetToCategoryAmounts,
  buildFinancialComparison,
  buildJobHealthInput,
  crewDaysRemaining,
  emptyCategoryAmounts,
  normalizeBudgetRow,
  normalizeCostEntryRow,
  rollupLedger,
  statusSortRank,
  watermarksEqual,
  type ForecastOverrideRow,
  type JobBudgetVersionRow,
  type JobCostEntryRow,
  type JobRevenueEntryRow,
  type JobRow,
  type SnapshotWatermarks,
} from "../map";
import type { JobHealthInput, JobHealthResult } from "@/lib/profitability/types";

// ---- shared fixture factories -------------------------------------------

function makeBudgetRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b1",
    job_number: "JOB-1",
    version: 1,
    source_estimate_id: null,
    source_change_order_version_id: null,
    approved_revenue: 2500,
    productive_hours: 40,
    direct_labor_cost: 1000,
    materials_cost: 200,
    rentals_cost: 50,
    dump_cost: 300,
    subcontractors_cost: 100,
    other_direct_cost: 50,
    allocated_overhead: 230,
    payment_processing_cost: 86.01,
    planned_economic_profit: 483.99,
    planned_profit_pct: 19.36,
    overhead_rate: 23,
    labor_rate: 26,
    created_by_name: "Dane",
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeBudget(overrides: Partial<JobBudgetVersionRow> = {}): JobBudgetVersionRow {
  return { ...(makeBudgetRaw() as unknown as JobBudgetVersionRow), ...overrides };
}

function costEntry(overrides: Partial<JobCostEntryRow>): JobCostEntryRow {
  return {
    id: "id",
    job_number: "JOB-1",
    category: "materials",
    state: "approved",
    reconciliation_state: "matched",
    amount: 0,
    quantity: null,
    employee_name: null,
    vendor_name: null,
    incurred_at: "2026-08-01T00:00:00Z",
    source_system: "manual",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    job_number: "JOB-1",
    status_v2: "in_progress",
    financial_status: "not_ready",
    client_name: "Acme Co",
    client_contact_name: null,
    business_name: null,
    client_type: "commercial",
    client_phone: null,
    job_address: "123 Main St",
    city: "Ogden",
    crew: "Crew 1",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    start_time: null,
    scope_summary: null,
    original_estimate_id: null,
    original_estimate_number: null,
    current_budget_version: 1,
    cancelled_at: null,
    cancellation_reason: null,
    last_forecast_at: null,
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeOverride(overrides: Partial<ForecastOverrideRow>): ForecastOverrideRow {
  return {
    id: "o",
    job_number: "JOB-1",
    category: null,
    remaining_workdays: null,
    expected_crew_size: null,
    hours_per_day: null,
    expected_remaining_cost: null,
    reason: "adjustment",
    created_by_name: "Dane",
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeHealthResult(forecastHours: number): JobHealthResult {
  return {
    health: "on_track",
    confidence: "high",
    forecastHours,
    forecastCategoryCost: emptyCategoryAmounts(),
    forecastAllocatedOverhead: 0,
    forecastCost: 0,
    forecastProfit: 0,
    forecastProfitPct: 0,
    profitRetentionPct: 100,
    reasons: [],
  };
}

function makeHealthInput(overrides: Partial<JobHealthInput> = {}): JobHealthInput {
  return {
    jobStatus: "in_progress",
    financialStatus: "not_ready",
    approvedRevenue: 0,
    plannedProfit: 0,
    plannedProfitPct: 0,
    budgetHours: 0,
    overheadRate: 0,
    categoryBudget: emptyCategoryAmounts(),
    approvedActual: emptyCategoryAmounts(),
    provisionalActual: emptyCategoryAmounts(),
    committed: emptyCategoryAmounts(),
    remainingCostOverrides: {},
    approvedHours: 0,
    provisionalHours: 0,
    remainingWorkdays: null,
    expectedCrewSize: null,
    hoursPerDay: 8,
    expectedRemainingLaborRate: 0,
    checklistUpdatedAt: null,
    timeUpdatedAt: null,
    expenseUpdatedAt: null,
    unassignedExpenseCount: 0,
    unresolvedScopeChange: false,
    ...overrides,
  };
}

// ---- 1. numeric-string coercion -----------------------------------------

describe("normalizeBudgetRow / normalizeCostEntryRow — numeric-string coercion", () => {
  it("coerces numeric-string budget columns to numbers", () => {
    const budget = normalizeBudgetRow(makeBudgetRaw({ approved_revenue: "2543.51" }));
    expect(budget.approved_revenue).toBe(2543.51);
    expect(typeof budget.approved_revenue).toBe("number");
  });

  it("coerces numeric-string cost-entry quantity to a number", () => {
    const entry = normalizeCostEntryRow({
      id: "c1",
      job_number: "JOB-1",
      category: "direct_labor",
      state: "approved",
      reconciliation_state: "matched",
      amount: "150.00",
      quantity: "34.00",
      employee_name: "Nick",
      vendor_name: null,
      incurred_at: "2026-08-01T00:00:00Z",
      source_system: "manual",
      updated_at: "2026-08-01T00:00:00Z",
    });
    expect(entry.quantity).toBe(34);
    expect(entry.amount).toBe(150);
  });

  it("leaves a null quantity as null", () => {
    const entry = normalizeCostEntryRow({
      id: "c2",
      job_number: "JOB-1",
      category: "dump",
      state: "approved",
      reconciliation_state: "matched",
      amount: "300.00",
      quantity: null,
      employee_name: null,
      vendor_name: "Acme Dump",
      incurred_at: "2026-08-01T00:00:00Z",
      source_system: "manual",
      updated_at: "2026-08-01T00:00:00Z",
    });
    expect(entry.quantity).toBeNull();
  });
});

// ---- 2. rollupLedger ------------------------------------------------------

describe("rollupLedger", () => {
  it("buckets by state, skips void and excluded rows entirely, and picks separate watermarks for labor vs non-labor", () => {
    const entries: JobCostEntryRow[] = [
      costEntry({ id: "e1", state: "approved", category: "direct_labor", amount: 100, quantity: 5, updated_at: "2026-08-01T10:00:00Z" }),
      costEntry({ id: "e2", state: "provisional", category: "direct_labor", amount: 50, quantity: 3, updated_at: "2026-08-02T10:00:00Z" }),
      costEntry({ id: "e3", state: "committed", category: "direct_labor", amount: 20, quantity: 2, updated_at: "2026-08-03T10:00:00Z" }),
      costEntry({ id: "e4", state: "approved", category: "dump", amount: 300, updated_at: "2026-08-01T09:00:00Z", reconciliation_state: "needs_review" }),
      costEntry({ id: "e5", state: "provisional", category: "materials", amount: 75, updated_at: "2026-08-04T09:00:00Z" }),
      costEntry({ id: "e6", state: "committed", category: "dump", amount: 60, updated_at: "2026-08-02T09:00:00Z" }),
      // void — must be skipped entirely, even though it carries the latest labor timestamp.
      costEntry({ id: "e7", state: "void", category: "direct_labor", amount: 999, quantity: 999, updated_at: "2026-08-05T00:00:00Z" }),
      // reconciliation_state excluded — must be skipped entirely, even though it carries the latest non-labor timestamp.
      costEntry({ id: "e8", state: "approved", category: "materials", amount: 500, updated_at: "2026-08-06T00:00:00Z", reconciliation_state: "excluded" }),
    ];

    const result = rollupLedger(entries);

    expect(result.approved).toEqual({
      direct_labor: 100,
      materials: 0,
      rentals: 0,
      dump: 300,
      subcontractors: 0,
      other_direct: 0,
      payment_processing: 0,
    });
    expect(result.provisional.direct_labor).toBe(50);
    expect(result.provisional.materials).toBe(75);
    expect(result.committed.direct_labor).toBe(20);
    expect(result.committed.dump).toBe(60);

    expect(result.approvedHours).toBe(5);
    expect(result.provisionalHours).toBe(3);

    // Void row (08-05) excluded from labor watermark; committed e3 (08-03) wins.
    expect(result.timeUpdatedAt).toBe("2026-08-03T10:00:00Z");
    // Excluded row (08-06) excluded from expense watermark; provisional e5 (08-04) wins.
    expect(result.expenseUpdatedAt).toBe("2026-08-04T09:00:00Z");

    expect(result.needsReviewCount).toBe(1);
  });
});

// ---- 3. budgetToCategoryAmounts -------------------------------------------

describe("budgetToCategoryAmounts", () => {
  it("maps all 7 budget columns to CategoryAmounts and never surfaces allocated_overhead", () => {
    const budget = makeBudget({
      direct_labor_cost: 111,
      materials_cost: 22,
      rentals_cost: 33,
      dump_cost: 44,
      subcontractors_cost: 55,
      other_direct_cost: 66,
      payment_processing_cost: 77,
      allocated_overhead: 999,
    });

    const amounts = budgetToCategoryAmounts(budget);

    expect(amounts).toEqual({
      direct_labor: 111,
      materials: 22,
      rentals: 33,
      dump: 44,
      subcontractors: 55,
      other_direct: 66,
      payment_processing: 77,
    });
    expect(Object.values(amounts)).not.toContain(999);
  });
});

// ---- 4. buildJobHealthInput ------------------------------------------------

describe("buildJobHealthInput", () => {
  it("labor override newer than checklist wins the workday/crew/hours triple, and per-category overrides keep only the latest row per category", () => {
    const overrides: ForecastOverrideRow[] = [
      // newest first, per the interface's documented ordering
      makeOverride({ id: "o4", category: null, remaining_workdays: 3, expected_crew_size: 2, hours_per_day: 6, created_at: "2026-08-20T00:00:00Z" }),
      makeOverride({ id: "o3", category: "dump", expected_remaining_cost: 120, created_at: "2026-08-19T00:00:00Z" }),
      makeOverride({ id: "o2", category: "materials", expected_remaining_cost: 80, created_at: "2026-08-18T00:00:00Z" }),
      // older dump override — must be ignored in favor of o3.
      makeOverride({ id: "o1", category: "dump", expected_remaining_cost: 999, created_at: "2026-08-01T00:00:00Z" }),
    ];

    const input = buildJobHealthInput({
      job: makeJobRow({ status_v2: "in_progress", financial_status: "invoice_review" }),
      currentBudget: makeBudget(),
      ledger: {
        approved: emptyCategoryAmounts(),
        provisional: emptyCategoryAmounts(),
        committed: emptyCategoryAmounts(),
        approvedHours: 10,
        provisionalHours: 5,
        timeUpdatedAt: "2026-08-10T00:00:00Z",
        expenseUpdatedAt: "2026-08-11T00:00:00Z",
        needsReviewCount: 2,
      },
      overrides,
      latestChecklistSubmittedAt: "2026-08-10T00:00:00Z", // older than the labor override
      latestChecklist: { remaining_workdays: 10, expected_crew_size: 4, hours_per_day: 8 },
      unresolvedScopeChange: true,
    });

    expect(input.remainingWorkdays).toBe(3);
    expect(input.expectedCrewSize).toBe(2);
    expect(input.hoursPerDay).toBe(6);
    expect(input.remainingCostOverrides).toEqual({ dump: 120, materials: 80 });

    // Other locked mappings, spot-checked.
    expect(input.approvedRevenue).toBe(2500);
    expect(input.plannedProfit).toBe(483.99);
    expect(input.plannedProfitPct).toBe(19.36);
    expect(input.budgetHours).toBe(40);
    expect(input.overheadRate).toBe(23);
    expect(input.expectedRemainingLaborRate).toBe(26);
    expect(input.approvedHours).toBe(10);
    expect(input.provisionalHours).toBe(5);
    expect(input.timeUpdatedAt).toBe("2026-08-10T00:00:00Z");
    expect(input.expenseUpdatedAt).toBe("2026-08-11T00:00:00Z");
    expect(input.unassignedExpenseCount).toBe(2);
    expect(input.checklistUpdatedAt).toBe("2026-08-10T00:00:00Z");
    expect(input.jobStatus).toBe("in_progress");
    expect(input.financialStatus).toBe("invoice_review");
    expect(input.unresolvedScopeChange).toBe(true);
  });

  it("falls back to the checklist when it is newer than the labor override", () => {
    const overrides: ForecastOverrideRow[] = [
      makeOverride({ id: "o1", category: null, remaining_workdays: 9, expected_crew_size: 1, hours_per_day: 4, created_at: "2026-08-01T00:00:00Z" }),
    ];

    const input = buildJobHealthInput({
      job: makeJobRow(),
      currentBudget: makeBudget(),
      ledger: {
        approved: emptyCategoryAmounts(),
        provisional: emptyCategoryAmounts(),
        committed: emptyCategoryAmounts(),
        approvedHours: 0,
        provisionalHours: 0,
        timeUpdatedAt: null,
        expenseUpdatedAt: null,
        needsReviewCount: 0,
      },
      overrides,
      latestChecklistSubmittedAt: "2026-08-15T00:00:00Z", // newer than the override
      latestChecklist: { remaining_workdays: 10, expected_crew_size: 4, hours_per_day: 8 },
      unresolvedScopeChange: false,
    });

    expect(input.remainingWorkdays).toBe(10);
    expect(input.expectedCrewSize).toBe(4);
    expect(input.hoursPerDay).toBe(8);
  });

  it("with no checklist and no override, defaults remainingWorkdays/expectedCrewSize to null and hoursPerDay to 8", () => {
    const input = buildJobHealthInput({
      job: makeJobRow(),
      currentBudget: makeBudget(),
      ledger: {
        approved: emptyCategoryAmounts(),
        provisional: emptyCategoryAmounts(),
        committed: emptyCategoryAmounts(),
        approvedHours: 0,
        provisionalHours: 0,
        timeUpdatedAt: null,
        expenseUpdatedAt: null,
        needsReviewCount: 0,
      },
      overrides: [],
      latestChecklistSubmittedAt: null,
      latestChecklist: null,
      unresolvedScopeChange: false,
    });

    expect(input.remainingWorkdays).toBeNull();
    expect(input.expectedCrewSize).toBeNull();
    expect(input.hoursPerDay).toBe(8);
    expect(input.remainingCostOverrides).toEqual({});
  });

  // Postgres `numeric` columns (job_forecast_overrides.expected_remaining_cost /
  // remaining_workdays / expected_crew_size / hours_per_day, and the
  // equivalent checklist fields) deserialize as STRINGS over the wire.
  // buildJobHealthInput must coerce them defensively — see review finding
  // fixed in this pass — rather than silently dropping a string-valued
  // override or feeding a string into the engine's non-nullable-number
  // contract.
  it("coerces a numeric-string expected_remaining_cost into remainingCostOverrides as a number", () => {
    const overrides = [
      {
        id: "o1",
        job_number: "JOB-1",
        category: "dump",
        remaining_workdays: null,
        expected_crew_size: null,
        hours_per_day: null,
        expected_remaining_cost: "120.50", // simulated raw Postgres numeric string
        reason: "dump adj",
        created_by_name: "Dane",
        created_at: "2026-08-19T00:00:00Z",
      },
    ] as unknown as ForecastOverrideRow[];

    const input = buildJobHealthInput({
      job: makeJobRow(),
      currentBudget: makeBudget(),
      ledger: {
        approved: emptyCategoryAmounts(),
        provisional: emptyCategoryAmounts(),
        committed: emptyCategoryAmounts(),
        approvedHours: 0,
        provisionalHours: 0,
        timeUpdatedAt: null,
        expenseUpdatedAt: null,
        needsReviewCount: 0,
      },
      overrides,
      latestChecklistSubmittedAt: null,
      latestChecklist: null,
      unresolvedScopeChange: false,
    });

    expect(input.remainingCostOverrides).toEqual({ dump: 120.5 });
    expect(typeof input.remainingCostOverrides.dump).toBe("number");
  });

  it("coerces a numeric-string labor triple — from a labor override, and from a checklist — into numbers", () => {
    const overridesFromOverride = [
      {
        id: "o1",
        job_number: "JOB-1",
        category: null,
        remaining_workdays: "3", // simulated raw Postgres numeric strings
        expected_crew_size: "2",
        hours_per_day: "6",
        expected_remaining_cost: null,
        reason: "crew adj",
        created_by_name: "Dane",
        created_at: "2026-08-20T00:00:00Z",
      },
    ] as unknown as ForecastOverrideRow[];

    const baseLedger = {
      approved: emptyCategoryAmounts(),
      provisional: emptyCategoryAmounts(),
      committed: emptyCategoryAmounts(),
      approvedHours: 0,
      provisionalHours: 0,
      timeUpdatedAt: null,
      expenseUpdatedAt: null,
      needsReviewCount: 0,
    };

    const inputFromOverride = buildJobHealthInput({
      job: makeJobRow(),
      currentBudget: makeBudget(),
      ledger: baseLedger,
      overrides: overridesFromOverride,
      latestChecklistSubmittedAt: null,
      latestChecklist: null,
      unresolvedScopeChange: false,
    });

    expect(inputFromOverride.remainingWorkdays).toBe(3);
    expect(inputFromOverride.expectedCrewSize).toBe(2);
    expect(inputFromOverride.hoursPerDay).toBe(6);

    const inputFromChecklist = buildJobHealthInput({
      job: makeJobRow(),
      currentBudget: makeBudget(),
      ledger: baseLedger,
      overrides: [],
      latestChecklistSubmittedAt: "2026-08-15T00:00:00Z",
      latestChecklist: {
        remaining_workdays: "9",
        expected_crew_size: "5",
        hours_per_day: "7",
      } as unknown as { remaining_workdays: number | null; expected_crew_size: number | null; hours_per_day: number | null },
      unresolvedScopeChange: false,
    });

    expect(inputFromChecklist.remainingWorkdays).toBe(9);
    expect(inputFromChecklist.expectedCrewSize).toBe(5);
    expect(inputFromChecklist.hoursPerDay).toBe(7);
  });
});

// ---- 5 & 6. buildFinancialComparison ---------------------------------------

describe("buildFinancialComparison", () => {
  function buildArgs() {
    // original: approved_revenue deliberately 0, to exercise the
    // division-by-zero margin guard.
    const originalBudget = makeBudget({ approved_revenue: 0 });
    // current: same category/overhead shape, real revenue.
    const currentBudget = makeBudget({ approved_revenue: 2500 });

    const ledger = {
      approved: {
        direct_labor: 300,
        materials: 150,
        rentals: 40,
        dump: 300,
        subcontractors: 80,
        other_direct: 30,
        payment_processing: 90,
      },
      provisional: emptyCategoryAmounts(),
      committed: emptyCategoryAmounts(),
      approvedHours: 10,
      provisionalHours: 5,
      timeUpdatedAt: "2026-08-10T00:00:00Z",
      expenseUpdatedAt: "2026-08-10T00:00:00Z",
      needsReviewCount: 0,
    };

    const revenueEntries: JobRevenueEntryRow[] = [
      { id: "r1", job_number: "JOB-1", entry_type: "invoice", amount: 2000, occurred_at: "2026-08-01T00:00:00Z", source_system: "stripe", created_at: "2026-08-01T00:00:00Z" },
      { id: "r2", job_number: "JOB-1", entry_type: "credit", amount: -50, occurred_at: "2026-08-02T00:00:00Z", source_system: "manual", created_at: "2026-08-02T00:00:00Z" },
      { id: "r3", job_number: "JOB-1", entry_type: "refund", amount: -20, occurred_at: "2026-08-03T00:00:00Z", source_system: "stripe", created_at: "2026-08-03T00:00:00Z" },
      // payment entries are EXCLUDED from the economic-revenue sum.
      { id: "r4", job_number: "JOB-1", entry_type: "payment", amount: 1930, occurred_at: "2026-08-04T00:00:00Z", source_system: "stripe", created_at: "2026-08-04T00:00:00Z" },
    ];

    return { originalBudget, currentBudget, ledger, revenueEntries, health: null as JobHealthResult | null };
  }

  it("excludes payment_processing from Total Direct Costs and carries it as its own row below Gross Profit", () => {
    const result = buildFinancialComparison(buildArgs());

    expect(result.directRows).toHaveLength(6);
    expect(result.directRows.some((row) => row.key === "payment_processing")).toBe(false);

    // totalDirect.original equals the sum of the 6 non-processing category columns.
    const manualSum = result.directRows.reduce((sum, row) => sum + row.original, 0);
    expect(result.totalDirect.original).toBe(manualSum);
    expect(result.totalDirect.original).toBe(1700); // 1000+200+50+300+100+50

    // grossProfit = revenue - totalDirect (original revenue is 0).
    expect(result.grossProfit.original).toBe(0 - 1700);

    // processingFees carries the budget/actual pin from the brief.
    expect(result.processingFees.original).toBe(86.01);
    expect(result.processingFees.actualPlusCommitted).toBe(90);

    // Row label is the locked presentation name "Processing Fees" — distinct
    // from CATEGORY_LABELS.payment_processing ("Payment Processing").
    expect(result.processingFees.label).toBe("Processing Fees");

    // jobProfit = grossProfit - overheadAllocation - processingFees.
    expect(result.jobProfit.original).toBe(
      result.grossProfit.original - result.overheadAllocation.original - result.processingFees.original,
    );
    expect(result.jobProfit.original).toBe(-2016.01);

    // margin division-by-zero guard: original revenue is 0 -> margin 0,
    // even though jobProfit is negative.
    expect(result.jobProfitMarginPct.original).toBe(0);
  });

  it("sums invoice + credit + refund entries for actualPlusCommitted revenue and excludes payment entries", () => {
    const result = buildFinancialComparison(buildArgs());
    expect(result.totalRevenue.actualPlusCommitted).toBe(1930); // 2000 - 50 - 20, NOT +1930 from the payment row
  });
});

// ---- 7. statusSortRank -----------------------------------------------------

describe("statusSortRank", () => {
  function job(status_v2: string, financial_status: string) {
    return { status_v2, financial_status };
  }

  it("orders at_risk < watch < on_track < completed < financially_closed < cancelled", () => {
    expect(statusSortRank(job("in_progress", "not_ready"), "at_risk")).toBe(0);
    expect(statusSortRank(job("in_progress", "not_ready"), "watch")).toBe(1);
    expect(statusSortRank(job("in_progress", "not_ready"), "on_track")).toBe(2);
    expect(statusSortRank(job("completed", "invoice_review"), null)).toBe(3);
    expect(statusSortRank(job("paid", "financially_closed"), null)).toBe(4);
    expect(statusSortRank(job("cancelled", "not_ready"), null)).toBe(5);
  });

  it("ranks an active job with null health the same as on_track (2)", () => {
    expect(statusSortRank(job("scheduled", "not_ready"), null)).toBe(2);
  });
});

// ---- 8. watermarksEqual -----------------------------------------------------

describe("watermarksEqual", () => {
  const base: SnapshotWatermarks = {
    budgetVersion: 2,
    costWatermark: "2026-08-10T00:00:00Z",
    revenueWatermark: "2026-08-09T00:00:00Z",
    checklistWatermark: null,
    overrideWatermark: "2026-08-08T00:00:00Z",
  };

  it("returns false when there is no prior snapshot", () => {
    expect(watermarksEqual(null, base)).toBe(false);
  });

  it("returns true when every field is identical", () => {
    expect(watermarksEqual({ ...base }, base)).toBe(true);
  });

  it("returns false when one field differs", () => {
    expect(watermarksEqual({ ...base, budgetVersion: 3 }, base)).toBe(false);
    expect(watermarksEqual({ ...base, checklistWatermark: "2026-08-01T00:00:00Z" }, base)).toBe(false);
  });
});

// ---- 9. crewDaysRemaining ---------------------------------------------------

describe("crewDaysRemaining", () => {
  it("divides remaining hours by expectedCrewSize x hoursPerDay", () => {
    const health = makeHealthResult(120);
    const input = makeHealthInput({ approvedHours: 30, provisionalHours: 10, expectedCrewSize: 2, hoursPerDay: 8 });
    expect(crewDaysRemaining(health, input)).toBe(5.0);
  });

  it("falls back to a 40-hour crew-day when crew size is unset", () => {
    const health = makeHealthResult(120);
    const input = makeHealthInput({ approvedHours: 30, provisionalHours: 10, expectedCrewSize: null, hoursPerDay: 8 });
    expect(crewDaysRemaining(health, input)).toBe(2.0);
  });

  it("returns null when health is null", () => {
    const input = makeHealthInput({});
    expect(crewDaysRemaining(null, input)).toBeNull();
  });
});
