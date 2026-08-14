import { describe, expect, it } from "vitest";
import {
  AIRTABLE_JOB_ID_FIELD_ID,
  ESTIMATE_FIELD_IDS,
  JOB_INFO_FIELD_IDS,
  buildEstimateCustomFields,
  buildJobScopeSelection,
  buildScopeNotes,
  computeLaborHoursField,
  decideDocAction,
  decideDocPreflight,
  extractDocStatus,
  findExistingOpportunityByName,
  opportunityName,
  selectInheritedState,
  splitClientName,
  type BuildScopeNotesInput,
} from "@/lib/ghl/estimateFields";
import type { EstimateLineItemRow, EstimateRow } from "@/lib/estimates/types";
import type { GhlOpportunity } from "@/lib/ghl/types";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeEstimate(overrides: Partial<EstimateRow> = {}): EstimateRow {
  return {
    id: "estimate-uuid-1",
    estimate_number: 1416,
    version: 1,
    supersedes_estimate_id: null,
    status: "draft",
    job_number: null,
    job_name: "Jorge's Interior Demo",
    client_name: "Jorge Ramirez",
    client_type: "Homeowner",
    client_email: "jorge@example.com",
    client_phone: "+18015551234",
    job_address: "123 Main St, Salt Lake City, UT",
    city: "Salt Lake City",
    job_type: "Residential",
    estimate_date: "2026-08-14",
    job_details: null,
    labor_method: "total_hours",
    total_job_hours: 8,
    days_at_job: null,
    num_employees: null,
    dump_count: 1,
    job_specific_costs: 0,
    markup_pct: 25,
    labor_rate: 26,
    overhead_rate: 23,
    dump_rate: 300,
    cc_fee_rate: 0.035,
    labor_cost: 208,
    dump_fees: 300,
    total_direct: 508,
    overhead: 184,
    profit: 173,
    cc_fee: 30.36,
    total_bid: 895.36,
    true_margin_pct: 19.3,
    quoted_price: null,
    quote_override_reason: null,
    source: "app",
    airtable_estimate_id: null,
    created_at: "2026-08-14T12:00:00Z",
    created_by: null,
    created_by_name: "Dane",
    ...overrides,
  };
}

function makeLineItem(overrides: Partial<EstimateLineItemRow> = {}): EstimateLineItemRow {
  return {
    id: "li-1",
    estimate_id: "estimate-uuid-1",
    scope_library_id: null,
    name: "Kitchen Demo",
    description: "",
    labor_hours: 4,
    dump_count: 0.5,
    materials_cost: 0,
    sort_order: 0,
    created_at: "2026-08-14T12:00:00Z",
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<GhlOpportunity> = {}): GhlOpportunity {
  return { id: "opp-1", name: "Jorge's Interior Demo", ...overrides };
}

// ── computeLaborHoursField ──────────────────────────────────────────────

describe("computeLaborHoursField", () => {
  it("divides labor_cost by labor_rate", () => {
    expect(computeLaborHoursField(208, 26)).toBe(8);
  });

  it("returns 0 when labor_rate is 0", () => {
    expect(computeLaborHoursField(208, 0)).toBe(0);
  });

  it("returns 0 when labor_rate is negative", () => {
    expect(computeLaborHoursField(208, -5)).toBe(0);
  });

  it("returns 0 when labor_cost is NaN", () => {
    expect(computeLaborHoursField(NaN, 26)).toBe(0);
  });

  it("returns 0 when labor_rate is not finite", () => {
    expect(computeLaborHoursField(208, Infinity)).toBe(0);
  });
});

// ── buildJobScopeSelection ──────────────────────────────────────────────

describe("buildJobScopeSelection", () => {
  const options = ["Kitchen Demo", "Bathroom Demo", "Full House Gut"];

  it("matches exact names and returns the option's canonical string", () => {
    const result = buildJobScopeSelection(["Kitchen Demo", "Bathroom Demo"], options);
    expect(result.matched).toEqual(["Kitchen Demo", "Bathroom Demo"]);
    expect(result.dropped).toEqual([]);
  });

  it("matches case-insensitively and trims whitespace, but returns canonical option casing", () => {
    const result = buildJobScopeSelection([" kitchen demo ", "BATHROOM DEMO"], options);
    expect(result.matched).toEqual(["Kitchen Demo", "Bathroom Demo"]);
  });

  it("drops names with no match into the dropped list, deduplicated", () => {
    const result = buildJobScopeSelection(["Kitchen Demo", "Custom Deck Tear-Out", "Custom Deck Tear-Out"], options);
    expect(result.matched).toEqual(["Kitchen Demo"]);
    expect(result.dropped).toEqual(["Custom Deck Tear-Out"]);
  });

  it("deduplicates repeated matched names, preserving first-seen order", () => {
    const result = buildJobScopeSelection(["Bathroom Demo", "Kitchen Demo", "Bathroom Demo"], options);
    expect(result.matched).toEqual(["Bathroom Demo", "Kitchen Demo"]);
  });

  it("skips blank/empty line item names", () => {
    const result = buildJobScopeSelection(["", "   ", "Kitchen Demo"], options);
    expect(result.matched).toEqual(["Kitchen Demo"]);
    expect(result.dropped).toEqual([]);
  });

  it("drops everything when the option list is empty (e.g. a degraded live-fetch)", () => {
    const result = buildJobScopeSelection(["Kitchen Demo", "Bathroom Demo"], []);
    expect(result.matched).toEqual([]);
    expect(result.dropped).toEqual(["Kitchen Demo", "Bathroom Demo"]);
  });
});

// ── buildScopeNotes ──────────────────────────────────────────────────────

describe("buildScopeNotes", () => {
  function baseInput(overrides: Partial<BuildScopeNotesInput> = {}): BuildScopeNotesInput {
    return {
      estimate: makeEstimate(),
      lineItems: [],
      droppedScopeNames: [],
      docNumber: null,
      ...overrides,
    };
  }

  it("renders estimate number and version", () => {
    const notes = buildScopeNotes(baseInput({ estimate: makeEstimate({ estimate_number: 1416, version: 2 }) }));
    expect(notes).toContain("Estimate #1416 v2");
  });

  it("renders 'Total Bid' (not 'Calculated/Quoted') when quoted_price is null", () => {
    const notes = buildScopeNotes(baseInput({ estimate: makeEstimate({ quoted_price: null, total_bid: 895.36 }) }));
    expect(notes).toContain("Total Bid: $895.36");
    expect(notes).not.toContain("Quoted:");
  });

  it("renders 'Total Bid' when quoted_price equals total_bid (not an override)", () => {
    const notes = buildScopeNotes(
      baseInput({ estimate: makeEstimate({ quoted_price: 895.36, total_bid: 895.36 }) }),
    );
    expect(notes).toContain("Total Bid: $895.36");
    expect(notes).not.toContain("Quoted:");
  });

  it("renders Calculated vs Quoted + reason when quoted_price differs from total_bid", () => {
    const notes = buildScopeNotes(
      baseInput({
        estimate: makeEstimate({
          total_bid: 2543.51,
          quoted_price: 2000,
          quote_override_reason: "Repeat customer discount",
        }),
      }),
    );
    expect(notes).toContain("Calculated: $2543.51 | Quoted: $2000.00 (reason: Repeat customer discount)");
  });

  it("renders Calculated vs Quoted WITHOUT a reason clause when quote_override_reason is null", () => {
    const notes = buildScopeNotes(
      baseInput({ estimate: makeEstimate({ total_bid: 2543.51, quoted_price: 2000, quote_override_reason: null }) }),
    );
    expect(notes).toContain("Calculated: $2543.51 | Quoted: $2000.00");
    expect(notes).not.toContain("reason:");
  });

  it("renders markup and true margin", () => {
    const notes = buildScopeNotes(baseInput({ estimate: makeEstimate({ markup_pct: 25, true_margin_pct: 19.3 }) }));
    expect(notes).toContain("Markup: 25% | True margin: 19.3%");
  });

  it("omits the line-items section entirely when there are no line items", () => {
    const notes = buildScopeNotes(baseInput({ lineItems: [] }));
    expect(notes).not.toContain("Line items:");
  });

  it("renders one line per item with hours/dumps/materials/allocated price, sorted by sort_order", () => {
    const estimate = makeEstimate({ quoted_price: null, total_bid: 100.01, labor_rate: 26, dump_rate: 300 });
    const lineItems = [
      makeLineItem({ name: "Kitchen Demo", sort_order: 2, labor_hours: 4, dump_count: 0, materials_cost: 0 }),
      makeLineItem({ name: "Bathroom Demo", sort_order: 1, labor_hours: 2, dump_count: 0, materials_cost: 0 }),
      makeLineItem({ name: "Haul Away", sort_order: 3, labor_hours: 0, dump_count: 0.5, materials_cost: 25 }),
    ];
    const notes = buildScopeNotes(baseInput({ estimate, lineItems }));

    const lines = notes.split("\n");
    const bathroomLine = lines.find((l) => l.startsWith("- Bathroom Demo"));
    const kitchenLine = lines.find((l) => l.startsWith("- Kitchen Demo"));
    const haulLine = lines.find((l) => l.startsWith("- Haul Away"));

    expect(lines.indexOf(bathroomLine!)).toBeLessThan(lines.indexOf(kitchenLine!));
    expect(kitchenLine).toMatch(/4 hrs, 0 dumps, \$0\.00 materials/);
    expect(haulLine).toMatch(/0 hrs, 0\.5 dumps, \$25\.00 materials/);

    // allocated prices sum to the doc total (total_bid, since quoted_price is null)
    const amountRegex = /— \$(\d+\.\d{2})$/;
    const sum = [bathroomLine, kitchenLine, haulLine]
      .map((l) => Number(amountRegex.exec(l!)?.[1]))
      .reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(100.01);
  });

  it("uses singular 'dump' for a dump_count of exactly 1", () => {
    const lineItems = [makeLineItem({ name: "Concrete Demo", dump_count: 1 })];
    const notes = buildScopeNotes(baseInput({ lineItems, estimate: makeEstimate({ quoted_price: 500 }) }));
    expect(notes).toContain("1 dump,");
    expect(notes).not.toContain("1 dumps,");
  });

  it("renders the dropped-scope-names note only when there are dropped names", () => {
    const notesWithout = buildScopeNotes(baseInput({ droppedScopeNames: [] }));
    expect(notesWithout).not.toContain("Scope not in GHL Job Scope list");

    const notesWith = buildScopeNotes(baseInput({ droppedScopeNames: ["Custom Deck Tear-Out"] }));
    expect(notesWith).toContain("Scope not in GHL Job Scope list: Custom Deck Tear-Out");
  });

  it("renders the GHL doc number only when known", () => {
    const notesWithout = buildScopeNotes(baseInput({ docNumber: null }));
    expect(notesWithout).not.toContain("GHL Doc #");

    const notesWith = buildScopeNotes(baseInput({ docNumber: "EST-1234" }));
    expect(notesWith).toContain("GHL Doc #: EST-1234");
  });
});

// ── buildEstimateCustomFields ────────────────────────────────────────────

describe("buildEstimateCustomFields", () => {
  it("maps every field to its documented GHL field id", () => {
    const estimate = makeEstimate({
      labor_cost: 208,
      job_specific_costs: 50,
      dump_fees: 300,
      overhead: 184,
      profit: 173,
      true_margin_pct: 19.3,
      job_address: "123 Main St",
      job_type: "Residential",
      job_number: "JOB-1104",
      created_by_name: "Dane",
    });

    const fields = buildEstimateCustomFields({
      estimate,
      laborHours: 8,
      jobScopeMatched: ["Kitchen Demo"],
      scopeNotes: "Estimate #1416 v1",
    });

    const byId = new Map(fields.map((f) => [f.id, f.field_value]));
    expect(byId.get(ESTIMATE_FIELD_IDS.laborHours)).toBe(8);
    expect(byId.get(ESTIMATE_FIELD_IDS.laborCost)).toBe(208);
    expect(byId.get(ESTIMATE_FIELD_IDS.materials)).toBe(50);
    expect(byId.get(ESTIMATE_FIELD_IDS.dumpFees)).toBe(300);
    expect(byId.get(ESTIMATE_FIELD_IDS.overhead)).toBe(184);
    expect(byId.get(ESTIMATE_FIELD_IDS.profit)).toBe(173);
    expect(byId.get(ESTIMATE_FIELD_IDS.trueMargin)).toBe(19.3);
    expect(byId.get(ESTIMATE_FIELD_IDS.jobScope)).toEqual(["Kitchen Demo"]);
    expect(byId.get(ESTIMATE_FIELD_IDS.scopeNotes)).toBe("Estimate #1416 v1");
    expect(byId.get(JOB_INFO_FIELD_IDS.jobAddress)).toBe("123 Main St");
    expect(byId.get(JOB_INFO_FIELD_IDS.jobType)).toBe("Residential");
    expect(byId.get(JOB_INFO_FIELD_IDS.estimator)).toBe("Dane");
    expect(byId.get(AIRTABLE_JOB_ID_FIELD_ID)).toBe("JOB-1104");
  });

  it("omits Airtable Job ID entirely when job_number is null (never sends a placeholder)", () => {
    const fields = buildEstimateCustomFields({
      estimate: makeEstimate({ job_number: null }),
      laborHours: 8,
      jobScopeMatched: [],
      scopeNotes: "x",
    });
    expect(fields.some((f) => f.id === AIRTABLE_JOB_ID_FIELD_ID)).toBe(false);
  });

  it("omits Estimator entirely when created_by_name is null (never the pusher's session identity)", () => {
    const fields = buildEstimateCustomFields({
      estimate: makeEstimate({ created_by_name: null }),
      laborHours: 8,
      jobScopeMatched: [],
      scopeNotes: "x",
    });
    expect(fields.some((f) => f.id === JOB_INFO_FIELD_IDS.estimator)).toBe(false);
  });

  it("omits Job Scope entirely when nothing matched (empty array)", () => {
    const fields = buildEstimateCustomFields({
      estimate: makeEstimate(),
      laborHours: 8,
      jobScopeMatched: [],
      scopeNotes: "x",
    });
    expect(fields.some((f) => f.id === ESTIMATE_FIELD_IDS.jobScope)).toBe(false);
  });

  it("sends a numeric field value of 0 (not omitted as falsy)", () => {
    const fields = buildEstimateCustomFields({
      estimate: makeEstimate({ job_specific_costs: 0 }),
      laborHours: 8,
      jobScopeMatched: [],
      scopeNotes: "x",
    });
    const materials = fields.find((f) => f.id === ESTIMATE_FIELD_IDS.materials);
    expect(materials?.field_value).toBe(0);
  });
});

// ── opportunityName ────────────────────────────────────────────────────

describe("opportunityName", () => {
  it("prefers job_name", () => {
    expect(opportunityName({ job_name: "Jorge's Interior", job_address: "123 Main St", estimate_number: 1416 })).toBe(
      "Jorge's Interior",
    );
  });

  it("falls back to job_address when job_name is absent", () => {
    expect(opportunityName({ job_name: null, job_address: "456 Oak Ave", estimate_number: 1416 })).toBe(
      "456 Oak Ave",
    );
  });

  it("falls back to 'Estimate #N' when both are absent", () => {
    expect(opportunityName({ job_name: null, job_address: null, estimate_number: 1416 })).toBe("Estimate #1416");
  });

  it("is NOT truncated at 40 chars (unlike the doc name)", () => {
    const longName = "Blue Ridge Builders - Full Interior Demolition Project, Phase 2";
    expect(opportunityName({ job_name: longName, job_address: null, estimate_number: 1416 })).toBe(longName);
  });
});

// ── splitClientName ────────────────────────────────────────────────────

describe("splitClientName", () => {
  it("splits a two-token name into first/last", () => {
    expect(splitClientName("Jorge Ramirez")).toEqual({ firstName: "Jorge", lastName: "Ramirez" });
  });

  it("joins remaining tokens into lastName for a multi-token name", () => {
    expect(splitClientName("Mary Jane Watson")).toEqual({ firstName: "Mary", lastName: "Jane Watson" });
  });

  it("handles a single-token name", () => {
    expect(splitClientName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("handles null/undefined/blank gracefully", () => {
    expect(splitClientName(null)).toEqual({ firstName: "", lastName: "" });
    expect(splitClientName(undefined)).toEqual({ firstName: "", lastName: "" });
    expect(splitClientName("   ")).toEqual({ firstName: "", lastName: "" });
  });

  it("collapses extra internal whitespace", () => {
    expect(splitClientName("Jorge   Ramirez")).toEqual({ firstName: "Jorge", lastName: "Ramirez" });
  });
});

// ── decideDocPreflight ─────────────────────────────────────────────────

describe("decideDocPreflight", () => {
  it("proceeds when not Path B and both email+phone are present", () => {
    expect(decideDocPreflight({ isPathB: false, contactEmail: "a@b.com", contactPhone: "+18015551234" })).toEqual({
      proceed: true,
    });
  });

  it("skips as skipped_path_b when isPathB is true, even with full contact info", () => {
    expect(decideDocPreflight({ isPathB: true, contactEmail: "a@b.com", contactPhone: "+18015551234" })).toEqual({
      proceed: false,
      reason: "skipped_path_b",
    });
  });

  it("skips as skipped_missing_contact when email is missing", () => {
    expect(decideDocPreflight({ isPathB: false, contactEmail: null, contactPhone: "+18015551234" })).toEqual({
      proceed: false,
      reason: "skipped_missing_contact",
    });
  });

  it("skips as skipped_missing_contact when phone is missing", () => {
    expect(decideDocPreflight({ isPathB: false, contactEmail: "a@b.com", contactPhone: null })).toEqual({
      proceed: false,
      reason: "skipped_missing_contact",
    });
  });

  it("Path B takes priority over a missing-contact condition", () => {
    expect(decideDocPreflight({ isPathB: true, contactEmail: null, contactPhone: null })).toEqual({
      proceed: false,
      reason: "skipped_path_b",
    });
  });
});

// ── decideDocAction ────────────────────────────────────────────────────

describe("decideDocAction", () => {
  it("creates when there's no known doc id", () => {
    expect(decideDocAction(null, null)).toBe("create");
  });

  it("replaces when the known doc is still draft", () => {
    expect(decideDocAction("doc-1", "draft")).toBe("replace");
  });

  it("replaces when the known doc's status is unknown (e.g. a fresh crash-recovery match)", () => {
    expect(decideDocAction("doc-1", null)).toBe("replace");
  });

  it("revises (creates a new doc) when the known doc has moved past draft", () => {
    expect(decideDocAction("doc-1", "sent")).toBe("revise");
    expect(decideDocAction("doc-1", "viewed")).toBe("revise");
    expect(decideDocAction("doc-1", "accepted")).toBe("revise");
    expect(decideDocAction("doc-1", "declined")).toBe("revise");
  });
});

// ── extractDocStatus ────────────────────────────────────────────────────

describe("extractDocStatus", () => {
  it("finds a doc's status by _id in the { estimates: [...] } shape", () => {
    const response = { estimates: [{ _id: "doc-1", status: "sent" }, { _id: "doc-2", status: "draft" }] };
    expect(extractDocStatus(response, "doc-1")).toBe("sent");
    expect(extractDocStatus(response, "doc-2")).toBe("draft");
  });

  it("finds a doc's status by id (not _id)", () => {
    const response = { estimates: [{ id: "doc-1", status: "viewed" }] };
    expect(extractDocStatus(response, "doc-1")).toBe("viewed");
  });

  it("tolerates a bare-array response shape", () => {
    expect(extractDocStatus([{ _id: "doc-1", status: "accepted" }], "doc-1")).toBe("accepted");
  });

  it("returns null when the doc id isn't found", () => {
    const response = { estimates: [{ _id: "doc-other", status: "sent" }] };
    expect(extractDocStatus(response, "doc-1")).toBeNull();
  });

  it("returns null for a null/empty/malformed response", () => {
    expect(extractDocStatus(null, "doc-1")).toBeNull();
    expect(extractDocStatus({}, "doc-1")).toBeNull();
    expect(extractDocStatus({ estimates: [] }, "doc-1")).toBeNull();
  });
});

// ── findExistingOpportunityByName ──────────────────────────────────────

describe("findExistingOpportunityByName", () => {
  it("finds an exact name match", () => {
    const opps = [makeOpportunity({ id: "opp-1", name: "Other Job" }), makeOpportunity({ id: "opp-2", name: "Jorge's Interior Demo" })];
    expect(findExistingOpportunityByName(opps, "Jorge's Interior Demo")).toEqual(opps[1]);
  });

  it("returns null when there's no match", () => {
    const opps = [makeOpportunity({ name: "Other Job" })];
    expect(findExistingOpportunityByName(opps, "Jorge's Interior Demo")).toBeNull();
  });

  it("is case-sensitive (exact match only — the caller controls both sides)", () => {
    const opps = [makeOpportunity({ name: "jorge's interior demo" })];
    expect(findExistingOpportunityByName(opps, "Jorge's Interior Demo")).toBeNull();
  });

  it("returns null for an empty opportunity list", () => {
    expect(findExistingOpportunityByName([], "Anything")).toBeNull();
  });
});

// ── selectInheritedState ───────────────────────────────────────────────

describe("selectInheritedState", () => {
  it("returns null when there are no ancestors", () => {
    const result = selectInheritedState([{ id: "self", version: 1 }], {}, "self");
    expect(result).toBeNull();
  });

  it("returns the nearest ancestor's state (highest version below self) when found", () => {
    const chain = [
      { id: "v1", version: 1 },
      { id: "v2", version: 2 },
      { id: "v3", version: 3 },
    ];
    const states = {
      v1: { estimate_id: "v1", ghl_opportunity_id: "opp-from-v1" },
      v2: { estimate_id: "v2", ghl_opportunity_id: "opp-from-v2" },
    };
    const result = selectInheritedState(chain, states, "v3");
    expect(result).toEqual({ estimate_id: "v2", ghl_opportunity_id: "opp-from-v2" });
  });

  it("walks past ancestors with no state to find an older one that has it", () => {
    const chain = [
      { id: "v1", version: 1 },
      { id: "v2", version: 2 },
      { id: "v3", version: 3 },
    ];
    // v2 (the nearer ancestor) never got pushed — v1 did.
    const states = { v1: { estimate_id: "v1", ghl_opportunity_id: "opp-from-v1" }, v2: null };
    const result = selectInheritedState(chain, states, "v3");
    expect(result).toEqual({ estimate_id: "v1", ghl_opportunity_id: "opp-from-v1" });
  });

  it("returns null when no ancestor has any state at all", () => {
    const chain = [
      { id: "v1", version: 1 },
      { id: "v2", version: 2 },
    ];
    const result = selectInheritedState(chain, { v1: null, v2: undefined }, "v2");
    expect(result).toBeNull();
  });

  it("never considers its own id, even if a state entry exists for it", () => {
    const chain = [
      { id: "v1", version: 1 },
      { id: "v2", version: 2 },
    ];
    const states = { v1: null, v2: { estimate_id: "v2", ghl_opportunity_id: "should-not-be-returned" } };
    const result = selectInheritedState(chain, states, "v2");
    expect(result).toBeNull();
  });
});
