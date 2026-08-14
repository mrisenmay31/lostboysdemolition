// ============================================================
// Lost Boys Demolition — pricing engine
// Ports the live Fillout calculator chain EXACTLY (DISCOVERY_2026-07-31.md §1).
// Cost-plus MARKUP, never a margin divisor. Golden-master verification against
// all 321 live Airtable estimates is Task 2's forthcoming pricing_golden_test.ts
// — not yet written, so treat that verification as pending, not complete.
// ============================================================

export interface Rates {
  laborRatePerHour: number;
  overheadRatePerHour: number;
  dumpRatePerLoad: number;
  ccFeeRate: number; // e.g. 0.035
}

export const DEFAULT_RATES: Rates = {
  laborRatePerHour: 26,
  overheadRatePerHour: 23,
  dumpRatePerLoad: 300,
  ccFeeRate: 0.035,
};

export type LaborMethod = "total_hours" | "days_employees";

export interface EstimateInputs {
  laborMethod: LaborMethod;
  totalJobHours?: number;   // required when laborMethod === "total_hours"
  daysAtJob?: number;       // required when laborMethod === "days_employees"
  numEmployees?: number;    // required when laborMethod === "days_employees"
  dumpCount: number;        // fractional allowed (0.5 observed live)
  jobSpecificCosts: number; // "Direct Costs" / rentals etc.
  markupPct: number;        // whole number, e.g. 25 — a MARKUP on cost, not a margin
}

export interface EstimateOutputs {
  effectiveHours: number;
  laborCost: number;
  dumpFees: number;
  totalDirect: number;
  overhead: number;
  profit: number;
  ccFee: number;
  totalBid: number;
  trueMarginPct: number; // profit / totalBid × 100 — reported alongside the markup
}

export function roundToCent(n: number): number {
  // True decimal half-up: scale to cents, clean up binary float noise with a
  // precision guard, then round half-away-from-zero (Math.round is half-up
  // for the non-negative values this engine only ever rounds).
  return Math.round(Number((n * 100).toPrecision(12))) / 100;
}

function requireFinite(name: string, v: number | undefined, { min = 0 } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`pricing: ${name} must be a finite number, got ${v}`);
  }
  if (v < min) throw new Error(`pricing: ${name} must be >= ${min}, got ${v}`);
  return v;
}

function requireRates(rates: Rates): void {
  requireFinite("rates.laborRatePerHour", rates.laborRatePerHour);
  requireFinite("rates.overheadRatePerHour", rates.overheadRatePerHour);
  requireFinite("rates.dumpRatePerLoad", rates.dumpRatePerLoad);
  const ccFeeRate = requireFinite("rates.ccFeeRate", rates.ccFeeRate);
  if (ccFeeRate >= 1) {
    throw new Error(`pricing: rates.ccFeeRate must be < 1, got ${ccFeeRate}`);
  }
}

export function computeEstimate(
  inputs: EstimateInputs,
  rates: Rates = DEFAULT_RATES,
): EstimateOutputs {
  requireRates(rates);
  const dumpCount = requireFinite("dumpCount", inputs.dumpCount);
  const jobSpecificCosts = requireFinite("jobSpecificCosts", inputs.jobSpecificCosts);
  const markupPct = requireFinite("markupPct", inputs.markupPct);

  let effectiveHours: number;
  if (inputs.laborMethod === "total_hours") {
    effectiveHours = requireFinite("totalJobHours", inputs.totalJobHours);
  } else if (inputs.laborMethod === "days_employees") {
    const days = requireFinite("daysAtJob", inputs.daysAtJob);
    const emps = requireFinite("numEmployees", inputs.numEmployees);
    effectiveHours = days * emps * 8;
  } else {
    throw new Error(`pricing: unknown laborMethod ${(inputs as { laborMethod: string }).laborMethod}`);
  }

  const laborCost = roundToCent(rates.laborRatePerHour * effectiveHours);
  const dumpFees = roundToCent(rates.dumpRatePerLoad * dumpCount);
  const totalDirect = roundToCent(laborCost + dumpFees + jobSpecificCosts);
  const overhead = roundToCent(rates.overheadRatePerHour * effectiveHours);
  const profit = roundToCent((totalDirect + overhead) * markupPct / 100);
  const ccFee = roundToCent((totalDirect + overhead + profit) * rates.ccFeeRate);
  const totalBid = roundToCent(totalDirect + overhead + profit + ccFee);
  const trueMarginPct = totalBid === 0 ? 0 : roundToCent((profit / totalBid) * 100);

  return { effectiveHours, laborCost, dumpFees, totalDirect, overhead, profit, ccFee, totalBid, trueMarginPct };
}
