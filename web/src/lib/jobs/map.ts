// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane A: job-record mapping,
// ledger rollup, forecast-input assembly, and comparison-table math
//
// PURE — no "server-only", no I/O, no supabase import. Imported by BOTH
// the repo layer (server-side data fetching, Task 2) and, for types only,
// client components (Task 3/4 dashboard/detail UI) — so this module must
// stay import-safe in either environment. Consumes only
// `@/lib/profitability/types` (the job-health engine's contract) and
// `roundToCent` from `@/lib/pricing`. Nothing else.
//
// This is the normalization + arithmetic boundary between raw Postgres
// rows (v2 Task 1 schema — `jobs`, `job_budget_versions`,
// `job_cost_entries`, `job_revenue_entries`, `job_alerts`,
// `job_forecast_overrides`) and `calculateJobHealth.ts`'s pure
// `JobHealthInput` -> `JobHealthResult` engine, plus the financial
// comparison-table math a later task renders (original vs. current vs.
// actual-to-date vs. forecast, by cost category).
//
// Source: docs/superpowers/plans/2026-08-26-v2-task6-job-dashboard task-1
// brief (v2 doc Step 1 status-sort ordering, the locked
// buildJobHealthInput/buildFinancialComparison mappings).
// ============================================================

import { roundToCent } from "@/lib/pricing";
import {
  COST_CATEGORIES,
  type CategoryAmounts,
  type CostCategory,
  type HealthStatus,
  type JobHealthInput,
  type JobHealthResult,
} from "@/lib/profitability/types";

// ---- numeric-string coercion ----------------------------------------------

/** Postgres `numeric` columns deserialize as strings over the wire (the
 *  same gotcha `@/lib/estimates/repo.ts` and `@/lib/jobs/repo.ts`
 *  document and guard against). `typeof value === "number"` short-circuits
 *  when a caller already normalized upstream. */
export function toNum(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function toNullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : toNum(value);
}

// ---- JobRow ----------------------------------------------------------------

/** Normalized `jobs` row — a superset of what the dashboard/detail pages
 *  render. Column set per CLAUDE.md's `jobs` table entry plus the v2
 *  Task 1 additions (`original_estimate_id`, `original_estimate_number`,
 *  `current_budget_version`, `financial_status`, …). */
export interface JobRow {
  job_number: string;
  status_v2: string;
  financial_status: string;
  client_name: string | null;
  client_contact_name: string | null;
  business_name: string | null;
  client_type: string | null;
  client_phone: string | null;
  job_address: string | null;
  city: string | null;
  crew: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  scope_summary: string | null;
  original_estimate_id: string | null;
  original_estimate_number: number | null;
  current_budget_version: number | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  last_forecast_at: string | null;
  updated_at: string;
}

export function normalizeJobRow(raw: Record<string, unknown>): JobRow {
  return {
    ...(raw as unknown as JobRow),
    original_estimate_number: toNullableNum(raw.original_estimate_number),
    current_budget_version: toNullableNum(raw.current_budget_version),
  };
}

// ---- JobBudgetVersionRow ----------------------------------------------------

export interface JobBudgetVersionRow {
  id: string;
  job_number: string;
  version: number;
  source_estimate_id: string | null;
  source_change_order_version_id: string | null;
  approved_revenue: number;
  productive_hours: number;
  direct_labor_cost: number;
  materials_cost: number;
  rentals_cost: number;
  dump_cost: number;
  subcontractors_cost: number;
  other_direct_cost: number;
  allocated_overhead: number;
  payment_processing_cost: number;
  planned_economic_profit: number;
  planned_profit_pct: number;
  overhead_rate: number;
  labor_rate: number;
  created_by_name: string;
  created_at: string;
}

export function normalizeBudgetRow(raw: Record<string, unknown>): JobBudgetVersionRow {
  return {
    ...(raw as unknown as JobBudgetVersionRow),
    version: toNum(raw.version),
    approved_revenue: toNum(raw.approved_revenue),
    productive_hours: toNum(raw.productive_hours),
    direct_labor_cost: toNum(raw.direct_labor_cost),
    materials_cost: toNum(raw.materials_cost),
    rentals_cost: toNum(raw.rentals_cost),
    dump_cost: toNum(raw.dump_cost),
    subcontractors_cost: toNum(raw.subcontractors_cost),
    other_direct_cost: toNum(raw.other_direct_cost),
    allocated_overhead: toNum(raw.allocated_overhead),
    payment_processing_cost: toNum(raw.payment_processing_cost),
    planned_economic_profit: toNum(raw.planned_economic_profit),
    planned_profit_pct: toNum(raw.planned_profit_pct),
    overhead_rate: toNum(raw.overhead_rate),
    labor_rate: toNum(raw.labor_rate),
  };
}

// ---- JobCostEntryRow --------------------------------------------------------

export interface JobCostEntryRow {
  id: string;
  job_number: string | null;
  category: CostCategory;
  state: "provisional" | "committed" | "approved" | "void";
  reconciliation_state: string;
  amount: number;
  quantity: number | null;
  employee_name: string | null;
  vendor_name: string | null;
  incurred_at: string;
  source_system: string;
  updated_at: string;
}

export function normalizeCostEntryRow(raw: Record<string, unknown>): JobCostEntryRow {
  return {
    ...(raw as unknown as JobCostEntryRow),
    amount: toNum(raw.amount),
    quantity: toNullableNum(raw.quantity),
  };
}

// ---- JobRevenueEntryRow ------------------------------------------------------

export interface JobRevenueEntryRow {
  id: string;
  job_number: string;
  entry_type: "approved_contract" | "invoice" | "credit" | "refund" | "payment";
  amount: number;
  occurred_at: string;
  source_system: string;
  created_at: string;
}

export function normalizeRevenueEntryRow(raw: Record<string, unknown>): JobRevenueEntryRow {
  return {
    ...(raw as unknown as JobRevenueEntryRow),
    amount: toNum(raw.amount),
  };
}

// ---- JobAlertRow / ForecastOverrideRow --------------------------------------

export interface JobAlertRow {
  id: string;
  job_number: string;
  fingerprint: string;
  severity: HealthStatus;
  title: string;
  message: string;
  action_path: string;
  opened_at: string;
}

export interface ForecastOverrideRow {
  id: string;
  job_number: string;
  category: CostCategory | null;
  remaining_workdays: number | null;
  expected_crew_size: number | null;
  hours_per_day: number | null;
  expected_remaining_cost: number | null;
  reason: string;
  created_by_name: string;
  created_at: string;
}

// ---- CategoryAmounts helpers -------------------------------------------------

/** A fresh all-zero `CategoryAmounts`, built by iterating `COST_CATEGORIES`
 *  rather than a hand-typed key list (per the module's iteration rule). */
export function emptyCategoryAmounts(): CategoryAmounts {
  const amounts = {} as CategoryAmounts;
  for (const category of COST_CATEGORIES) {
    amounts[category] = 0;
  }
  return amounts;
}

// ---- rollupLedger -------------------------------------------------------------

export interface LedgerRollup {
  approved: CategoryAmounts;
  provisional: CategoryAmounts;
  committed: CategoryAmounts;
  approvedHours: number;
  provisionalHours: number;
  timeUpdatedAt: string | null;
  expenseUpdatedAt: string | null;
  needsReviewCount: number;
}

/** Later of two ISO timestamps, treating `null` as "no watermark yet". */
function laterOf(current: string | null, candidate: string): string {
  if (current === null) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

/**
 * Buckets `job_cost_entries` rows into approved/provisional/committed
 * `CategoryAmounts`, tracks direct-labor hours for the two active states,
 * and picks separate freshness watermarks for labor vs. non-labor entries.
 *
 * Rules: `state === "void"` and `reconciliation_state === "excluded"` rows
 * are skipped ENTIRELY — no bucket contribution, no hours, no watermark
 * contribution, not even counted toward `needsReviewCount`. Everything
 * else buckets by `state` into the three `CategoryAmounts`.
 */
export function rollupLedger(entries: JobCostEntryRow[]): LedgerRollup {
  const approved = emptyCategoryAmounts();
  const provisional = emptyCategoryAmounts();
  const committed = emptyCategoryAmounts();
  let approvedHours = 0;
  let provisionalHours = 0;
  let timeUpdatedAt: string | null = null;
  let expenseUpdatedAt: string | null = null;
  let needsReviewCount = 0;

  for (const entry of entries) {
    if (entry.state === "void" || entry.reconciliation_state === "excluded") continue;

    if (entry.reconciliation_state === "needs_review") needsReviewCount += 1;

    const bucket =
      entry.state === "approved" ? approved : entry.state === "provisional" ? provisional : committed;
    bucket[entry.category] = roundToCent(bucket[entry.category] + entry.amount);

    if (entry.category === "direct_labor") {
      timeUpdatedAt = laterOf(timeUpdatedAt, entry.updated_at);
      if (entry.state === "approved") approvedHours += entry.quantity ?? 0;
      if (entry.state === "provisional") provisionalHours += entry.quantity ?? 0;
    } else {
      expenseUpdatedAt = laterOf(expenseUpdatedAt, entry.updated_at);
    }
  }

  return {
    approved,
    provisional,
    committed,
    approvedHours: roundToCent(approvedHours),
    provisionalHours: roundToCent(provisionalHours),
    timeUpdatedAt,
    expenseUpdatedAt,
    needsReviewCount,
  };
}

// ---- budgetToCategoryAmounts ----------------------------------------------

/** Maps the 7 named budget-column dollars onto `CategoryAmounts`.
 *  `allocated_overhead` is deliberately NOT a category — the engine
 *  models overhead as its own scalar field, never a `CostCategory`. */
export function budgetToCategoryAmounts(budget: JobBudgetVersionRow): CategoryAmounts {
  return {
    direct_labor: budget.direct_labor_cost,
    materials: budget.materials_cost,
    rentals: budget.rentals_cost,
    dump: budget.dump_cost,
    subcontractors: budget.subcontractors_cost,
    other_direct: budget.other_direct_cost,
    payment_processing: budget.payment_processing_cost,
  };
}

// ---- buildJobHealthInput ------------------------------------------------------

export interface BuildHealthInputArgs {
  job: JobRow;
  currentBudget: JobBudgetVersionRow;
  ledger: LedgerRollup;
  /** All rows for the job, newest first. */
  overrides: ForecastOverrideRow[];
  /** null until Phase 3. */
  latestChecklistSubmittedAt: string | null;
  latestChecklist: {
    remaining_workdays: number | null;
    expected_crew_size: number | null;
    hours_per_day: number | null;
  } | null;
  /** Open alert with fingerprint starting "scope-change:". */
  unresolvedScopeChange: boolean;
}

interface LaborForecastSource {
  remainingWorkdays: number | null;
  expectedCrewSize: number | null;
  hoursPerDay: number;
}

/** `toNullableNum` plus a finite check, so a garbage/non-numeric string
 *  coerces to `null` (treated as "unset") rather than propagating `NaN`
 *  into the engine's non-nullable-number contract. Postgres `numeric`
 *  columns — `job_forecast_overrides.expected_remaining_cost`/
 *  `remaining_workdays`/`expected_crew_size`/`hours_per_day` and the
 *  equivalent checklist fields — deserialize as STRINGS over the wire
 *  (the same gotcha `toNum`/`toNullableNum` exist to guard against), and
 *  this module has no dedicated normalizer for override/checklist rows,
 *  so every numeric field read from them here must be defensively
 *  coerced regardless of what shape an upstream caller (e.g. Task 2's
 *  repo layer) actually passes in. */
function coerceNullableNum(value: unknown): number | null {
  const n = toNullableNum(value);
  return n === null || !Number.isFinite(n) ? null : n;
}

/** Chooses the remainingWorkdays/expectedCrewSize/hoursPerDay triple: the
 *  latest labor override (category `null`) wins outright if it is newer
 *  than the latest checklist (or there is no checklist at all); otherwise
 *  the latest checklist's values; otherwise null/null/8. `hoursPerDay`
 *  defaults to 8 whenever the chosen source leaves it unset (or leaves it
 *  a non-numeric string) — the engine's `JobHealthInput.hoursPerDay` is
 *  non-nullable. */
function pickLaborForecastSource(
  overrides: ForecastOverrideRow[],
  checklistAt: string | null,
  checklist: BuildHealthInputArgs["latestChecklist"],
): LaborForecastSource {
  const laborOverride = overrides.find((o) => o.category === null) ?? null;
  const overrideIsNewer =
    laborOverride !== null &&
    (checklistAt === null || new Date(laborOverride.created_at).getTime() > new Date(checklistAt).getTime());

  if (overrideIsNewer && laborOverride !== null) {
    return {
      remainingWorkdays: coerceNullableNum(laborOverride.remaining_workdays),
      expectedCrewSize: coerceNullableNum(laborOverride.expected_crew_size),
      hoursPerDay: coerceNullableNum(laborOverride.hours_per_day) ?? 8,
    };
  }

  if (checklist !== null) {
    return {
      remainingWorkdays: coerceNullableNum(checklist.remaining_workdays),
      expectedCrewSize: coerceNullableNum(checklist.expected_crew_size),
      hoursPerDay: coerceNullableNum(checklist.hours_per_day) ?? 8,
    };
  }

  return { remainingWorkdays: null, expectedCrewSize: null, hoursPerDay: 8 };
}

/**
 * Assembles a `JobHealthInput` from a job row, its current budget version,
 * a ledger rollup, and the job's forecast overrides/latest checklist —
 * the locked mappings are documented in the task brief and mirrored here
 * inline per field.
 */
export function buildJobHealthInput(args: BuildHealthInputArgs): JobHealthInput {
  const { job, currentBudget, ledger, overrides, latestChecklistSubmittedAt, latestChecklist, unresolvedScopeChange } =
    args;

  // Latest override PER CATEGORY (rows where category != null) — overrides
  // arrive newest first, so the first row seen for a given category is the
  // one that wins. `expected_remaining_cost` is coerced via
  // `coerceNullableNum` before use — it's a Postgres `numeric` column and
  // can arrive as a STRING — and a stray null/non-finite value is skipped
  // rather than poisoning the map with a non-number value (the engine's
  // forecastNonlaborCategory treats an absent key the same as a
  // legitimate "no override" signal — see calculateJobHealth.ts).
  const remainingCostOverrides: Partial<CategoryAmounts> = {};
  for (const override of overrides) {
    if (override.category === null) continue;
    if (remainingCostOverrides[override.category] !== undefined) continue;
    const expectedRemainingCost = coerceNullableNum(override.expected_remaining_cost);
    if (expectedRemainingCost === null) continue;
    remainingCostOverrides[override.category] = expectedRemainingCost;
  }

  const labor = pickLaborForecastSource(overrides, latestChecklistSubmittedAt, latestChecklist);

  return {
    jobStatus: job.status_v2 as JobHealthInput["jobStatus"],
    financialStatus: job.financial_status as JobHealthInput["financialStatus"],
    approvedRevenue: currentBudget.approved_revenue,
    plannedProfit: currentBudget.planned_economic_profit,
    plannedProfitPct: currentBudget.planned_profit_pct,
    budgetHours: currentBudget.productive_hours,
    overheadRate: currentBudget.overhead_rate,
    categoryBudget: budgetToCategoryAmounts(currentBudget),
    approvedActual: ledger.approved,
    provisionalActual: ledger.provisional,
    committed: ledger.committed,
    remainingCostOverrides,
    approvedHours: ledger.approvedHours,
    provisionalHours: ledger.provisionalHours,
    remainingWorkdays: labor.remainingWorkdays,
    expectedCrewSize: labor.expectedCrewSize,
    hoursPerDay: labor.hoursPerDay,
    expectedRemainingLaborRate: currentBudget.labor_rate,
    checklistUpdatedAt: latestChecklistSubmittedAt,
    timeUpdatedAt: ledger.timeUpdatedAt,
    expenseUpdatedAt: ledger.expenseUpdatedAt,
    unassignedExpenseCount: ledger.needsReviewCount,
    unresolvedScopeChange,
  };
}

// ---- statusSortRank / isEngineScorable ----------------------------------------

/**
 * v2 doc Step 1 ordering, extended for the two terminal buckets:
 *   0 at_risk, 1 watch, 2 on_track — jobs scored by the engine.
 *   3 operationally completed (status_v2 in completed/paid, financial_status != financially_closed)
 *   4 financially_closed
 *   5 cancelled
 *
 * `cancelled` and `financially_closed` are checked first so they always
 * win their bucket regardless of `status_v2`/`health`. Everything else
 * (scheduled/in_progress, and any other non-terminal status_v2) ranks by
 * `health` — a `null` health (no engine score available, e.g. mid-load)
 * ranks the same as `on_track` (2), never as more urgent than a real
 * score.
 */
export function statusSortRank(
  job: Pick<JobRow, "status_v2" | "financial_status">,
  health: HealthStatus | null,
): number {
  if (job.status_v2 === "cancelled") return 5;
  if (job.financial_status === "financially_closed") return 4;
  if (job.status_v2 === "completed" || job.status_v2 === "paid") return 3;

  if (health === "at_risk") return 0;
  if (health === "watch") return 1;
  return 2;
}

/** True for the four `job_lifecycle` values the engine is meant to score
 *  in this dashboard ("scheduled" | "in_progress" | "completed" | "paid");
 *  false otherwise — including "cancelled". The engine itself accepts any
 *  `jobStatus` value (see `calculateJobHealth.ts`'s module header); which
 *  jobs are worth scoring at all is the caller's choice, and this
 *  function is that choice, made once, in one place. */
export function isEngineScorable(statusV2: string): boolean {
  return (
    statusV2 === "scheduled" || statusV2 === "in_progress" || statusV2 === "completed" || statusV2 === "paid"
  );
}

// ---- buildFinancialComparison ---------------------------------------------------

export interface ComparisonColumnSet {
  original: number;
  current: number;
  actualPlusCommitted: number;
  forecast: number;
}

export interface ComparisonRow extends ComparisonColumnSet {
  key: string;
  label: string;
}

export interface FinancialComparison {
  totalRevenue: ComparisonRow;
  /** 6 rows, payment_processing EXCLUDED, in engine category order. */
  directRows: ComparisonRow[];
  totalDirect: ComparisonRow;
  grossProfit: ComparisonRow;
  overheadAllocation: ComparisonRow;
  /** The payment_processing line, rendered below Gross Profit. */
  processingFees: ComparisonRow;
  jobProfit: ComparisonRow;
  jobProfitMarginPct: ComparisonColumnSet;
}

const CATEGORY_LABELS: Record<CostCategory, string> = {
  direct_labor: "Direct Labor",
  materials: "Materials",
  rentals: "Rentals",
  dump: "Dump Fees",
  subcontractors: "Subcontractors",
  other_direct: "Other Direct",
  payment_processing: "Payment Processing",
};

const DIRECT_CATEGORIES: readonly CostCategory[] = COST_CATEGORIES.filter((c) => c !== "payment_processing");

interface ComparisonColumn {
  categories: CategoryAmounts;
  overhead: number;
  revenue: number;
}

function sumDirectCategories(column: ComparisonColumn): number {
  return roundToCent(DIRECT_CATEGORIES.reduce((sum, category) => sum + column.categories[category], 0));
}

function grossProfitOf(column: ComparisonColumn): number {
  return roundToCent(column.revenue - sumDirectCategories(column));
}

function jobProfitOf(column: ComparisonColumn): number {
  return roundToCent(grossProfitOf(column) - column.overhead - column.categories.payment_processing);
}

function marginPctOf(column: ComparisonColumn): number {
  return column.revenue === 0 ? 0 : roundToCent((jobProfitOf(column) / column.revenue) * 100);
}

/**
 * Builds the original/current/actual-to-date/forecast comparison table.
 *
 * Column semantics (locked):
 *   - `original`  ← budget v1 columns; revenue = approved_revenue.
 *   - `current`   ← current budget columns; revenue = approved_revenue.
 *   - `actualPlusCommitted` ← per-category approved+provisional+committed
 *     from the ledger; revenue = Σ invoice + credit + refund entries
 *     (economic revenue — `payment` entries EXCLUDED, to avoid
 *     double-counting cash collected against invoiced amounts); overhead
 *     = (approvedHours + provisionalHours) × currentBudget.overhead_rate.
 *   - `forecast`  ← health.forecastCategoryCost / forecastAllocatedOverhead,
 *     revenue = currentBudget.approved_revenue; when `health` is `null`
 *     (e.g. a cancelled job with no computed forecast) the ENTIRE forecast
 *     column — categories, overhead, AND revenue — mirrors
 *     `actualPlusCommitted` instead, so the table always renders a
 *     consistent "forecast = actual to date" reading rather than a
 *     partial/zeroed column.
 *
 * `payment_processing` is excluded from `totalDirect`/`grossProfit`'s
 * direct-cost sum and rendered as its own `processingFees` row below
 * `grossProfit` — this is the exclusion the brief requires a dedicated
 * proof test for.
 */
export function buildFinancialComparison(args: {
  originalBudget: JobBudgetVersionRow;
  currentBudget: JobBudgetVersionRow;
  ledger: LedgerRollup;
  revenueEntries: JobRevenueEntryRow[];
  health: JobHealthResult | null;
}): FinancialComparison {
  const { originalBudget, currentBudget, ledger, revenueEntries, health } = args;

  const original: ComparisonColumn = {
    categories: budgetToCategoryAmounts(originalBudget),
    overhead: originalBudget.allocated_overhead,
    revenue: originalBudget.approved_revenue,
  };

  const current: ComparisonColumn = {
    categories: budgetToCategoryAmounts(currentBudget),
    overhead: currentBudget.allocated_overhead,
    revenue: currentBudget.approved_revenue,
  };

  const actualCategories = emptyCategoryAmounts();
  for (const category of COST_CATEGORIES) {
    actualCategories[category] = roundToCent(
      ledger.approved[category] + ledger.provisional[category] + ledger.committed[category],
    );
  }
  const economicRevenue = roundToCent(
    revenueEntries
      .filter((entry) => entry.entry_type === "invoice" || entry.entry_type === "credit" || entry.entry_type === "refund")
      .reduce((sum, entry) => sum + entry.amount, 0),
  );
  const actualPlusCommitted: ComparisonColumn = {
    categories: actualCategories,
    overhead: roundToCent((ledger.approvedHours + ledger.provisionalHours) * currentBudget.overhead_rate),
    revenue: economicRevenue,
  };

  const forecast: ComparisonColumn = health
    ? {
        categories: health.forecastCategoryCost,
        overhead: health.forecastAllocatedOverhead,
        revenue: currentBudget.approved_revenue,
      }
    : actualPlusCommitted;

  const columns = { original, current, actualPlusCommitted, forecast };

  function rowFor(key: string, label: string, pick: (column: ComparisonColumn) => number): ComparisonRow {
    return {
      key,
      label,
      original: pick(columns.original),
      current: pick(columns.current),
      actualPlusCommitted: pick(columns.actualPlusCommitted),
      forecast: pick(columns.forecast),
    };
  }

  const totalRevenue = rowFor("total_revenue", "Total Revenue", (c) => c.revenue);

  const directRows = DIRECT_CATEGORIES.map((category) =>
    rowFor(category, CATEGORY_LABELS[category], (c) => c.categories[category]),
  );

  const totalDirect = rowFor("total_direct", "Total Direct Costs", sumDirectCategories);
  const grossProfit = rowFor("gross_profit", "Gross Profit", grossProfitOf);
  const overheadAllocation = rowFor("overhead_allocation", "Overhead Allocation", (c) => c.overhead);
  // Row label is the locked presentation name "Processing Fees" — distinct
  // from CATEGORY_LABELS.payment_processing ("Payment Processing"), which
  // labels the ledger cost-entry category elsewhere and must stay as-is.
  const processingFees = rowFor(
    "payment_processing",
    "Processing Fees",
    (c) => c.categories.payment_processing,
  );
  const jobProfit = rowFor("job_profit", "Job Profit", jobProfitOf);

  const jobProfitMarginPct: ComparisonColumnSet = {
    original: marginPctOf(columns.original),
    current: marginPctOf(columns.current),
    actualPlusCommitted: marginPctOf(columns.actualPlusCommitted),
    forecast: marginPctOf(columns.forecast),
  };

  return {
    totalRevenue,
    directRows,
    totalDirect,
    grossProfit,
    overheadAllocation,
    processingFees,
    jobProfit,
    jobProfitMarginPct,
  };
}

// ---- SnapshotWatermarks / watermarksEqual --------------------------------------

export interface SnapshotWatermarks {
  budgetVersion: number;
  /** max job_cost_entries.updated_at */
  costWatermark: string | null;
  /** max job_revenue_entries.created_at */
  revenueWatermark: string | null;
  /** max job_checklists.submitted_at */
  checklistWatermark: string | null;
  /** max job_forecast_overrides.created_at */
  overrideWatermark: string | null;
}

/** Field-by-field strict equality; a `null` prior snapshot (nothing cached
 *  yet) is always unequal, forcing the first recompute. */
export function watermarksEqual(a: SnapshotWatermarks | null, b: SnapshotWatermarks): boolean {
  if (a === null) return false;
  return (
    a.budgetVersion === b.budgetVersion &&
    a.costWatermark === b.costWatermark &&
    a.revenueWatermark === b.revenueWatermark &&
    a.checklistWatermark === b.checklistWatermark &&
    a.overrideWatermark === b.overrideWatermark
  );
}

// ---- crewDaysRemaining ------------------------------------------------------------

/** True half-up rounding to 1 decimal place — the same
 *  scale-clean-round idiom `roundToCent` uses at 2dp (see
 *  `@/lib/pricing`), applied at 1dp for a crew-days figure. */
function roundToOneDecimal(n: number): number {
  return Math.round(Number((n * 10).toPrecision(12))) / 10;
}

/**
 * Remaining crew-days = remaining forecast hours ÷ a crew-day's hours.
 * `null` when there is no health result to forecast from. Otherwise:
 *   remainingHours = max(0, health.forecastHours − (approvedHours + provisionalHours))
 *   divisor = expectedCrewSize × hoursPerDay when a positive crew size is
 *     set, else 40 (the ratified prototype convention: 1 crew-day = 40
 *     productive hours, i.e. a nominal 5-person, 8-hour crew).
 */
export function crewDaysRemaining(health: JobHealthResult | null, input: JobHealthInput | null): number | null {
  if (health === null || input === null) return null;

  const remainingHours = Math.max(0, health.forecastHours - (input.approvedHours + input.provisionalHours));
  const divisor =
    input.expectedCrewSize !== null && input.expectedCrewSize > 0
      ? input.expectedCrewSize * input.hoursPerDay
      : 40;

  return roundToOneDecimal(remainingHours / divisor);
}
