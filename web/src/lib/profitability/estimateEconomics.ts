// ============================================================
// Lost Boys Demolition — web app — estimate economic-plan calculation
//
// PURE — no React, no Supabase, no "server-only", no I/O. Computes the
// PLANNING economics for one estimate version: separates the customer-
// facing quote math (`_shared/pricing.ts` / `computeEstimate()`, which this
// module never touches and never recomputes) from the cost/profit picture
// Dane and the dashboard actually reason about — operational cost, fully
// loaded cost (including allocated overhead and card-processing cost),
// the dump risk-pricing allowance, any quoted-price discount, and planned
// economic profit/margin.
//
// The output of this function is written ONCE, immutably, into
// `estimate_financial_details` at estimate-create time (Task 1's schema;
// wired by Task 2's `create_estimate_with_items_v2`) — it is the frozen
// planning record for that estimate version, not a live/mutable figure.
// It is deliberately NOT the accepted commercial price: the price a
// customer actually agreed to lives on the immutable
// `estimate_acceptance_events` row (`accepted_price`, per Phase 1 plan
// deviation 12), and `schedule_estimate` (v2 Task 4) mints `job_budget_versions`
// v1 revenue from THAT acceptance event, recomputing planned profit at
// budget-mint time — not from this module's `customerPrice`. This module
// does not handle presentation, acceptance, or scheduling in any way.
//
// Source of the calculation contract (types + function body reproduced
// verbatim, arithmetic hand-verified against both pinned test cases before
// implementation — see the module's test file): docs/superpowers/plans/
// 2026-08-18-live-job-profitability-health-dashboard-v2.md, Task 2, lines
// 715–837. See docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md
// Session 2 Lane 2a for the execution note.
//
// Rounding: every money and percentage output goes through `roundToCent`
// (see `@/lib/pricing`), matching the cascading-round style
// `_shared/pricing.ts` and `calculateJobHealth.ts` both use, so the number
// a human reads is always the number downstream fields were derived from.
// Precision notes (review-recorded, 2026-08-19):
//   - `roundToCent` is half-up for the non-negative values the pricing
//     engine produces; for the NEGATIVE values this module can emit
//     (riskPricingAllowance, discountAmount, plannedEconomicProfit,
//     plannedProfitPct), Math.round ties go toward zero instead — a ≤1¢
//     asymmetry accepted rather than forking the golden-321-gated rounder.
//   - PRECONDITION: every cost input MUST already be cent-rounded. The
//     inputs map 1:1 onto `numeric(12,2)` columns, and the two derived
//     totals (operationalDirectCost, fullyLoadedCost) are NOT persisted —
//     consumers re-derive them from the stored columns, which only agrees
//     to the cent when the inputs were cent-values to begin with.
//
// Sign is NOT validated here — the DB owns it (`customer_price`,
// `markup_amount`, `productive_hours` carry `>= 0` CHECKs;
// `discount_amount`/`risk_pricing_allowance`/`planned_economic_profit`/
// `planned_profit_pct` are deliberately unclamped and CAN go negative).
// The create path gets sign validation from `validate.ts`'s Zod schema;
// any future caller bypassing the draft schema must supply DB-legal signs.
//
// Consumers: when `customerPrice` is 0 (a deliberate $0 quote),
// `plannedProfitPct` is 0 by the divide-by-zero guard even though the job
// may be a total loss — key off the SIGN of `plannedEconomicProfit`, never
// the pct, in that case. Also note `productiveHours`, `markupAmount`, and
// `processingPricingAllowance` are validated but feed no output here —
// they are pass-through columns on the details row, not dead parameters.
//
// Throws on any non-finite numeric input (undefined/NaN/Infinity/string —
// including numeric strings, which Postgres `numeric` columns can
// deserialize as), matching the `calculateJobHealth.ts` idiom. `quotedPrice`
// is the one field allowed to be `null` (meaning "no discount/override —
// price to the calculated bid"); a non-finite non-null `quotedPrice` still
// throws, and a `quotedPrice` of exactly 0 is a real price, not "absent".
// ============================================================

import { roundToCent } from "@/lib/pricing";

export interface EstimateEconomicsInput {
  productiveHours: number;
  operationalLaborCost: number;
  materialsCost: number;
  rentalsCost: number;
  expectedDumpCost: number;
  subcontractorsCost: number;
  otherDirectCost: number;
  allocatedOverhead: number;
  expectedProcessingCost: number;
  dumpPricingBasis: number;
  markupAmount: number;
  processingPricingAllowance: number;
  calculatedBid: number;
  quotedPrice: number | null;
}

export interface EstimateEconomicsOutput {
  operationalDirectCost: number;
  fullyLoadedCost: number;
  riskPricingAllowance: number;
  discountAmount: number;
  customerPrice: number;
  plannedEconomicProfit: number;
  plannedProfitPct: number;
}

/** A single finite-number field check, matching the `requireFiniteField`
 *  idiom in `calculateJobHealth.ts` (itself mirroring `_shared/pricing.ts`'s
 *  `requireFinite`) — throws rather than letting a non-finite value
 *  (undefined, NaN, a string) fall through every arithmetic op below and
 *  silently produce a plausible-looking but meaningless economic plan. */
function requireFiniteField(name: string, v: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`computeEstimateEconomics: ${name} must be a finite number, got ${String(v)}`);
  }
  return v;
}

/** Same check, but `null` is a legitimate value — the only field on
 *  `EstimateEconomicsInput` that accepts it is `quotedPrice`. */
function requireFiniteOrNull(name: string, v: number | null): number | null {
  if (v === null) return null;
  return requireFiniteField(name, v);
}

function validateInput(input: EstimateEconomicsInput): void {
  requireFiniteField("productiveHours", input.productiveHours);
  requireFiniteField("operationalLaborCost", input.operationalLaborCost);
  requireFiniteField("materialsCost", input.materialsCost);
  requireFiniteField("rentalsCost", input.rentalsCost);
  requireFiniteField("expectedDumpCost", input.expectedDumpCost);
  requireFiniteField("subcontractorsCost", input.subcontractorsCost);
  requireFiniteField("otherDirectCost", input.otherDirectCost);
  requireFiniteField("allocatedOverhead", input.allocatedOverhead);
  requireFiniteField("expectedProcessingCost", input.expectedProcessingCost);
  requireFiniteField("dumpPricingBasis", input.dumpPricingBasis);
  requireFiniteField("markupAmount", input.markupAmount);
  requireFiniteField("processingPricingAllowance", input.processingPricingAllowance);
  requireFiniteField("calculatedBid", input.calculatedBid);
  requireFiniteOrNull("quotedPrice", input.quotedPrice);
}

export function computeEstimateEconomics(input: EstimateEconomicsInput): EstimateEconomicsOutput {
  validateInput(input);

  const operationalDirectCost = roundToCent(
    input.operationalLaborCost + input.materialsCost + input.rentalsCost +
    input.expectedDumpCost + input.subcontractorsCost + input.otherDirectCost,
  );
  const fullyLoadedCost = roundToCent(
    operationalDirectCost + input.allocatedOverhead + input.expectedProcessingCost,
  );
  // Not clamped at 0 by design: if `expectedDumpCost` (the real, expected
  // per-load cost) ever exceeds `dumpPricingBasis` (the priced-in dump
  // allowance — $300/load per CLAUDE.md "Pricing Benchmarks"), the
  // allowance is genuinely running a deficit on that job and the negative
  // number is the honest signal. `estimate_financial_details
  // .risk_pricing_allowance` (Task 1's schema) carries no `>= 0` CHECK for
  // exactly this reason — do not add one without revisiting this comment.
  const riskPricingAllowance = roundToCent(input.dumpPricingBasis - input.expectedDumpCost);
  const customerPrice = roundToCent(input.quotedPrice ?? input.calculatedBid);
  // Not clamped at 0 either: a `quotedPrice` set ABOVE `calculatedBid` (Dane
  // pricing a job up, not down) produces a negative `discountAmount` — a
  // markup-up. That's a legal, if unusual, use of the same override field;
  // nothing in the Task 2 contract or the DB schema forbids it, so this
  // module doesn't invent a floor that isn't specified.
  const discountAmount = roundToCent(input.calculatedBid - customerPrice);
  const plannedEconomicProfit = roundToCent(customerPrice - fullyLoadedCost);
  const plannedProfitPct = customerPrice === 0
    ? 0
    : roundToCent((plannedEconomicProfit / customerPrice) * 100);
  return {
    operationalDirectCost,
    fullyLoadedCost,
    riskPricingAllowance,
    discountAmount,
    customerPrice,
    plannedEconomicProfit,
    plannedProfitPct,
  };
}
