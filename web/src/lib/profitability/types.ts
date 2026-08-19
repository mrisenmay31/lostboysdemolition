// ============================================================
// Lost Boys Demolition — web app — profitability engine types
//
// Pure types plus one small runtime export (`COST_CATEGORIES`, the ordered
// key list below) — no other runtime code lives here. These names are a
// contract shared with the
// Task 1 Postgres migration (`job_health_status`, `cost_category`, and the
// job/financial-status enums) — the Task 3 review diff-checks the string
// unions here against the SQL enum value lists character-for-character.
// Do not rename or reorder without checking that migration first.
//
// Source: docs/superpowers/plans/2026-08-18-live-job-profitability-health-
// dashboard-v2.md, Task 3 "Step 1: Define and test the forecast contract"
// (verbatim contract, reproduced exactly).
// ============================================================

export type CostCategory =
  | "direct_labor"
  | "materials"
  | "rentals"
  | "dump"
  | "subcontractors"
  | "other_direct"
  | "payment_processing";

export type HealthStatus = "on_track" | "watch" | "at_risk";

export type ForecastConfidence = "high" | "medium" | "low";

export interface CategoryAmounts {
  direct_labor: number;
  materials: number;
  rentals: number;
  dump: number;
  subcontractors: number;
  other_direct: number;
  payment_processing: number;
}

export interface JobHealthInput {
  /** Mirrors the live `job_lifecycle` Postgres enum, in the same order,
   *  all seven values — the engine only reads this to gate the checklist
   *  freshness rule to `in_progress`; every other value is accepted and
   *  scored identically. Filtering out lifecycle states the caller doesn't
   *  want scored (e.g. `cancelled`) is the caller's job, not this engine's
   *  — see the module header of `calculateJobHealth.ts`. */
  jobStatus:
    | "accepted"
    | "scheduled"
    | "in_progress"
    | "completed"
    | "invoiced"
    | "paid"
    | "cancelled";
  financialStatus:
    | "not_ready"
    | "invoice_review"
    | "invoice_sent"
    | "paid_reconciliation_pending"
    | "financially_closed"
    | "reconciliation_required";
  approvedRevenue: number;
  plannedProfit: number;
  plannedProfitPct: number;
  budgetHours: number;
  overheadRate: number;
  categoryBudget: CategoryAmounts;
  approvedActual: CategoryAmounts;
  provisionalActual: CategoryAmounts;
  committed: CategoryAmounts;
  remainingCostOverrides: Partial<CategoryAmounts>;
  approvedHours: number;
  provisionalHours: number;
  remainingWorkdays: number | null;
  expectedCrewSize: number | null;
  hoursPerDay: number;
  expectedRemainingLaborRate: number;
  checklistUpdatedAt: string | null;
  timeUpdatedAt: string | null;
  expenseUpdatedAt: string | null;
  unassignedExpenseCount: number;
  unresolvedScopeChange: boolean;
}

export interface JobHealthResult {
  health: HealthStatus;
  confidence: ForecastConfidence;
  forecastHours: number;
  forecastCategoryCost: CategoryAmounts;
  forecastAllocatedOverhead: number;
  forecastCost: number;
  forecastProfit: number;
  forecastProfitPct: number;
  profitRetentionPct: number;
  reasons: string[];
}

/** The seven `CostCategory` keys, in the same order as `CategoryAmounts` —
 *  shared by the engine and its tests so both iterate identically. */
export const COST_CATEGORIES: readonly CostCategory[] = [
  "direct_labor",
  "materials",
  "rentals",
  "dump",
  "subcontractors",
  "other_direct",
  "payment_processing",
];
