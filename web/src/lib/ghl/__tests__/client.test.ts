import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vitest runs in a plain Node environment (no "react-server" export
// condition), so the real server-only package throws on import outside a
// Server Component. Stub it so client.ts's `import "server-only"` is inert
// under test — same pattern used by log.test.ts/rates.test.ts.
vi.mock("server-only", () => ({}));

import {
  __resetCustomFieldDefsCacheForTests,
  __resetPipelineCacheForTests,
  GhlApiError,
  createContact,
  extractContactId,
  extractOpportunityId,
  fetchJobPipelineStages,
  findStageIdBySubstring,
  getContact,
  getOpportunity,
  ghlFetch,
  getCustomFieldValue,
  listEstimateDocs,
  resolvePipeline,
  searchContactByEmail,
  searchContactByPhone,
  searchContactsByEmail,
  searchContactsByPhone,
  shouldRetry,
  updateOpportunityStage,
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
  it("retries only after the full 2s delay on a 429 — not a moment sooner", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: "rate limited" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = ghlFetch("/test");

    // Pinned per review finding M7(a): advancing 2000ms in a single step
    // would also pass at 0ms delay (or any delay <= 2000ms), so it can't
    // tell "waits 2s" apart from "doesn't wait at all". Split it — just
    // short of the delay, the retry must not have fired yet.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Crossing the 2000ms threshold fires the retry.
    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("retries EXACTLY once — never loops — even when the server 500s forever", async () => {
    vi.useFakeTimers();
    // mockImplementation (not mockResolvedValue) — a Response body can only
    // be read once, so every call needs its own fresh instance, and the
    // server failing "forever" means there's no bound on how many calls
    // might come in if the retry-once contract were broken.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(500, { message: "server error" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = ghlFetch("/test");
    const assertion = expect(promise).rejects.toBeInstanceOf(GhlApiError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;

    // Review finding M7(b): pin the retry-once contract directly — exactly
    // the initial attempt plus one retry, not an unbounded retry loop.
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

describe("ghlFetch — config errors bypass retry entirely (review finding I1)", () => {
  it("throws immediately on a missing GHL_API_KEY — no fetch call, no retry delay", async () => {
    delete process.env.GHL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // No fake timers here on purpose: if this regressed back to evaluating
    // headers inside performGhlFetch's try, the failure would get wrapped
    // as a GhlNetworkError and retried after a real 2s setTimeout — which
    // would make this test hang/timeout instead of resolving instantly.
    await expect(ghlFetch("/test")).rejects.toThrow(/GHL_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("searchContactByEmail — POST /contacts/search (task T9f fix)", () => {
  it("POSTs a structured eq filter on email, not the broken GET ?email= shape", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-1" }], total: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchContactByEmail("jorge@example.com");

    expect(result).toEqual({ id: "contact-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://services.leadconnectorhq.com/contacts/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.filters).toEqual([{ field: "email", operator: "eq", value: "jorge@example.com" }]);
    expect(body.locationId).toBe("test-location-id");
  });

  it("returns null when contacts is empty (live-verified shape for no match)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contacts: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchContactByEmail("nobody@example.com")).toBeNull();
  });

  it("returns null when contacts is missing from the response entirely", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchContactByEmail("nobody@example.com")).toBeNull();
  });

  it("returns only the FIRST of several matches — singular behavior unchanged after the F1 reimplementation on top of searchContactsByEmail", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { contacts: [{ id: "contact-first" }, { id: "contact-second" }], total: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchContactByEmail("shared@example.com");

    expect(result).toEqual({ id: "contact-first" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe("listEstimateDocs — pagination (review finding I-1)", () => {
  it("auto-paginates when no explicit limit is passed, and surfaces a doc that only exists on page 2", async () => {
    // Page 1: a full AUTO_PAGE_SIZE (100) page — nothing distinguishing here.
    const page1Estimates = Array.from({ length: 100 }, (_, i) => ({ _id: `doc-${i}`, status: "draft" }));
    // Page 2: short page (5 items) — includes the doc a status/meta lookup
    // needs to find. Before this fix, a caller passing no limit only ever
    // saw page 1 and would have missed this doc entirely.
    const page2Estimates = [
      { _id: "doc-100", status: "draft" },
      { _id: "doc-101", status: "draft" },
      { _id: "doc-102", status: "draft" },
      { _id: "doc-103", status: "draft" },
      { _id: "doc-104", status: "sent" }, // the doc a status lookup must not miss
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { estimates: page1Estimates, total: 105, traceId: "t1" }))
      .mockResolvedValueOnce(jsonResponse(200, { estimates: page2Estimates, total: 105, traceId: "t2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = (await listEstimateDocs({ contactId: "contact-1" })) as {
      estimates: Array<{ _id: string; status: string }>;
      total: number;
    };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchMock.mock.calls[0];
    const [secondUrl] = fetchMock.mock.calls[1];
    expect(String(firstUrl)).toContain("offset=0");
    expect(String(firstUrl)).toContain("limit=100");
    expect(String(secondUrl)).toContain("offset=100");

    expect(result.estimates).toHaveLength(105);
    // The page-2-only doc must be present, and with its real (non-draft) status —
    // this is exactly what decideDocAction needs to avoid full-replacing a sent doc.
    const found = result.estimates.find((e) => e._id === "doc-104");
    expect(found).toEqual({ _id: "doc-104", status: "sent" });
  });

  it("stops after one page when the first page is already short (no second fetch)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { estimates: [{ _id: "only-doc", status: "draft" }], total: 1, traceId: "t1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = (await listEstimateDocs({ contactId: "contact-1" })) as { estimates: unknown[] };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.estimates).toHaveLength(1);
  });

  it("fetches exactly one page when an explicit limit is passed (unchanged single-page behavior)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { estimates: [{ _id: "doc-a" }], total: 105, traceId: "t1" }));
    vi.stubGlobal("fetch", fetchMock);

    await listEstimateDocs({ contactId: "contact-1", limit: 5, offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("limit=5");
    expect(String(url)).toContain("offset=0");
  });
});

describe("searchContactByPhone — POST /contacts/search (Task 2, profitability v2)", () => {
  it("POSTs a structured eq filter on phone, same shape as searchContactByEmail", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-9" }], total: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchContactByPhone("801-555-0100");

    expect(result).toEqual({ id: "contact-9" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://services.leadconnectorhq.com/contacts/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.filters).toEqual([{ field: "phone", operator: "eq", value: "801-555-0100" }]);
    expect(body.locationId).toBe("test-location-id");
  });

  it("returns null when contacts is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contacts: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchContactByPhone("801-555-0000")).toBeNull();
  });

  it("returns only the FIRST of several matches — singular behavior unchanged after the F1 reimplementation on top of searchContactsByPhone", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { contacts: [{ id: "contact-first" }, { id: "contact-second" }], total: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchContactByPhone("801-555-0100");

    expect(result).toEqual({ id: "contact-first" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("searchContactsByEmail / searchContactsByPhone — array variants (fix round F1)", () => {
  it("searchContactsByEmail returns every matching contact, not just the first", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { contacts: [{ id: "contact-1" }, { id: "contact-2" }], total: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchContactsByEmail("shared@example.com");

    expect(result).toEqual([{ id: "contact-1" }, { id: "contact-2" }]);
  });

  it("searchContactsByPhone returns every matching contact, not just the first", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { contacts: [{ id: "contact-9" }, { id: "contact-10" }], total: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchContactsByPhone("801-555-0100");

    expect(result).toEqual([{ id: "contact-9" }, { id: "contact-10" }]);
  });

  it("both array variants return [] when contacts is empty/missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(200, { contacts: [] })));
    expect(await searchContactsByEmail("nobody@example.com")).toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(200, {})));
    expect(await searchContactsByPhone("801-555-0000")).toEqual([]);
  });
});

describe("getOpportunity — GET /opportunities/{id}", () => {
  it("unwraps the {opportunity: {...}} envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { opportunity: { id: "opp-1", name: "Jorge — Kitchen Demo" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getOpportunity("opp-1");

    expect(result).toEqual({ id: "opp-1", name: "Jorge — Kitchen Demo" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://services.leadconnectorhq.com/opportunities/opp-1");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("tolerates an unwrapped (bare) opportunity response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { id: "opp-2", name: "Bare Shape" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getOpportunity("opp-2")).toEqual({ id: "opp-2", name: "Bare Shape" });
  });

  it("propagates a GhlApiError on 404 (not-found signal for prefill.ts)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(404, { message: "not found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOpportunity("missing")).rejects.toBeInstanceOf(GhlApiError);
  });

  it("percent-encodes a path-traversal-shaped id instead of interpolating it raw (fix round F2)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { opportunity: { id: "opp-x" } }));
    vi.stubGlobal("fetch", fetchMock);

    await getOpportunity("../locations/other-loc/whatever");

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://services.leadconnectorhq.com/opportunities/" +
        encodeURIComponent("../locations/other-loc/whatever"),
    );
    expect(String(url)).not.toContain("/opportunities/../");
  });
});

describe("getContact — GET /contacts/{id}", () => {
  it("unwraps the {contact: {...}} envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { contact: { id: "contact-1", email: "jorge@example.com" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getContact("contact-1");

    expect(result).toEqual({ id: "contact-1", email: "jorge@example.com" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://services.leadconnectorhq.com/contacts/contact-1");
  });

  it("propagates a GhlApiError on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(404, { message: "not found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getContact("missing")).rejects.toBeInstanceOf(GhlApiError);
  });

  it("percent-encodes a path-traversal-shaped id instead of interpolating it raw (fix round F2)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contact: { id: "contact-x" } }));
    vi.stubGlobal("fetch", fetchMock);

    await getContact("../locations/other-loc/whatever");

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://services.leadconnectorhq.com/contacts/" + encodeURIComponent("../locations/other-loc/whatever"),
    );
    expect(String(url)).not.toContain("/contacts/../");
  });
});

describe("updateOpportunityStage — stage-only PUT", () => {
  it("PUTs only { pipelineStageId } — no name/monetaryValue/customFields in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { id: "opp-1", pipelineStageId: "stage-5" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateOpportunityStage("opp-1", "stage-5");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://services.leadconnectorhq.com/opportunities/opp-1");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ pipelineStageId: "stage-5" });
  });

  it("propagates a GhlApiError on a 4xx failure (fix round F9c)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(400, { message: "bad stage id" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateOpportunityStage("opp-1", "bad-stage")).rejects.toBeInstanceOf(GhlApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJobPipelineStages — full stage list, uncached", () => {
  it("returns the pipeline id and every stage, not just one", async () => {
    const stages = [
      { id: "s1", name: "New Lead" },
      { id: "s2", name: "Estimate in Progress" },
      { id: "s3", name: "Quote Sent" },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { pipelines: [{ id: "pipeline-1", name: "Job Pipeline", stages }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJobPipelineStages();

    expect(result).toEqual({ pipelineId: "pipeline-1", stages });
  });

  it("is NOT cached — two calls issue two fetches (pipeline.ts owns the caching layer)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { pipelines: [{ id: "pipeline-1", name: "Job Pipeline", stages: [] }] })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchJobPipelineStages();
    await fetchJobPipelineStages();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the Job Pipeline itself is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { pipelines: [{ id: "p1", name: "Some Other Pipeline" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJobPipelineStages()).rejects.toThrow(/Job Pipeline/);
  });
});
