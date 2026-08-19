// ============================================================
// Lost Boys Demolition — web app — estimate draft -> RPC payload mapping
//
// PURE. Only a type-only import from a server-tagged module (@/lib/rates)
// so this file never pulls "server-only" in at runtime and stays trivially
// unit-testable. The actor argument is `EstimateActor` (./types, no
// server tag) — there is no login, so identity here is just the
// picker-declared name, not a verified session.
//
// THE WRITER CONTRACT (see supabase/migrations/20260814210000_phase_b2_rpcs_audit.sql
// and its 20260814215000 fixups, "version_chain" check):
//   version 1  -> p_estimate OMITS estimate_number entirely (not even
//                 `null` on the object key) so create_estimate_with_items'
//                 `coalesce(nullif(...,''), nextval(...))` mints a fresh
//                 number from estimate_number_seq.
//   version >1 -> p_estimate.estimate_number = parent's estimate_number,
//                 p_estimate.version = parent.version + 1,
//                 p_estimate.supersedes_estimate_id = parent.id. The RPC
//                 uses supersedes_estimate_id to flip the parent row to
//                 'superseded' in the same transaction.
//
// ECONOMIC DETAILS (Phase 1, v2 Task 2 / Session 2 lane 2d): also builds
// the `financialDetails` argument create_estimate_with_items_v2 inserts as
// one estimate_financial_details row in the same transaction, via
// `computeEstimateEconomics()` (web/src/lib/profitability/
// estimateEconomics.ts — lane 2a, imported here, never forked). Per that
// module's documented PRECONDITION, every cost input is cent-rounded HERE,
// immediately before the call — draft.materialsCost/rentalsCost/
// expectedDumpCost/subcontractorsCost/otherDirectCost/expectedProcessingCost/
// quotedPrice may carry float noise from client-side arithmetic; this is
// the one place that noise is scrubbed before it reaches either the
// economics engine or the DB's numeric(12,2) columns. `outputs` (the
// pricing engine's return) is already cent-rounded by computeEstimate()
// itself, so its fields are passed through as-is.
//
// Field mapping from EstimateOutputs -> EstimateEconomicsInput (documented
// once, here, since it isn't obvious from either side alone):
//   productiveHours          <- outputs.effectiveHours
//   operationalLaborCost     <- outputs.laborCost
//   allocatedOverhead        <- outputs.overhead
//   markupAmount             <- outputs.profit
//   dumpPricingBasis         <- outputs.dumpFees      (the PRICED dump allowance)
//   processingPricingAllowance <- outputs.ccFee        (the PRICED CC-fee allowance)
// The remaining six EstimateEconomicsInput fields come straight from the
// six draft cost fields (cent-rounded).
// ============================================================

import { roundToCent, type EstimateOutputs } from "@/lib/pricing";
import { computeEstimateEconomics } from "@/lib/profitability/estimateEconomics";
import type { RatesConfig } from "@/lib/rates";
import type { EstimateActor, EstimateDraft } from "./types";

/** Identifies the parent row a new version supersedes. Omit entirely for
 *  a version-1 create — that's what triggers the OMIT branch above. */
export interface VersionInfo {
  estimateNumber: number;
  version: number; // parent.version + 1
  supersedesEstimateId: string;
}

export interface EstimatePayload {
  estimate: Record<string, unknown>;
  lineItems: Record<string, unknown>[];
  /** Maps 1:1 onto create_estimate_with_items_v2's p_financial_details —
   *  one estimate_financial_details row, inserted in the same transaction
   *  as `estimate`/`lineItems`. `planned_profit_pct` on this object MUST
   *  be bounds-checked (validate.ts's validatePlannedProfitPctBounds)
   *  before this payload reaches the RPC — repo.ts does that. */
  financialDetails: Record<string, unknown>;
}

/**
 * Builds the two jsonb arguments create_estimate_with_items expects:
 * `p_estimate` (snake_case header row) and `p_line_items` (snake_case
 * array). Snapshots the rate fields the engine was run against AND the 8
 * engine outputs verbatim — both frozen forever once the row is inserted
 * (estimates are immutable by trigger).
 */
export function mapDraftToEstimatePayload(
  draft: EstimateDraft,
  outputs: EstimateOutputs,
  ratesConfig: RatesConfig,
  user: EstimateActor,
  versionInfo?: VersionInfo,
): EstimatePayload {
  const estimate: Record<string, unknown> = {
    job_number: draft.jobNumber ?? null,
    job_name: draft.jobName ?? null,
    client_name: draft.clientName ?? null,
    client_type: draft.clientType ?? null,
    client_email: draft.clientEmail ?? null,
    client_phone: draft.clientPhone ?? null,
    job_address: draft.jobAddress ?? null,
    city: draft.city ?? null,
    job_type: draft.jobType ?? null,
    estimate_date: draft.estimateDate ?? null,
    job_details: draft.jobDetails ?? null,
    labor_method: draft.laborMethod,
    total_job_hours: draft.totalJobHours ?? null,
    days_at_job: draft.daysAtJob ?? null,
    num_employees: draft.numEmployees ?? null,
    dump_count: draft.dumpCount,
    job_specific_costs: draft.jobSpecificCosts,
    markup_pct: draft.markupPct,
    // Rate snapshot — the exact rates computeEstimate() was run against,
    // frozen on the row so a later change to pricing_variables never
    // silently reinterprets a historical estimate.
    labor_rate: ratesConfig.rates.laborRatePerHour,
    overhead_rate: ratesConfig.rates.overheadRatePerHour,
    dump_rate: ratesConfig.rates.dumpRatePerLoad,
    cc_fee_rate: ratesConfig.rates.ccFeeRate,
    // Engine outputs, passed through verbatim — never hand-edited.
    labor_cost: outputs.laborCost,
    dump_fees: outputs.dumpFees,
    total_direct: outputs.totalDirect,
    overhead: outputs.overhead,
    profit: outputs.profit,
    cc_fee: outputs.ccFee,
    total_bid: outputs.totalBid,
    true_margin_pct: outputs.trueMarginPct,
    // Fix round F11: cent-round quoted_price at write, same as the
    // customer_price it feeds into financialDetails below
    // (quotedPriceForEconomics) — previously this raw draft value could
    // carry a cent of float noise (e.g. 2000.006) that customer_price
    // rounded away but this column didn't, letting the two silently read
    // one cent apart for the exact same override.
    quoted_price:
      draft.quotedPrice === null || draft.quotedPrice === undefined ? null : roundToCent(draft.quotedPrice),
    quote_override_reason: draft.quoteOverrideReason ?? null,
    source: "app",
    created_by: user.id,
    created_by_name: user.name,
    is_path_b: draft.isPathB ?? false,
  };

  if (draft.status) {
    estimate.status = draft.status;
  }

  if (versionInfo) {
    estimate.estimate_number = versionInfo.estimateNumber;
    estimate.version = versionInfo.version;
    estimate.supersedes_estimate_id = versionInfo.supersedesEstimateId;
  }
  // else: version-1 create — estimate_number/version/supersedes_estimate_id
  // keys are deliberately absent from the object, not set to null. The RPC
  // defaults version to 1 and mints estimate_number via nextval().

  const lineItems: Record<string, unknown>[] = draft.lineItems.map((item, index) => ({
    scope_library_id: item.scopeLibraryId ?? null,
    name: item.name,
    description: item.description ?? "",
    labor_hours: item.laborHours,
    dump_count: item.dumpCount,
    materials_cost: item.materialsCost,
    sort_order: item.sortOrder ?? index,
  }));

  // Cent-round every cost input BEFORE calling computeEstimateEconomics —
  // its documented PRECONDITION (estimateEconomics.ts header). outputs.*
  // fields are already cent-rounded by computeEstimate() itself.
  const materialsCost = roundToCent(draft.materialsCost);
  const rentalsCost = roundToCent(draft.rentalsCost);
  const expectedDumpCost = roundToCent(draft.expectedDumpCost);
  const subcontractorsCost = roundToCent(draft.subcontractorsCost);
  const otherDirectCost = roundToCent(draft.otherDirectCost);
  const expectedProcessingCost = roundToCent(draft.expectedProcessingCost);
  const quotedPriceForEconomics =
    draft.quotedPrice === null || draft.quotedPrice === undefined ? null : roundToCent(draft.quotedPrice);

  const economics = computeEstimateEconomics({
    productiveHours: outputs.effectiveHours,
    operationalLaborCost: outputs.laborCost,
    materialsCost,
    rentalsCost,
    expectedDumpCost,
    subcontractorsCost,
    otherDirectCost,
    allocatedOverhead: outputs.overhead,
    expectedProcessingCost,
    dumpPricingBasis: outputs.dumpFees,
    markupAmount: outputs.profit,
    processingPricingAllowance: outputs.ccFee,
    calculatedBid: outputs.totalBid,
    quotedPrice: quotedPriceForEconomics,
  });

  const financialDetails: Record<string, unknown> = {
    formula_version: "economic-v1",
    // Fix round F12: round to 2dp at write, matching the column's
    // numeric(8,2) storage — outputs.effectiveHours is already
    // well-behaved from computeEstimate() in practice, but nothing
    // upstream guarantees exactly 2 decimal places the way roundToCent
    // does for every money column on this row.
    productive_hours: roundToCent(outputs.effectiveHours),
    operational_labor_cost: outputs.laborCost,
    materials_cost: materialsCost,
    rentals_cost: rentalsCost,
    expected_dump_cost: expectedDumpCost,
    subcontractors_cost: subcontractorsCost,
    other_direct_cost: otherDirectCost,
    allocated_overhead: outputs.overhead,
    expected_processing_cost: expectedProcessingCost,
    risk_pricing_allowance: economics.riskPricingAllowance,
    markup_amount: outputs.profit,
    processing_pricing_allowance: outputs.ccFee,
    discount_amount: economics.discountAmount,
    customer_price: economics.customerPrice,
    planned_economic_profit: economics.plannedEconomicProfit,
    planned_profit_pct: economics.plannedProfitPct,
  };

  return { estimate, lineItems, financialDetails };
}
