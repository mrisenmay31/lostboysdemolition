import { describe, expect, it } from "vitest";
import { mapDraftToEstimatePayload } from "@/lib/estimates/map";
import type { EstimateDraft } from "@/lib/estimates/types";
import type { EstimateOutputs } from "@/lib/pricing";
import type { RatesConfig } from "@/lib/rates";
import type { AuthedUser } from "@/lib/auth";

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

const outputs: EstimateOutputs = {
  effectiveHours: 34,
  laborCost: 884,
  dumpFees: 300,
  totalDirect: 1184,
  overhead: 782,
  profit: 491.5,
  ccFee: 89.29,
  totalBid: 2546.79,
  trueMarginPct: 19.3,
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
};

const user: AuthedUser = { id: "22222222-2222-2222-2222-222222222222", name: "Dane" };

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

    expect(estimate.created_by).toBe(user.id);
    expect(estimate.created_by_name).toBe(user.name);
    expect(estimate.source).toBe("app");
  });

  it("maps header fields to snake_case, defaulting absent optionals to null", () => {
    const minimalDraft: EstimateDraft = {
      laborMethod: "days_employees",
      daysAtJob: 2,
      numEmployees: 3,
      dumpCount: 0,
      jobSpecificCosts: 0,
      markupPct: 25,
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
