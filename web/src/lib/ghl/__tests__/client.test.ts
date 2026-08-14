import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCustomFieldDefsCacheForTests,
  __resetPipelineCacheForTests,
  GhlApiError,
  buildCustomFieldsPayload,
  createContact,
  extractContactId,
  extractOpportunityId,
  findStageIdBySubstring,
  ghlFetch,
  getCustomFieldValue,
  resolvePipeline,
  shouldRetry,
} from "@/lib/ghl/client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  process.env.GHL_API_KEY = "test-api-key";
  process.env.GHL_LOCATION_ID = "test-location-id";
  __resetPipelineCacheForTests();
  __resetCustomFieldDefsCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shouldRetry — pure retry predicate", () => {
  it("retries on 429", () => {
    expect(shouldRetry({ networkError: false, status: 429 })).toBe(true);
  });

  it("retries on 500 and other 5xx", () => {
    expect(shouldRetry({ networkError: false, status: 500 })).toBe(true);
    expect(shouldRetry({ networkError: false, status: 503 })).toBe(true);
  });

  it("does NOT retry on 400", () => {
    expect(shouldRetry({ networkError: false, status: 400 })).toBe(false);
  });

  it("does NOT retry on other plain 4xx (401, 404)", () => {
    expect(shouldRetry({ networkError: false, status: 401 })).toBe(false);
    expect(shouldRetry({ networkError: false, status: 404 })).toBe(false);
  });

  it("retries on a network error regardless of status", () => {
    expect(shouldRetry({ networkError: true })).toBe(true);
  });
});

describe("ghlFetch — retry-once behavior against mocked fetch", () => {
  it("retries once after 2s on a 429, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: "rate limited" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = ghlFetch("/test");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("does NOT retry on a 400 — throws immediately, fetch called once", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(400, { message: "bad request" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ghlFetch("/test")).rejects.toBeInstanceOf(GhlApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a network error, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = ghlFetch("/test");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("throws a GhlApiError carrying status + body on a non-retryable failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(404, { message: "not found" }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await ghlFetch("/missing");
      expect.unreachable("ghlFetch should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GhlApiError);
      const apiErr = err as GhlApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.body).toEqual({ message: "not found" });
    }
  });
});

describe("createContact — duplicate-400 handling", () => {
  it("returns the new contact id on a plain success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contact: { id: "contact-123" } }));
    vi.stubGlobal("fetch", fetchMock);

    const id = await createContact({ email: "new@example.com" });
    expect(id).toBe("contact-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns meta.contactId on a duplicate-blocked 400 instead of throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(400, {
        statusCode: 400,
        message: "duplicated contact",
        meta: { contactId: "existing-contact-456" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await createContact({ email: "dup@example.com" });
    expect(id).toBe("existing-contact-456");
    // A duplicate-400 is a genuine 4xx — not retried, so exactly one call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-throws a 400 with no meta.contactId", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(400, { message: "bad request", meta: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createContact({ email: "bad@example.com" })).rejects.toBeInstanceOf(GhlApiError);
  });
});

describe("defensive id extraction", () => {
  it("extractContactId prefers contact.id, falls back to top-level id", () => {
    expect(extractContactId({ contact: { id: "a" } })).toBe("a");
    expect(extractContactId({ id: "b" })).toBe("b");
    expect(extractContactId({})).toBeNull();
    expect(extractContactId(null)).toBeNull();
  });

  it("extractOpportunityId prefers opportunity.id, falls back to top-level id", () => {
    expect(extractOpportunityId({ opportunity: { id: "opp-a" } })).toBe("opp-a");
    expect(extractOpportunityId({ id: "opp-b" })).toBe("opp-b");
    expect(extractOpportunityId({})).toBeNull();
    expect(extractOpportunityId(undefined)).toBeNull();
  });
});

describe("buildCustomFieldsPayload — omit-empty rules", () => {
  it("omits null, undefined, empty string, and empty array values", () => {
    const result = buildCustomFieldsPayload([
      ["field-null", null],
      ["field-undefined", undefined],
      ["field-empty-string", ""],
      ["field-empty-array", []],
      ["field-zero", 0],
      ["field-false", false],
      ["field-string", "value"],
      ["field-number", 42],
      ["field-array", ["a", "b"]],
    ]);

    expect(result).toEqual([
      { id: "field-zero", field_value: 0 },
      { id: "field-false", field_value: false },
      { id: "field-string", field_value: "value" },
      { id: "field-number", field_value: 42 },
      { id: "field-array", field_value: ["a", "b"] },
    ]);
  });

  it("sends monetary values as JSON numbers, not strings", () => {
    const result = buildCustomFieldsPayload([["labor-cost", 1234.56]]);
    expect(result[0].field_value).toBe(1234.56);
    expect(typeof result[0].field_value).toBe("number");
  });
});

describe("getCustomFieldValue — tolerant read shapes", () => {
  it("matches on id or fieldId, reads field_value/fieldValue/value", () => {
    expect(getCustomFieldValue([{ id: "f1", field_value: "v1" }], "f1")).toBe("v1");
    expect(getCustomFieldValue([{ fieldId: "f2", fieldValue: "v2" }], "f2")).toBe("v2");
    expect(getCustomFieldValue([{ id: "f3", value: "v3" }], "f3")).toBe("v3");
    expect(getCustomFieldValue([{ id: "other" }], "f4")).toBeUndefined();
    expect(getCustomFieldValue(null, "f1")).toBeUndefined();
    expect(getCustomFieldValue(undefined, "f1")).toBeUndefined();
  });
});

describe("findStageIdBySubstring — case-insensitive substring match", () => {
  it("matches regardless of case and surrounding text", () => {
    const stages = [
      { id: "s1", name: "Quote Sent" },
      { id: "s2", name: "ESTIMATE IN PROGRESS" },
      { id: "s3", name: "Deposit Received/Job Scheduled" },
    ];
    expect(findStageIdBySubstring(stages, "estimate in progress")).toBe("s2");
    expect(findStageIdBySubstring(stages, "job scheduled")).toBe("s3");
    expect(findStageIdBySubstring(stages, "does not exist")).toBeNull();
  });
});

describe("resolvePipeline — cached per process", () => {
  it("resolves pipeline + stage id and caches across calls (one fetch)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        pipelines: [
          {
            id: "pipeline-1",
            name: "Job Pipeline",
            stages: [
              { id: "stage-1", name: "New Lead" },
              { id: "stage-3", name: "Estimate in Progress" },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await resolvePipeline();
    const second = await resolvePipeline();

    expect(first).toEqual({ pipelineId: "pipeline-1", estimateInProgressStageId: "stage-3" });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error naming the expected stage when it isn't found, and does not cache the failure", async () => {
    // mockImplementation (not mockResolvedValue) — a Response body can only be
    // read once, so each of the two expected calls needs its own instance.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(200, {
          pipelines: [{ id: "pipeline-1", name: "Job Pipeline", stages: [{ id: "s1", name: "New Lead" }] }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePipeline()).rejects.toThrow(/estimate in progress/i);
    // A failed resolution must not be cached — a subsequent call retries.
    await expect(resolvePipeline()).rejects.toThrow(/estimate in progress/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
