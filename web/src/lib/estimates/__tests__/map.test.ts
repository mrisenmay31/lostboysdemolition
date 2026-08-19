import { describe, expect, it } from "vitest";
import { mapDraftToEstimatePayload } from "@/lib/estimates/map";
import type { EstimateDraft } from "@/lib/estimates/types";
import { roundToCent, type EstimateOutputs } from "@/lib/pricing";
import type { RatesConfig } from "@/lib/rates";
import type { EstimateActor } from "@/lib/estimates/types";

const draft: EstimateDraft = {
  jobName: "Jorge's Interior",
  clientName: "Jorge Ramirez",
  clientType: "Homeowner",
  clientEmail: "jorge@example.com",
  clientPhone: "555-0100",
  jobAddress: "123 Main St",
  city: "Provo",
  jobType: "Residential",
  jobDetails: "Interior demo",
  laborMethod: "total_hours",
  totalJobHours: 34,
  dumpCount: 1,
  jobSpecificCosts: 0,
  markupPct: 25,
  materialsCost: 0,
  rentalsCost: 0,
  expectedDumpCost: 65,
  subcontractorsCost: 0,
  otherDirectCost: 0,
  // Fix round F10: 86.01, not an arbitrary value — the real Jorge's
  // Interior golden-master ccFee (see pricing.test.ts's
  // "reproduces the Jorge's Interior golden-master case", CLAUDE.md's
  // Pricing Benchmarks, and estimateEconomics.test.ts's "(Jorge case)").
  // Aligning this fixture's numbers with the shared golden record — rather
  // than a plausible-looking but disconnected made-up value — is what
  // makes hard-pinning the financialDetails literals below meaningful.
  expectedProcessingCost: 86.01,
  lineItems: [
    {
      scopeLibraryId: "11111111-1111-1111-1111-111111111111",
      name: "Interior demo",
      description: "Full interior",
      laborHours: 34,
      dumpCount: 1,
      materialsCost: 0,
      sortOrder: 0,
    },
  ],
};

// Fix round F10: the real Jorge's Interior golden-master engine output
// (totalJobHours=34, dumpCount=1, markupPct=25 against DEFAULT_RATES) —
// see pricing.test.ts. ccFee/totalBid previously carried disconnected
// made-up values (89.29 / 2546.79) that happened to share the job/client
// names but not the real numbers.
const outputs: EstimateOutputs = {
  effectiveHours: 34,
  laborCost: 884,
  dumpFees: 300,
  totalDirect: 1184,
  overhead: 782,
  profit: 491.5,
  ccFee: 86.01,
  totalBid: 2543.51,
  trueMarginPct: 19.32,
};

const ratesConfig: RatesConfig = {
  rates: {
    laborRatePerHour: 26,
    overheadRatePerHour: 23,
    dumpRatePerLoad: 300,
    ccFeeRate: 0.035,
  },
  defaultMarkupPct: 25,
  markupFloorPct: 15,
  estimatedDumpCostPerLoad: 65,
};

const user: EstimateActor = { id: null, name: "Dane" };

describe("mapDraftToEstimatePayload — writer contract", () => {
  it("version-1 payload OMITS estimate_number, version, and supersedes_estimate_id entirely", () => {
    const { estimate } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);

    expect("estimate_number" in estimate).toBe(false);
    expect("version" in estimate).toBe(false);
    expect("supersedes_estimate_id" in estimate).toBe(false);
  });

  it("newVersion payload sets estimate_number, version = parent+1, and supersedes_estimate_id = parent.id", () => {
    const { estimate } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user, {
      estimateNumber: 1414,
      version: 3,
      supersedesEstimateId: "33333333-3333-3333-3333-333333333333",
    });

    expect(estimate.estimate_number).toBe(1414);
    expect(estimate.version).toBe(3);
    expect(estimate.supersedes_estimate_id).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("snapshots the rate fields from RatesConfig onto the row", () => {
    const { estimate } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);

    expect(estimate.labor_rate).toBe(26);
    expect(estimate.overhead_rate).toBe(23);
    expect(estimate.dump_rate).toBe(300);
    expect(estimate.cc_fee_rate).toBe(0.035);
  });

  it("passes the 8 engine outputs through verbatim", () => {
    const { estimate } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);

    expect(estimate.labor_cost).toBe(outputs.laborCost);
    expect(estimate.dump_fees).toBe(outputs.dumpFees);
    expect(estimate.total_direct).toBe(outputs.totalDirect);
    expect(estimate.overhead).toBe(outputs.overhead);
    expect(estimate.profit).toBe(outputs.profit);
    expect(estimate.cc_fee).toBe(outputs.ccFee);
    expect(estimate.total_bid).toBe(outputs.totalBid);
    expect(estimate.true_margin_pct).toBe(outputs.trueMarginPct);
  });

  it("sets created_by / created_by_name from the passed-in user, and source = 'app'", () => {
    const { estimate } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);

    expect(estimate.created_by).toBeNull();
    expect(estimate.created_by_name).toBe(user.name);
    expect(estimate.source).toBe("app");
  });

  it("defaults is_path_b to false when the draft omits isPathB, and passes an explicit true through", () => {
    const { estimate: defaultPayload } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);
    expect(defaultPayload.is_path_b).toBe(false);

    const { estimate: pathBPayload } = mapDraftToEstimatePayload(
      { ...draft, isPathB: true },
      outputs,
      ratesConfig,
      user,
    );
    expect(pathBPayload.is_path_b).toBe(true);
  });

  it("maps header fields to snake_case, defaulting absent optionals to null", () => {
    const minimalDraft: EstimateDraft = {
      laborMethod: "days_employees",
      daysAtJob: 2,
      numEmployees: 3,
      dumpCount: 0,
      jobSpecificCosts: 0,
      markupPct: 25,
      materialsCost: 0,
      rentalsCost: 0,
      expectedDumpCost: 0,
      subcontractorsCost: 0,
      otherDirectCost: 0,
      expectedProcessingCost: 0,
      lineItems: [],
    };

    const { estimate, lineItems } = mapDraftToEstimatePayload(
      minimalDraft,
      outputs,
      ratesConfig,
      user,
    );

    expect(estimate.job_number).toBeNull();
    expect(estimate.job_name).toBeNull();
    expect(estimate.client_name).toBeNull();
    expect(estimate.client_type).toBeNull();
    expect(estimate.job_type).toBeNull();
    expect(estimate.labor_method).toBe("days_employees");
    expect(estimate.days_at_job).toBe(2);
    expect(estimate.num_employees).toBe(3);
    expect(estimate.quoted_price).toBeNull();
    expect(estimate.quote_override_reason).toBeNull();
    expect(estimate.is_path_b).toBe(false);
    expect(lineItems).toEqual([]);
  });

  it("maps line items to snake_case, defaulting sortOrder to array index when absent", () => {
    const { lineItems } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);

    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]).toMatchObject({
      scope_library_id: "11111111-1111-1111-1111-111111111111",
      name: "Interior demo",
      description: "Full interior",
      labor_hours: 34,
      dump_count: 1,
      materials_cost: 0,
      sort_order: 0,
    });
  });

  it("only sets a `status` key on the payload when the draft specifies one", () => {
    const { estimate: withoutStatus } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);
    expect("status" in withoutStatus).toBe(false);

    const { estimate: withStatus } = mapDraftToEstimatePayload(
      { ...draft, status: "sent" },
      outputs,
      ratesConfig,
      user,
    );
    expect(withStatus.status).toBe("sent");
  });
});

describe("mapDraftToEstimatePayload — financialDetails (Phase 1, v2 Task 2, lane 2d)", () => {
  // Fix round F10: pinned as hard literals, NOT recomputed by calling
  // computeEstimateEconomics() a second time inside the test — a
  // recomputation-based assertion passes even if computeEstimateEconomics
  // itself regresses, since the test would recompute the same (now wrong)
  // answer map.ts also produced. `draft`/`outputs` above are the real
  // Jorge's Interior golden-master numbers (F10's fixture-alignment fix),
  // so these four literals are independently hand-verifiable against
  // estimateEconomics.test.ts's own "(Jorge case)" pinned test and
  // CLAUDE.md's Pricing Benchmarks, not just internally consistent with
  // this file.
  it("computes financialDetails via computeEstimateEconomics, mapping outputs/draft fields per the documented recipe", () => {
    const { financialDetails } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);

    expect(financialDetails).toEqual({
      formula_version: "economic-v1",
      productive_hours: outputs.effectiveHours,
      operational_labor_cost: outputs.laborCost,
      materials_cost: draft.materialsCost,
      rentals_cost: draft.rentalsCost,
      expected_dump_cost: draft.expectedDumpCost,
      subcontractors_cost: draft.subcontractorsCost,
      other_direct_cost: draft.otherDirectCost,
      allocated_overhead: outputs.overhead,
      expected_processing_cost: draft.expectedProcessingCost,
      risk_pricing_allowance: 235,
      markup_amount: outputs.profit,
      processing_pricing_allowance: outputs.ccFee,
      discount_amount: 0,
      customer_price: 2543.51,
      planned_economic_profit: 726.5,
      planned_profit_pct: 28.56,
    });
  });

  it("never folds expectedDumpCost/expectedProcessingCost into jobSpecificCosts (estimate.job_specific_costs unaffected)", () => {
    const { estimate } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);
    // draft.jobSpecificCosts is passed through verbatim — this proves the
    // two new "expected*" cost fields never leak into the pricing-engine
    // input the estimate row's own job_specific_costs column carries.
    expect(estimate.job_specific_costs).toBe(draft.jobSpecificCosts);
  });

  it("cent-rounds every cost input before calling computeEstimateEconomics (precondition, review handoff #1)", () => {
    const noisyDraft: EstimateDraft = {
      ...draft,
      materialsCost: 10.005,
      rentalsCost: 0.001,
      expectedDumpCost: 64.999,
      subcontractorsCost: 0,
      otherDirectCost: 0,
      expectedProcessingCost: 89.294,
      quotedPrice: 2000.006,
      quoteOverrideReason: "rounding-noise test",
    };

    const { estimate, financialDetails } = mapDraftToEstimatePayload(noisyDraft, outputs, ratesConfig, user);

    expect(financialDetails.materials_cost).toBe(roundToCent(10.005));
    expect(financialDetails.rentals_cost).toBe(roundToCent(0.001));
    expect(financialDetails.expected_dump_cost).toBe(roundToCent(64.999));
    expect(financialDetails.expected_processing_cost).toBe(roundToCent(89.294));
    expect(financialDetails.customer_price).toBe(roundToCent(2000.006));
    // Fix round F11: estimate.quoted_price must round the SAME way
    // customer_price does — previously this column carried the raw,
    // unrounded draft value and could read a cent apart from
    // customer_price for the exact same override.
    expect(estimate.quoted_price).toBe(roundToCent(2000.006));
  });

  it("passes a null quotedPrice through as customerPrice = calculatedBid (no discount)", () => {
    const { financialDetails } = mapDraftToEstimatePayload(draft, outputs, ratesConfig, user);
    expect(financialDetails.customer_price).toBe(outputs.totalBid);
    expect(financialDetails.discount_amount).toBe(0);
  });

  it("records a positive discount_amount when quotedPrice is below the calculated bid", () => {
    const discountedDraft: EstimateDraft = {
      ...draft,
      quotedPrice: 2000,
      quoteOverrideReason: "repeat customer",
    };
    const { financialDetails } = mapDraftToEstimatePayload(discountedDraft, outputs, ratesConfig, user);

    expect(financialDetails.customer_price).toBe(2000);
    expect(financialDetails.discount_amount).toBe(roundToCent(outputs.totalBid - 2000));
  });
});
