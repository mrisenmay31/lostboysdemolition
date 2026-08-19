// ============================================================
// Lost Boys Demolition — web app — deterministic job forecast & health
//
// PURE — no React, no Supabase, no "server-only", no I/O. Consumes a
// normalized snapshot of a job's budget, actuals-to-date, and freshness
// watermarks and produces a forecast-to-completion plus a traffic-light
// health status. Used by Tasks 5, 6, 10, and 15 (dashboard tiles, job
// detail forecast card, dispatcher-fed digests, etc.) — none of which are
// built in this lane; this module only has to be correct and stable.
//
// Source of the calculation contract: docs/superpowers/plans/2026-08-18-
// live-job-profitability-health-dashboard-v2.md, Task 3. See
// `docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` Session 1
// Lane B for the execution note (Task 1's SQL enums share these type names
// character-for-character — do not rename either side without the other).
//
// Rounding: every money output and both percentage outputs go through
// `roundToCent` (true half-up to 2dp — see `@/lib/pricing`), and hours use
// the same 2dp rounding per the Task 3 brief ("Hours to 2dp likewise").
// Rounding happens once, at the point each output field is produced, and
// downstream calculations (health thresholds, reasons text) read the same
// already-rounded field the caller receives — mirroring the cascading-round
// style `_shared/pricing.ts` uses, so the number a human reads is always
// the number the health decision was actually made from.
//
// Scope note: this engine scores whatever `JobHealthInput` it is handed —
// it does not itself decide which jobs are worth scoring. Filtering by
// lifecycle or financial status (e.g. skipping `cancelled` jobs or ones
// already `financially_closed`) is the CALLER's responsibility.
//
// Throws on any non-finite numeric input (undefined/NaN/Infinity/string —
// including numeric strings, which Postgres `numeric` columns can
// deserialize as). Callers rendering UI should catch and surface an
// explicit "forecast unavailable" state rather than a green tile — a
// malformed input must never read healthier than a real one.
// ============================================================

import { roundToCent } from "@/lib/pricing";
import {
  COST_CATEGORIES,
  type CategoryAmounts,
  type CostCategory,
  type ForecastConfidence,
  type HealthStatus,
  type JobHealthInput,
  type JobHealthResult,
} from "./types";

const HOURS_OVERRUN_MULTIPLIER = 1.1;
/** The overrun multiplier expressed as a whole-number percent, for the
 *  reasons-text string — derived rather than hardcoded so the two can
 *  never drift apart. */
const HOURS_OVERRUN_PCT = Math.round((HOURS_OVERRUN_MULTIPLIER - 1) * 100);
const AT_RISK_RETENTION_PCT = 75;
const WATCH_RETENTION_PCT = 90;
const CHECKLIST_STALE_HOURS = 36;
const TIME_STALE_HOURS = 12;
const EXPENSE_STALE_HOURS = 24;

/** `CostCategory`s whose forecast is driven by the budget/consumed/override
 *  ETC rule. `direct_labor` is deliberately excluded — its forecast is
 *  always the crew-days/remaining-hours calculation, never a budget-based
 *  override (see the "resolved ambiguity" note in the module's test file
 *  and the session report). */
const NONLABOR_CATEGORIES: readonly CostCategory[] = COST_CATEGORIES.filter(
  (c): c is Exclude<CostCategory, "direct_labor"> => c !== "direct_labor",
);

/** A single finite-number field check, matching the `requireFinite` idiom
 *  in `supabase/functions/_shared/pricing.ts` — throws rather than letting
 *  a non-finite value (undefined, NaN, a string) fall through every
 *  `<`/`>` comparison below and silently produce an on_track/high result
 *  built on NaN. Implemented locally rather than imported: this module
 *  intentionally shares no runtime code with `_shared/pricing.ts`. */
function requireFiniteField(name: string, v: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`calculateJobHealth: ${name} must be a finite number, got ${String(v)}`);
  }
  return v;
}

/** Same check, but `null` is a legitimate value (per the `| null` fields
 *  on `JobHealthInput`) and passes through untouched. */
function requireFiniteOrNull(name: string, v: number | null): number | null {
  if (v === null) return null;
  return requireFiniteField(name, v);
}

function requireFiniteCategoryAmounts(name: string, amounts: CategoryAmounts): void {
  for (const category of COST_CATEGORIES) {
    requireFiniteField(`${name}.${category}`, amounts[category]);
  }
}

/** Validates every numeric scalar and all four required `CategoryAmounts`
 *  maps on the input are finite numbers before any arithmetic runs.
 *  `remainingCostOverrides` is deliberately excluded — it's a partial map
 *  whose per-entry validity is handled by `forecastNonlaborCategory`'s own
 *  type guard (see F2), since an absent-or-invalid override there is a
 *  legitimate "fall back to the budget rule" signal, not an error.
 *  Watermark strings (`checklistUpdatedAt` etc.) are not numeric and are
 *  exempt. Booleans and status strings are exempt for the same reason. */
function validateInput(input: JobHealthInput): void {
  requireFiniteField("approvedRevenue", input.approvedRevenue);
  requireFiniteField("plannedProfit", input.plannedProfit);
  requireFiniteField("plannedProfitPct", input.plannedProfitPct);
  requireFiniteField("budgetHours", input.budgetHours);
  requireFiniteField("overheadRate", input.overheadRate);
  requireFiniteField("approvedHours", input.approvedHours);
  requireFiniteField("provisionalHours", input.provisionalHours);
  requireFiniteField("hoursPerDay", input.hoursPerDay);
  requireFiniteField("expectedRemainingLaborRate", input.expectedRemainingLaborRate);
  requireFiniteField("unassignedExpenseCount", input.unassignedExpenseCount);
  requireFiniteOrNull("remainingWorkdays", input.remainingWorkdays);
  requireFiniteOrNull("expectedCrewSize", input.expectedCrewSize);
  requireFiniteCategoryAmounts("categoryBudget", input.categoryBudget);
  requireFiniteCategoryAmounts("approvedActual", input.approvedActual);
  requireFiniteCategoryAmounts("provisionalActual", input.provisionalActual);
  requireFiniteCategoryAmounts("committed", input.committed);
}

function zeroAmounts(): CategoryAmounts {
  return {
    direct_labor: 0,
    materials: 0,
    rentals: 0,
    dump: 0,
    subcontractors: 0,
    other_direct: 0,
    payment_processing: 0,
  };
}

/** Hours since `watermark` at `now`. An unparseable string is treated as
 *  infinitely old (always stale), the same as a null watermark — belt and
 *  suspenders against a malformed upstream timestamp. */
function ageHours(watermark: string, now: Date): number {
  const t = new Date(watermark).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / (1000 * 60 * 60);
}

/** A null watermark is always stale/failed (per the Task 3 brief). */
function isStale(watermark: string | null, now: Date, thresholdHours: number): boolean {
  if (watermark === null) return true;
  return ageHours(watermark, now) > thresholdHours;
}

/** One category's forecast-to-completion under the ETC rule: an explicit
 *  `remainingCostOverrides[category]` wins outright, but ONLY when it's a
 *  finite number — `undefined` (absent) or a stray `null`/NaN both fall
 *  through to the budget rule rather than zeroing out the remaining
 *  amount. Otherwise the remaining amount defaults to whatever category
 *  budget is left unused (floored at 0, so an already-over-budget category
 *  forecasts the overrun rather than clawing back to the budget number). */
function forecastNonlaborCategory(
  category: CostCategory,
  input: JobHealthInput,
): number {
  const consumed =
    input.approvedActual[category] + input.provisionalActual[category] + input.committed[category];
  const override = input.remainingCostOverrides[category];
  const hasValidOverride = typeof override === "number" && Number.isFinite(override);
  const remaining = hasValidOverride
    ? (override as number)
    : Math.max(0, input.categoryBudget[category] - consumed);
  return consumed + remaining;
}

interface ConfidenceResult {
  confidence: ForecastConfidence;
  checklistStale: boolean;
  timeStale: boolean;
  expenseStale: boolean;
}

/** Confidence is driven by up to four independent failed conditions: the
 *  three freshness watermarks (checklist only counts while the job is
 *  `in_progress` — see the Task 3 brief's "does not reduce confidence
 *  once completed/paid") plus whether any expense is still unassigned to
 *  a job. 0 failed -> high, exactly 1 -> medium, 2+ -> low. The fourth
 *  condition (unassigned expenses) is only ever consumed via
 *  `input.unassignedExpenseCount` directly by the caller (`buildReasons`),
 *  so it isn't carried on the returned `ConfidenceResult`. */
function computeConfidence(input: JobHealthInput, now: Date): ConfidenceResult {
  const checklistApplicable = input.jobStatus === "in_progress";
  const checklistStale = checklistApplicable && isStale(input.checklistUpdatedAt, now, CHECKLIST_STALE_HOURS);
  const timeStale = isStale(input.timeUpdatedAt, now, TIME_STALE_HOURS);
  const expenseStale = isStale(input.expenseUpdatedAt, now, EXPENSE_STALE_HOURS);
  const hasUnassignedExpenses = input.unassignedExpenseCount > 0;

  const failedCount = [checklistStale, timeStale, expenseStale, hasUnassignedExpenses].filter(Boolean).length;
  const confidence: ForecastConfidence = failedCount === 0 ? "high" : failedCount === 1 ? "medium" : "low";

  return { confidence, checklistStale, timeStale, expenseStale };
}

function buildReasons(params: {
  negativeProfit: boolean;
  retentionAtRisk: boolean;
  retentionWatchOnly: boolean;
  hoursOverrun: boolean;
  unresolvedScopeChange: boolean;
  confidenceNotHigh: boolean;
  forecastProfit: number;
  profitRetentionPct: number;
  forecastHours: number;
  budgetHours: number;
  confidence: ForecastConfidence;
  confidenceDetail: ConfidenceResult;
  unassignedExpenseCount: number;
}): string[] {
  const {
    negativeProfit,
    retentionAtRisk,
    retentionWatchOnly,
    hoursOverrun,
    unresolvedScopeChange,
    confidenceNotHigh,
    forecastProfit,
    profitRetentionPct,
    forecastHours,
    budgetHours,
    confidence,
    confidenceDetail,
    unassignedExpenseCount,
  } = params;

  // Ordered most-severe first — this is also the health precedence order,
  // so filtering it for "active" conditions naturally puts the true
  // primary driver of the status first, per the contract.
  const conditions: { active: boolean; text: string }[] = [
    {
      active: negativeProfit,
      text: `Forecast profit is negative ($${forecastProfit.toFixed(2)}).`,
    },
    {
      active: retentionAtRisk,
      text: `Profit retention is ${profitRetentionPct.toFixed(1)}% of plan, below the ${AT_RISK_RETENTION_PCT}% at-risk threshold.`,
    },
    {
      active: retentionWatchOnly,
      text: `Profit retention is ${profitRetentionPct.toFixed(1)}% of plan, below the ${WATCH_RETENTION_PCT}% watch threshold.`,
    },
    {
      active: hoursOverrun,
      text: `Forecast hours (${forecastHours.toFixed(2)}) exceed budget hours (${budgetHours.toFixed(2)}) by more than ${HOURS_OVERRUN_PCT}%.`,
    },
    {
      active: unresolvedScopeChange,
      text: "Job has an unresolved scope change awaiting approval.",
    },
    {
      active: confidenceNotHigh,
      text: `Forecast confidence is ${confidence}, not high, due to stale or missing inputs.`,
    },
  ];

  const reasons = conditions.filter((c) => c.active).map((c) => c.text);

  if (reasons.length === 0) {
    reasons.push(`On track: forecast profit retention is ${profitRetentionPct.toFixed(1)}% of plan.`);
  }

  // Diagnostic detail for WHY confidence is degraded, appended after the
  // primary/contributing reasons above so the leading reason always stays
  // the actual driver of the health status.
  if (confidenceNotHigh) {
    if (confidenceDetail.checklistStale) {
      reasons.push(`Checklist update is stale or missing (job in progress, requires within ${CHECKLIST_STALE_HOURS}h).`);
    }
    if (confidenceDetail.timeStale) {
      reasons.push(`Time entries are stale or missing (requires within ${TIME_STALE_HOURS}h).`);
    }
    if (confidenceDetail.expenseStale) {
      reasons.push(`Expense data is stale or missing (requires within ${EXPENSE_STALE_HOURS}h).`);
    }
    if (unassignedExpenseCount > 0) {
      reasons.push(`${unassignedExpenseCount} unassigned expense${unassignedExpenseCount === 1 ? "" : "s"} awaiting job coding.`);
    }
  }

  return reasons;
}

export function calculateJobHealth(input: JobHealthInput, now: Date = new Date()): JobHealthResult {
  validateInput(input);

  // --- Hours / labor ---
  const actualHours = input.approvedHours + input.provisionalHours;
  const expectedRemainingHours =
    input.remainingWorkdays !== null && input.expectedCrewSize !== null
      ? input.remainingWorkdays * input.expectedCrewSize * input.hoursPerDay
      : Math.max(0, input.budgetHours - actualHours);
  const forecastHours = roundToCent(actualHours + expectedRemainingHours);
  const remainingLaborCost = expectedRemainingHours * input.expectedRemainingLaborRate;
  const forecastAllocatedOverhead = roundToCent(forecastHours * input.overheadRate);

  // --- Cost categories ---
  const forecastCategoryCost = zeroAmounts();
  forecastCategoryCost.direct_labor = roundToCent(
    input.approvedActual.direct_labor + input.provisionalActual.direct_labor + remainingLaborCost,
  );
  for (const category of NONLABOR_CATEGORIES) {
    forecastCategoryCost[category] = roundToCent(forecastNonlaborCategory(category, input));
  }

  const forecastCost = roundToCent(
    COST_CATEGORIES.reduce((sum, category) => sum + forecastCategoryCost[category], 0) + forecastAllocatedOverhead,
  );
  const forecastProfit = roundToCent(input.approvedRevenue - forecastCost);
  const forecastProfitPct =
    input.approvedRevenue === 0 ? 0 : roundToCent((forecastProfit / input.approvedRevenue) * 100);
  const profitRetentionPct =
    input.plannedProfit <= 0 ? 0 : roundToCent((forecastProfit / input.plannedProfit) * 100);

  // --- Confidence ---
  const confidenceDetail = computeConfidence(input, now);
  const { confidence } = confidenceDetail;

  // --- Health precedence ---
  const negativeProfit = forecastProfit < 0;
  const retentionAtRisk = profitRetentionPct < AT_RISK_RETENTION_PCT;
  const retentionWatch = profitRetentionPct < WATCH_RETENTION_PCT;
  const retentionWatchOnly = retentionWatch && !retentionAtRisk;
  const hoursOverrun = forecastHours > input.budgetHours * HOURS_OVERRUN_MULTIPLIER;
  const confidenceNotHigh = confidence !== "high";

  let health: HealthStatus;
  if (negativeProfit || retentionAtRisk) {
    health = "at_risk";
  } else if (retentionWatch || hoursOverrun || input.unresolvedScopeChange || confidenceNotHigh) {
    health = "watch";
  } else {
    health = "on_track";
  }

  const reasons = buildReasons({
    negativeProfit,
    retentionAtRisk,
    retentionWatchOnly,
    hoursOverrun,
    unresolvedScopeChange: input.unresolvedScopeChange,
    confidenceNotHigh,
    forecastProfit,
    profitRetentionPct,
    forecastHours,
    budgetHours: input.budgetHours,
    confidence,
    confidenceDetail,
    unassignedExpenseCount: input.unassignedExpenseCount,
  });

  return {
    health,
    confidence,
    forecastHours,
    forecastCategoryCost,
    forecastAllocatedOverhead,
    forecastCost,
    forecastProfit,
    forecastProfitPct,
    profitRetentionPct,
    reasons,
  };
}
