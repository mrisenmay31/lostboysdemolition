import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub pattern as client.test.ts — vitest runs outside a Server
// Component, so the real server-only package throws on import.
vi.mock("server-only", () => ({}));

import { __resetCustomFieldDefsCacheForTests, __resetPipelineCacheForTests } from "@/lib/ghl/client";
import {
  JOB_PIPELINE_STAGE_NAMES,
  __resetJobPipelineStagesCacheForTests,
  resolveJobPipelineStages,
} from "@/lib/ghl/pipeline";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const FULL_STAGES = [
  { id: "s1", name: "New Lead" },
  { id: "s2", name: "Intake/Qualification" },
  { id: "s3", name: "Estimate in Progress" },
  { id: "s4", name: "Quote Sent" },
  { id: "s5", name: "Quote Accepted" },
  { id: "s6", name: "Job Scheduled" },
  { id: "s7", name: "Job in Progress" },
  { id: "s8", name: "Job Completed" },
  { id: "s9", name: "Invoice Review" },
  { id: "s10", name: "Invoice Sent" },
  { id: "s11", name: "Paid/Closed (Won)" },
  { id: "s12", name: "Closed Lost (Declined)" },
];

function pipelinesResponse(stages: typeof FULL_STAGES) {
  return jsonResponse(200, { pipelines: [{ id: "pipeline-1", name: "Job Pipeline", stages }] });
}

beforeEach(() => {
  process.env.GHL_API_KEY = "test-api-key";
  process.env.GHL_LOCATION_ID = "test-location-id";
  // pipeline.ts's cache is independent of client.ts's, but reset both —
  // shared module state across test files in the same worker must not leak.
  __resetPipelineCacheForTests();
  __resetCustomFieldDefsCacheForTests();
  __resetJobPipelineStagesCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JOB_PIPELINE_STAGE_NAMES", () => {
  it("lists all 12 live GHL pipeline stages, in pipeline order", () => {
    expect(JOB_PIPELINE_STAGE_NAMES).toHaveLength(12);
    expect(JOB_PIPELINE_STAGE_NAMES[0]).toBe("New Lead");
    expect(JOB_PIPELINE_STAGE_NAMES[2]).toBe("Estimate in Progress");
    expect(JOB_PIPELINE_STAGE_NAMES[3]).toBe("Quote Sent");
    expect(JOB_PIPELINE_STAGE_NAMES[4]).toBe("Quote Accepted");
    expect(JOB_PIPELINE_STAGE_NAMES[11]).toBe("Closed Lost (Declined)");
  });
});

describe("resolveJobPipelineStages — resolution", () => {
  it("resolves all 4 stage ids by name from the live pipeline", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(pipelinesResponse(FULL_STAGES));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveJobPipelineStages();

    expect(result).toEqual({
      pipelineId: "pipeline-1",
      estimateInProgressStageId: "s3",
      quoteSentStageId: "s4",
      quoteAcceptedStageId: "s5",
      closedLostStageId: "s12",
    });
  });

  it("matches case-insensitively and by substring (e.g. a combined stage name)", async () => {
    const combined = [
      { id: "s1", name: "New Lead" },
      { id: "s2", name: "ESTIMATE IN PROGRESS" },
      { id: "s3", name: "Quote Sent" },
      { id: "s4", name: "Deposit Received/Quote Accepted" },
      { id: "s5", name: "Closed Lost (Declined)" },
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(pipelinesResponse(combined));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveJobPipelineStages();

    expect(result.estimateInProgressStageId).toBe("s2");
    expect(result.quoteAcceptedStageId).toBe("s4");
    expect(result.closedLostStageId).toBe("s5");
  });
});

describe("resolveJobPipelineStages — caching", () => {
  it("caches across calls — exactly one fetch for two resolutions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pipelinesResponse(FULL_STAGES));
    vi.stubGlobal("fetch", fetchMock);

    const first = await resolveJobPipelineStages();
    const second = await resolveJobPipelineStages();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failed resolution — the next call retries against a fresh fetch", async () => {
    const stagesMissingClosedLost = FULL_STAGES.filter((s) => s.name !== "Closed Lost (Declined)");
    // mockImplementation, not mockResolvedValue — a Response body can only
    // be read once, and this test expects two real fetch calls.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(pipelinesResponse(stagesMissingClosedLost)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveJobPipelineStages()).rejects.toThrow(/closed lost/i);
    await expect(resolveJobPipelineStages()).rejects.toThrow(/closed lost/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the missing stage and lists what WAS found, in the thrown error", async () => {
    const onlyOneStage = [{ id: "s1", name: "New Lead" }];
    const fetchMock = vi.fn().mockResolvedValueOnce(pipelinesResponse(onlyOneStage));
    vi.stubGlobal("fetch", fetchMock);

    let err: Error | undefined;
    try {
      await resolveJobPipelineStages();
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toMatch(/estimate in progress/i);
    expect(err?.message).toMatch(/New Lead/);
  });

  it("throws when the Job Pipeline itself is not found (propagated from fetchJobPipelineStages)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { pipelines: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveJobPipelineStages()).rejects.toThrow(/Job Pipeline/);
  });

  it("names the needle/label when only a LATER stage is missing (fix round F9b)", async () => {
    // Distinct from the "names the missing stage" test above, which drops
    // every stage but the first — this drops only "Quote Accepted",
    // leaving estimateInProgress/quoteSent resolvable, to prove the error
    // path isn't accidentally coupled to "the first missing stage found".
    const stagesMissingQuoteAccepted = FULL_STAGES.filter((s) => s.name !== "Quote Accepted");
    const fetchMock = vi.fn().mockResolvedValueOnce(pipelinesResponse(stagesMissingQuoteAccepted));
    vi.stubGlobal("fetch", fetchMock);

    let err: Error | undefined;
    try {
      await resolveJobPipelineStages();
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toMatch(/"quote accepted"/i);
    expect(err?.message).toContain("(Quote Accepted)");
    expect(err?.message).toMatch(/not found/i);
  });
});

describe("resolveJobPipelineStages — ambiguity guard (fix round F4)", () => {
  it("throws naming the needle, the label, and every matched stage name when a needle matches more than one live stage", async () => {
    const ambiguousStages = [
      { id: "s1", name: "New Lead" },
      { id: "s2", name: "Intake/Qualification" },
      { id: "s3", name: "Estimate in Progress" },
      { id: "s4", name: "Quote Sent" },
      { id: "s4b", name: "Quote Sent — Follow Up" },
      { id: "s5", name: "Quote Accepted" },
      { id: "s12", name: "Closed Lost (Declined)" },
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(pipelinesResponse(ambiguousStages));
    vi.stubGlobal("fetch", fetchMock);

    let err: Error | undefined;
    try {
      await resolveJobPipelineStages();
    } catch (e) {
      err = e as Error;
    }

    expect(err).toBeDefined();
    expect(err?.message).toMatch(/quote sent/i);
    expect(err?.message).toMatch(/Quote Sent/);
    expect(err?.message).toMatch(/ambiguous/i);
    // Every matched stage name must be listed, not just one.
    expect(err?.message).toContain("Quote Sent");
    expect(err?.message).toContain("Quote Sent — Follow Up");
  });

  it("does not cache an ambiguity failure — the next call retries against a fresh fetch", async () => {
    const ambiguousStages = [
      { id: "s3", name: "Estimate in Progress" },
      { id: "s4", name: "Quote Sent" },
      { id: "s4b", name: "Quote Sent — Follow Up" },
      { id: "s5", name: "Quote Accepted" },
      { id: "s12", name: "Closed Lost (Declined)" },
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(pipelinesResponse(ambiguousStages)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveJobPipelineStages()).rejects.toThrow(/ambiguous/i);
    await expect(resolveJobPipelineStages()).rejects.toThrow(/ambiguous/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveJobPipelineStages — concurrency (fix round F9d)", () => {
  it("two concurrent calls before the first resolves share ONE fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(pipelinesResponse(FULL_STAGES));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([resolveJobPipelineStages(), resolveJobPipelineStages()]);

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
