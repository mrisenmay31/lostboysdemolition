import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// vitest runs in a plain Node environment (no "react-server" export
// condition), so the real server-only package throws on import outside a
// Server Component — same stub every other lib test in this repo uses.
vi.mock("server-only", () => ({}));

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

const { getEstimateMock, updateStatusMock } = vi.hoisted(() => ({
  getEstimateMock: vi.fn(),
  updateStatusMock: vi.fn(),
}));
vi.mock("@/lib/estimates/repo", () => ({
  getEstimate: getEstimateMock,
  updateStatus: updateStatusMock,
}));

const { resolveJobPipelineStagesMock } = vi.hoisted(() => ({
  resolveJobPipelineStagesMock: vi.fn(),
}));
vi.mock("@/lib/ghl/pipeline", () => ({
  resolveJobPipelineStages: resolveJobPipelineStagesMock,
}));

const {
  getOpportunityMock,
  updateOpportunityStageMock,
  createContactMock,
  createOpportunityMock,
} = vi.hoisted(() => ({
  getOpportunityMock: vi.fn(),
  updateOpportunityStageMock: vi.fn(),
  createContactMock: vi.fn(),
  createOpportunityMock: vi.fn(),
}));
vi.mock("@/lib/ghl/client", () => ({
  getOpportunity: getOpportunityMock,
  updateOpportunityStage: updateOpportunityStageMock,
  createContact: createContactMock,
  createOpportunity: createOpportunityMock,
}));

import {
  buildPresentationSnapshot,
  canonicalJson,
  classifyAcceptanceEventError,
  isSchedulingEligible,
  linkEstimateIdentity,
  presentEstimate,
  recordEstimateAcceptance,
  resolveAcceptancePresentation,
  reverseEstimateAcceptance,
  EstimateIdentityConflictError,
  OpportunityPipelineMismatchError,
  RecordAcceptanceEventError,
} from "@/lib/estimates/commercialLifecycle";
import type { EstimateAcceptanceStateRow, EstimateDetail } from "@/lib/estimates/types";

// ── Fake Supabase admin client ──────────────────────────────────────────
//
// A `.from(table)` call pops the next queued handler for that table (FIFO
// per table — most tests only ever need one call per table, a couple need
// two, e.g. linkEstimateIdentity's conflict path re-queries
// estimate_identity_links after the failed upsert). Every returned builder
// is BOTH chainable (select/eq/order/upsert all return itself) AND
// thenable/awaitable directly (mirrors supabase-js's real
// PostgrestFilterBuilder, and matches the two calling shapes this file
// actually uses — `await admin.from(x).upsert(row, opts)` with no further
// chaining, and `await admin.from(x).select().eq().single()`).

interface QueryResult {
  data?: unknown;
  error?: unknown;
}

function chainable(result: QueryResult) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    then: (resolve: (v: QueryResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function makeFakeAdmin(tableResults: Record<string, QueryResult[]>) {
  const queues: Record<string, QueryResult[]> = Object.fromEntries(
    Object.entries(tableResults).map(([table, results]) => [table, [...results]]),
  );
  const rpcMock = vi.fn();
  const admin = {
    from: vi.fn((table: string) => {
      const queue = queues[table];
      if (!queue || queue.length === 0) {
        throw new Error(`makeFakeAdmin: no queued result for .from("${table}")`);
      }
      const result = queue.length > 1 ? queue.shift()! : queue[0];
      return chainable(result);
    }),
    rpc: rpcMock,
  };
  return { admin, rpcMock };
}

const PIPELINE_STAGES = {
  pipelineId: "pipeline-1",
  estimateInProgressStageId: "stage-estimate-in-progress",
  quoteSentStageId: "stage-quote-sent",
  quoteAcceptedStageId: "stage-quote-accepted",
  closedLostStageId: "stage-closed-lost",
};

function makeEstimateDetail(overrides: Partial<EstimateDetail> = {}): EstimateDetail {
  const base: EstimateDetail = {
    estimate: {
      id: "11111111-1111-1111-1111-111111111111",
      estimate_number: 1500,
      version: 1,
      supersedes_estimate_id: null,
      status: "draft",
      job_number: null,
      job_name: "Jorge's Interior",
      client_name: "Jorge Ramirez",
      client_type: "Homeowner",
      client_email: "jorge@example.com",
      client_phone: "555-0100",
      job_address: "123 Main St",
      city: "Provo",
      job_type: "Residential",
      estimate_date: "2026-08-19",
      job_details: null,
      labor_method: "total_hours",
      total_job_hours: 34,
      days_at_job: null,
      num_employees: null,
      dump_count: 1,
      job_specific_costs: 0,
      markup_pct: 25,
      labor_rate: 26,
      overhead_rate: 23,
      dump_rate: 300,
      cc_fee_rate: 0.035,
      labor_cost: 884,
      dump_fees: 300,
      total_direct: 1184,
      overhead: 782,
      profit: 491.5,
      cc_fee: 86.01,
      total_bid: 2543.51,
      true_margin_pct: 19.32,
      quoted_price: null,
      quote_override_reason: null,
      source: "app",
      airtable_estimate_id: null,
      created_at: "2026-08-19T00:00:00Z",
      created_by: null,
      created_by_name: "Dane",
      is_path_b: false,
    },
    lineItems: [],
    versionChain: [],
    auditTrail: [],
    pushState: null,
    financialDetails: null,
    identityLink: null,
    acceptanceState: null,
    presentation: null,
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  createAdminClientMock.mockReset();
  getEstimateMock.mockReset();
  updateStatusMock.mockReset();
  resolveJobPipelineStagesMock.mockReset();
  resolveJobPipelineStagesMock.mockResolvedValue(PIPELINE_STAGES);
  getOpportunityMock.mockReset();
  updateOpportunityStageMock.mockReset();
  createContactMock.mockReset();
  createOpportunityMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Snapshot hash recipe ─────────────────────────────────────────────────

describe("buildPresentationSnapshot / canonicalJson — snapshot hash recipe", () => {
  it("is deterministic regardless of object construction order (recursive key-sort)", () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("sorts line items by sort_order before hashing, regardless of query order", () => {
    const detail = makeEstimateDetail({
      lineItems: [
        {
          id: "li-2",
          estimate_id: "e1",
          scope_library_id: null,
          name: "Second",
          description: "",
          labor_hours: 10,
          dump_count: 0,
          materials_cost: 0,
          sort_order: 1,
          created_at: "2026-08-19T00:00:00Z",
        },
        {
          id: "li-1",
          estimate_id: "e1",
          scope_library_id: null,
          name: "First",
          description: "",
          labor_hours: 24,
          dump_count: 1,
          materials_cost: 0,
          sort_order: 0,
          created_at: "2026-08-19T00:00:00Z",
        },
      ],
    });
    const snapshot = buildPresentationSnapshot(detail);
    expect((snapshot.lineItems as Array<{ name: string }>).map((li) => li.name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("produces the same hash for the same content and a different hash for a changed price", () => {
    const detail = makeEstimateDetail();
    const hashA = createHash("sha256").update(canonicalJson(buildPresentationSnapshot(detail))).digest("hex");
    const hashB = createHash("sha256").update(canonicalJson(buildPresentationSnapshot(detail))).digest("hex");
    expect(hashA).toBe(hashB);

    const changed = makeEstimateDetail({
      estimate: { ...detail.estimate, total_bid: 9999.99 },
    });
    const hashC = createHash("sha256").update(canonicalJson(buildPresentationSnapshot(changed))).digest("hex");
    expect(hashC).not.toBe(hashA);
  });
});

// ── presentEstimate ────────────────────────────────────────────────────

describe("presentEstimate", () => {
  it("inserts estimate_presentations with on-conflict-do-nothing (handoff #4) and no GHL identity link -> skips GHL, still updates status", async () => {
    const detail = makeEstimateDetail();
    getEstimateMock.mockResolvedValue(detail);
    const { admin } = makeFakeAdmin({
      estimate_presentations: [{ error: null }],
      estimate_identity_links: [{ data: null, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    updateStatusMock.mockResolvedValue(detail.estimate);

    await presentEstimate(detail.estimate.id, "Dane");

    const presentationsCallIndex = admin.from.mock.calls.findIndex(
      ([table]: [string]) => table === "estimate_presentations",
    );
    expect(presentationsCallIndex).toBeGreaterThanOrEqual(0);
    // Handoff #4: on-conflict-do-nothing, keyed on estimate_id (the table
    // is unique-per-version AND immutable, so an upsert-with-update would
    // hit the immutability trigger).
    const presentationsBuilder = admin.from.mock.results[presentationsCallIndex].value;
    expect(presentationsBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ estimate_id: detail.estimate.id }),
      { onConflict: "estimate_id", ignoreDuplicates: true },
    );
    expect(getOpportunityMock).not.toHaveBeenCalled();
    expect(updateOpportunityStageMock).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(detail.estimate.id, "sent", { id: null, name: "Dane" });
  });

  it("moves the linked GHL opportunity to Quote Sent when an identity link exists", async () => {
    const detail = makeEstimateDetail();
    getEstimateMock.mockResolvedValue(detail);
    const { admin } = makeFakeAdmin({
      estimate_presentations: [{ error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: PIPELINE_STAGES.pipelineId });
    updateStatusMock.mockResolvedValue(detail.estimate);

    await presentEstimate(detail.estimate.id, "Dane");

    expect(updateOpportunityStageMock).toHaveBeenCalledWith("opp-1", PIPELINE_STAGES.quoteSentStageId);
  });

  it("throws OpportunityPipelineMismatchError and never calls updateOpportunityStage when the opportunity is in a different pipeline", async () => {
    const detail = makeEstimateDetail();
    getEstimateMock.mockResolvedValue(detail);
    const { admin } = makeFakeAdmin({
      estimate_presentations: [{ error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: "some-other-pipeline" });

    await expect(presentEstimate(detail.estimate.id, "Dane")).rejects.toThrow(OpportunityPipelineMismatchError);
    expect(updateOpportunityStageMock).not.toHaveBeenCalled();
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid estimate id before touching the DB", async () => {
    await expect(presentEstimate("not-a-uuid", "Dane")).rejects.toThrow(/invalid estimate id/);
    expect(getEstimateMock).not.toHaveBeenCalled();
  });

  // ── Fix round F1 (BLOCKER) ──────────────────────────────────────────
  it("F1: refuses a superseded version — no upsert, no updateStatus, no GHL call", async () => {
    const detail = makeEstimateDetail({ estimate: { ...makeEstimateDetail().estimate, status: "superseded" } });
    getEstimateMock.mockResolvedValue(detail);
    const { admin } = makeFakeAdmin({});
    createAdminClientMock.mockReturnValue(admin);

    await expect(presentEstimate(detail.estimate.id, "Dane")).rejects.toThrow(/superseded/);

    expect(admin.from).not.toHaveBeenCalled();
    expect(getOpportunityMock).not.toHaveBeenCalled();
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  // ── Fix round F2 ─────────────────────────────────────────────────────
  it("F2: a GHL stage-move failure does not roll back the presentation or the status update — returns a warning instead", async () => {
    const detail = makeEstimateDetail();
    getEstimateMock.mockResolvedValue(detail);
    const { admin } = makeFakeAdmin({
      estimate_presentations: [{ error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: PIPELINE_STAGES.pipelineId });
    updateOpportunityStageMock.mockRejectedValue(new Error("GHL 503"));
    updateStatusMock.mockResolvedValue(detail.estimate);

    const outcome = await presentEstimate(detail.estimate.id, "Dane");

    expect(outcome.warning).toMatch(/GHL 503/);
    const presentationsCallIndex = admin.from.mock.calls.findIndex(
      ([table]: [string]) => table === "estimate_presentations",
    );
    expect(presentationsCallIndex).toBeGreaterThanOrEqual(0);
    expect(updateStatusMock).toHaveBeenCalledWith(detail.estimate.id, "sent", { id: null, name: "Dane" });
  });
});

// ── recordEstimateAcceptance / reverseEstimateAcceptance — RPC raises ────

describe("classifyAcceptanceEventError — handoff #5", () => {
  it.each([
    ["record_estimate_acceptance_event: no active acceptance to reverse (estimate family 1500)", "no_active_acceptance"],
    ["record_estimate_acceptance_event: estimate x is not the accepted version (accepted version is y)", "wrong_version"],
    ["record_estimate_acceptance_event: estimate x has not been presented — a presentation row is required before acceptance", "not_presented"],
    ["record_estimate_acceptance_event: estimate x is superseded — accept the current version", "superseded"],
    ["some unrelated database error", "other"],
  ])("classifies %j as %s", (message, code) => {
    expect(classifyAcceptanceEventError(message)).toBe(code);
  });
});

describe("recordEstimateAcceptance", () => {
  it("surfaces the RPC's raise as a classified RecordAcceptanceEventError and never proceeds to a GHL/status write", async () => {
    const detail = makeEstimateDetail();
    getEstimateMock.mockResolvedValue(detail);
    const { admin, rpcMock } = makeFakeAdmin({
      estimate_acceptance_state: [{ data: null, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "record_estimate_acceptance_event: estimate x has not been presented — a presentation row is required before acceptance" },
    });

    let caught: unknown;
    try {
      await recordEstimateAcceptance({
        estimateId: detail.estimate.id,
        method: "signature",
        customerContactName: "Jorge Ramirez",
        effectiveAt: "2026-08-19T00:00:00Z",
        recordedByName: "Dane",
        note: "signed on-site",
        evidencePaths: [],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RecordAcceptanceEventError);
    expect((caught as InstanceType<typeof RecordAcceptanceEventError>).code).toBe("not_presented");
    expect(updateStatusMock).not.toHaveBeenCalled();
    expect(getOpportunityMock).not.toHaveBeenCalled();
  });

  it("on success, moves the linked opportunity to Quote Accepted and sets status to accepted", async () => {
    const detail = makeEstimateDetail();
    const estimateId = detail.estimate.id;
    getEstimateMock.mockResolvedValue(detail);
    const { admin, rpcMock } = makeFakeAdmin({
      estimate_acceptance_state: [{ data: { accepted: false }, error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    rpcMock.mockResolvedValue({ data: { id: "event-1" }, error: null });
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: PIPELINE_STAGES.pipelineId });
    updateStatusMock.mockResolvedValue({});

    const outcome = await recordEstimateAcceptance({
      estimateId,
      method: "signature",
      customerContactName: "Jorge Ramirez",
      effectiveAt: "2026-08-19T00:00:00Z",
      recordedByName: "Dane",
      note: "signed on-site",
      evidencePaths: [],
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "record_estimate_acceptance_event",
      expect.objectContaining({ p_event: expect.objectContaining({ action: "accepted", estimate_id: estimateId }) }),
    );
    expect(updateOpportunityStageMock).toHaveBeenCalledWith("opp-1", PIPELINE_STAGES.quoteAcceptedStageId);
    expect(updateStatusMock).toHaveBeenCalledWith(estimateId, "accepted", { id: null, name: "Dane" });
    expect(outcome).toEqual({});
  });

  // ── Fix round F1 (BLOCKER) ──────────────────────────────────────────
  it("F1: refuses a superseded version app-side — the RPC is never called", async () => {
    const detail = makeEstimateDetail({ estimate: { ...makeEstimateDetail().estimate, status: "superseded" } });
    getEstimateMock.mockResolvedValue(detail);
    const { admin, rpcMock } = makeFakeAdmin({});
    createAdminClientMock.mockReturnValue(admin);

    await expect(
      recordEstimateAcceptance({
        estimateId: detail.estimate.id,
        method: "signature",
        customerContactName: "Jorge Ramirez",
        effectiveAt: "2026-08-19T00:00:00Z",
        recordedByName: "Dane",
        note: "signed on-site",
        evidencePaths: [],
      }),
    ).rejects.toThrow(/superseded/);

    expect(rpcMock).not.toHaveBeenCalled();
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  // ── Fix round F7 ─────────────────────────────────────────────────────
  it("F7: refuses to record a second acceptance for an already-accepted family — the RPC is never called", async () => {
    const detail = makeEstimateDetail();
    getEstimateMock.mockResolvedValue(detail);
    const { admin, rpcMock } = makeFakeAdmin({
      estimate_acceptance_state: [{ data: { accepted: true }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);

    let caught: unknown;
    try {
      await recordEstimateAcceptance({
        estimateId: detail.estimate.id,
        method: "signature",
        customerContactName: "Jorge Ramirez",
        effectiveAt: "2026-08-19T00:00:00Z",
        recordedByName: "Dane",
        note: "signed on-site",
        evidencePaths: [],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RecordAcceptanceEventError);
    expect((caught as InstanceType<typeof RecordAcceptanceEventError>).code).toBe("already_accepted");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  // ── Fix round F2 ─────────────────────────────────────────────────────
  it("F2: a GHL stage-move failure does not roll back the acceptance or the status update — returns a warning instead", async () => {
    const detail = makeEstimateDetail();
    const estimateId = detail.estimate.id;
    getEstimateMock.mockResolvedValue(detail);
    const { admin, rpcMock } = makeFakeAdmin({
      estimate_acceptance_state: [{ data: { accepted: false }, error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    rpcMock.mockResolvedValue({ data: { id: "event-1" }, error: null });
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: PIPELINE_STAGES.pipelineId });
    updateOpportunityStageMock.mockRejectedValue(new Error("GHL timeout"));
    updateStatusMock.mockResolvedValue({});

    const outcome = await recordEstimateAcceptance({
      estimateId,
      method: "signature",
      customerContactName: "Jorge Ramirez",
      effectiveAt: "2026-08-19T00:00:00Z",
      recordedByName: "Dane",
      note: "signed on-site",
      evidencePaths: [],
    });

    expect(outcome.warning).toMatch(/GHL timeout/);
    expect(rpcMock).toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(estimateId, "accepted", { id: null, name: "Dane" });
  });
});

describe("reverseEstimateAcceptance", () => {
  it("double-reverse retry: surfaces 'no active acceptance' as RecordAcceptanceEventError, never silently no-ops", async () => {
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const { admin, rpcMock } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1500, status: "accepted" }, error: null }],
      // Never accepted — no row for this family. F1/F3's target-check
      // skips entirely in this case (nothing to positively mismatch
      // against), so the RPC's own "no active acceptance" is what
      // surfaces, exactly as before this fix round.
      estimate_acceptance_state: [{ data: null, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "record_estimate_acceptance_event: no active acceptance to reverse (estimate family 1500)" },
    });

    let caught: unknown;
    try {
      await reverseEstimateAcceptance({
        estimateId,
        destination: "quote_sent",
        reason: "customer changed mind",
        recordedByName: "Dane",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RecordAcceptanceEventError);
    expect((caught as InstanceType<typeof RecordAcceptanceEventError>).code).toBe("no_active_acceptance");
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it("on success with destination=closed_lost, moves to Closed Lost and sets status to declined", async () => {
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const { admin, rpcMock } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1500, status: "accepted" }, error: null }],
      estimate_acceptance_state: [{ data: { current_estimate_id: estimateId }, error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    rpcMock.mockResolvedValue({ data: { id: "event-2" }, error: null });
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: PIPELINE_STAGES.pipelineId });
    updateStatusMock.mockResolvedValue({});

    const outcome = await reverseEstimateAcceptance({
      estimateId,
      destination: "closed_lost",
      reason: "customer declined",
      recordedByName: "Dane",
    });

    expect(updateOpportunityStageMock).toHaveBeenCalledWith("opp-1", PIPELINE_STAGES.closedLostStageId);
    expect(updateStatusMock).toHaveBeenCalledWith(estimateId, "declined", { id: null, name: "Dane" });
    expect(outcome).toEqual({});
  });

  // ── Fix round F1 (BLOCKER) + F3 ─────────────────────────────────────
  it("F1/F3: refuses to reverse a version that is NOT the family's current acceptance target", async () => {
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const acceptedElsewhere = "22222222-2222-2222-2222-222222222222";
    const { admin, rpcMock } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1500, status: "accepted" }, error: null }],
      estimate_acceptance_state: [{ data: { current_estimate_id: acceptedElsewhere }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);

    let caught: unknown;
    try {
      await reverseEstimateAcceptance({
        estimateId,
        destination: "quote_sent",
        reason: "wrong version",
        recordedByName: "Dane",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RecordAcceptanceEventError);
    expect((caught as InstanceType<typeof RecordAcceptanceEventError>).code).toBe("wrong_version");
    expect((caught as Error).message).toContain(acceptedElsewhere);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  // ── Fix round F2 ─────────────────────────────────────────────────────
  it("F2: a GHL stage-move failure does not roll back the reversal or the status update — returns a warning instead", async () => {
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const { admin, rpcMock } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1500, status: "accepted" }, error: null }],
      estimate_acceptance_state: [{ data: { current_estimate_id: estimateId }, error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    rpcMock.mockResolvedValue({ data: { id: "event-3" }, error: null });
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: PIPELINE_STAGES.pipelineId });
    updateOpportunityStageMock.mockRejectedValue(new Error("GHL 500"));
    updateStatusMock.mockResolvedValue({});

    const outcome = await reverseEstimateAcceptance({
      estimateId,
      destination: "quote_sent",
      reason: "customer changed mind",
      recordedByName: "Dane",
    });

    expect(outcome.warning).toMatch(/GHL 500/);
    expect(rpcMock).toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(estimateId, "sent", { id: null, name: "Dane" });
  });

  // ── Re-review D1 (BLOCKER) ───────────────────────────────────────────
  it("D1: reversing a SUPERSEDED accepted version records the reversal and moves GHL but never clears the superseded marker", async () => {
    // The canonical F3 flow: v1 accepted, then revised (writer contract
    // flips v1 to 'superseded'), then reversed from v2's page targeting
    // v1. Mirroring 'sent'/'declined' onto v1 here would clear the
    // superseded marker — re-exposing v1 to the estimates list, the
    // revise flow, and re-acceptance (both the app-side and DB-side
    // superseded-acceptance guards key off estimates.status). The mirror
    // must be skipped; the reversal event + GHL move are still required.
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const { admin, rpcMock } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1500, status: "superseded" }, error: null }],
      estimate_acceptance_state: [{ data: { current_estimate_id: estimateId }, error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1500,
            ghl_contact_id: "contact-1",
            ghl_opportunity_id: "opp-1",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    rpcMock.mockResolvedValue({ data: { id: "event-4" }, error: null });
    getOpportunityMock.mockResolvedValue({ id: "opp-1", pipelineId: PIPELINE_STAGES.pipelineId });
    updateStatusMock.mockResolvedValue({});

    const outcome = await reverseEstimateAcceptance({
      estimateId,
      destination: "quote_sent",
      reason: "scope changed — accepting the revised version instead",
      recordedByName: "Dane",
    });

    expect(rpcMock).toHaveBeenCalled();
    expect(updateOpportunityStageMock).toHaveBeenCalledWith("opp-1", PIPELINE_STAGES.quoteSentStageId);
    expect(updateStatusMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({});
  });
});

// ── resolveAcceptancePresentation (fix round F3) ────────────────────────

describe("resolveAcceptancePresentation", () => {
  const v1 = "11111111-1111-1111-1111-111111111111";
  const v2 = "22222222-2222-2222-2222-222222222222";
  const acceptedOnV1: EstimateAcceptanceStateRow = {
    estimate_number: 1500,
    current_estimate_id: v1,
    accepted: true,
    current_acceptance_event_id: "event-1",
    accepted_price: 2543.51,
    last_event_id: "event-1",
    updated_at: "2026-08-19T00:00:00Z",
  };

  it("acceptedThisVersion=true, acceptedOtherVersion=false, and reverse targets THIS id when viewing the accepted version", () => {
    const result = resolveAcceptancePresentation(acceptedOnV1, v1);
    expect(result).toEqual({
      acceptedThisVersion: true,
      acceptedOtherVersion: false,
      reverseTargetEstimateId: v1,
    });
  });

  it("LOCK (the dead-end scenario, fix round F3): viewing a DIFFERENT version than the one accepted -> acceptedOtherVersion=true, a working reverse target is still offered", () => {
    const result = resolveAcceptancePresentation(acceptedOnV1, v2);
    expect(result.acceptedThisVersion).toBe(false);
    expect(result.acceptedOtherVersion).toBe(true);
    // The reverse path always targets the ACTUALLY accepted version (v1),
    // never the page's own id (v2) — this is what makes the reverse
    // control still work from the dead-end page instead of raising
    // "not the accepted version" the way it did before this fix round.
    expect(result.reverseTargetEstimateId).toBe(v1);
  });

  it("neither branch true when there is no acceptance at all — reverse target defaults to the page's own id (a Reverse control simply isn't rendered in this state)", () => {
    const result = resolveAcceptancePresentation(null, v2);
    expect(result).toEqual({
      acceptedThisVersion: false,
      acceptedOtherVersion: false,
      reverseTargetEstimateId: v2,
    });
  });

  it("neither branch true after a reversal (accepted: false), even though current_estimate_id still names a version — reverse target falls back to the page's own id, NOT the stale current_estimate_id", () => {
    const reversed: EstimateAcceptanceStateRow = { ...acceptedOnV1, accepted: false };
    const result = resolveAcceptancePresentation(reversed, v2);
    expect(result.acceptedThisVersion).toBe(false);
    expect(result.acceptedOtherVersion).toBe(false);
    expect(result.reverseTargetEstimateId).toBe(v2);
  });
});

// ── linkEstimateIdentity ──────────────────────────────────────────────

describe("linkEstimateIdentity", () => {
  it("surfaces a ghl_opportunity_id unique-constraint conflict as EstimateIdentityConflictError naming the other family", async () => {
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const { admin } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1600 }, error: null }],
      estimate_identity_links: [
        { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
        { data: { estimate_number: 1500 }, error: null },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);

    let caught: unknown;
    try {
      await linkEstimateIdentity({
        estimateId,
        selection: {
          ghlContactId: "contact-1",
          ghlOpportunityId: "opp-1",
          createContact: false,
          createOpportunity: false,
        },
        linkedByName: "Dane",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EstimateIdentityConflictError);
    expect((caught as InstanceType<typeof EstimateIdentityConflictError>).conflictingEstimateNumber).toBe(1500);
    expect((caught as Error).message).toContain("1500");
  });

  it("creates a GHL contact and opportunity when the selection asks for both, then links and moves to Estimate in Progress", async () => {
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const { admin } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1600 }, error: null }],
      estimate_identity_links: [
        {
          data: {
            estimate_number: 1600,
            ghl_contact_id: "new-contact",
            ghl_opportunity_id: "new-opp",
            linked_by_name: "Dane",
            actor_assurance: "selected_identity",
            created_at: "2026-08-19T00:00:00Z",
            updated_at: "2026-08-19T00:00:00Z",
          },
          error: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    createContactMock.mockResolvedValue("new-contact");
    createOpportunityMock.mockResolvedValue("new-opp");
    getOpportunityMock.mockResolvedValue({ id: "new-opp", pipelineId: PIPELINE_STAGES.pipelineId });

    const result = await linkEstimateIdentity({
      estimateId,
      selection: { ghlContactId: null, ghlOpportunityId: null, createContact: true, createOpportunity: true },
      linkedByName: "Dane",
      contactFields: { email: "jorge@example.com" },
      opportunityName: "Jorge's Interior",
    });

    expect(createContactMock).toHaveBeenCalledTimes(1);
    expect(createOpportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "new-contact", pipelineId: PIPELINE_STAGES.pipelineId }),
    );
    expect(updateOpportunityStageMock).toHaveBeenCalledWith("new-opp", PIPELINE_STAGES.estimateInProgressStageId);
    expect(result.ghl_opportunity_id).toBe("new-opp");
  });

  it("never auto-picks: with neither a selected id nor a create flag, throws rather than guessing", async () => {
    const estimateId = "11111111-1111-1111-1111-111111111111";
    const { admin } = makeFakeAdmin({
      estimates: [{ data: { estimate_number: 1600 }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);

    await expect(
      linkEstimateIdentity({
        estimateId,
        selection: { ghlContactId: null, ghlOpportunityId: null, createContact: false, createOpportunity: false },
        linkedByName: "Dane",
      }),
    ).rejects.toThrow(/no ghlContactId resolved/);
  });
});

// ── isSchedulingEligible ──────────────────────────────────────────────

describe("isSchedulingEligible", () => {
  const acceptedState: EstimateAcceptanceStateRow = {
    estimate_number: 1500,
    current_estimate_id: "11111111-1111-1111-1111-111111111111",
    accepted: true,
    current_acceptance_event_id: "event-1",
    accepted_price: 2543.51,
    last_event_id: "event-1",
    updated_at: "2026-08-19T00:00:00Z",
  };

  it("true when accepted and current_estimate_id matches the version being checked", () => {
    expect(isSchedulingEligible(acceptedState, acceptedState.current_estimate_id)).toBe(true);
  });

  it("false when accepted but checking a DIFFERENT version than the currently accepted one", () => {
    expect(isSchedulingEligible(acceptedState, "22222222-2222-2222-2222-222222222222")).toBe(false);
  });

  it("false after a reversal (accepted: false) — the v2 Step-6 required case", () => {
    const reversed: EstimateAcceptanceStateRow = { ...acceptedState, accepted: false };
    expect(isSchedulingEligible(reversed, acceptedState.current_estimate_id)).toBe(false);
  });

  it("false when there is no acceptance state at all (never accepted)", () => {
    expect(isSchedulingEligible(null, acceptedState.current_estimate_id)).toBe(false);
  });
});
