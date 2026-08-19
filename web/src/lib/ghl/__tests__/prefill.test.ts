import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __resetCustomFieldDefsCacheForTests, __resetPipelineCacheForTests, GhlApiError } from "@/lib/ghl/client";
import { findContactMatches, loadPrefillFromOpportunity } from "@/lib/ghl/prefill";

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
  vi.restoreAllMocks();
});

// ── loadPrefillFromOpportunity ──────────────────────────────────────────

describe("loadPrefillFromOpportunity — happy path", () => {
  it("fetches the opportunity, then its contact, and returns a flat prefill", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          opportunity: { id: "opp-1", name: "Jorge — Kitchen Demo", contactId: "contact-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          contact: {
            id: "contact-1",
            firstName: "Jorge",
            lastName: "Diaz",
            companyName: null,
            email: "jorge@example.com",
            phone: "801-555-0100",
            address1: "123 Main St",
            city: "Ogden",
            state: "UT",
            postalCode: "84401",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadPrefillFromOpportunity("opp-1");

    expect(result).toEqual({
      ghlContactId: "contact-1",
      ghlOpportunityId: "opp-1",
      opportunityName: "Jorge — Kitchen Demo",
      firstName: "Jorge",
      lastName: "Diaz",
      companyName: null,
      email: "jorge@example.com",
      phone: "801-555-0100",
      address1: "123 Main St",
      city: "Ogden",
      state: "UT",
      postalCode: "84401",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [oppUrl] = fetchMock.mock.calls[0];
    const [contactUrl] = fetchMock.mock.calls[1];
    expect(String(oppUrl)).toBe("https://services.leadconnectorhq.com/opportunities/opp-1");
    expect(String(contactUrl)).toBe("https://services.leadconnectorhq.com/contacts/contact-1");
  });
});

describe("loadPrefillFromOpportunity — missing/optional data never throws", () => {
  it("degrades to opportunity-only prefill (all contact fields null) when the opportunity has no contactId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { opportunity: { id: "opp-2", name: "No Contact Yet" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await loadPrefillFromOpportunity("opp-2");

    expect(result.ghlContactId).toBeNull();
    expect(result.ghlOpportunityId).toBe("opp-2");
    expect(result.opportunityName).toBe("No Contact Yet");
    expect(result.email).toBeNull();
    expect(result.firstName).toBeNull();
    // Only the opportunity fetch happens — no attempt to fetch a contact
    // that doesn't exist.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("nulls ghlContactId when the contact fetch confirms a 404 — deleted contact must not become canonical identity (fix round F6)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { opportunity: { id: "opp-3", name: "Stale Contact", contactId: "contact-gone" } }),
      )
      .mockResolvedValueOnce(jsonResponse(404, { message: "not found" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await loadPrefillFromOpportunity("opp-3");

    expect(result.ghlOpportunityId).toBe("opp-3");
    expect(result.ghlContactId).toBeNull(); // confirmed-gone contact — dangling id cleared
    expect(result.email).toBeNull();
    expect(result.firstName).toBeNull();
  });

  it("retains ghlContactId when the contact fetch fails for a non-404 (transient) reason (fix round F6)", async () => {
    // A 500 is retried once by ghlFetch (shouldRetry) after a 2s delay
    // before finally throwing — so this needs a second mocked 500 and
    // fake timers to advance past that delay, same pattern as client.test.ts's
    // retry tests.
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { opportunity: { id: "opp-3b", name: "Transient Outage", contactId: "contact-known" } }),
      )
      .mockImplementation(() => Promise.resolve(jsonResponse(500, { message: "internal error" })));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = loadPrefillFromOpportunity("opp-3b");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.ghlOpportunityId).toBe("opp-3b");
    expect(result.ghlContactId).toBe("contact-known"); // transient failure — identity link preserved
    expect(result.email).toBeNull();
    expect(result.firstName).toBeNull();
  });

  it("tolerates missing optional contact fields (partial contact record)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { opportunity: { id: "opp-4", contactId: "contact-4" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { contact: { id: "contact-4", email: "only-email@example.com" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadPrefillFromOpportunity("opp-4");

    expect(result.email).toBe("only-email@example.com");
    expect(result.firstName).toBeNull();
    expect(result.companyName).toBeNull();
    expect(result.address1).toBeNull();
  });
});

describe("loadPrefillFromOpportunity — not-found throws", () => {
  it("propagates a GhlApiError when the opportunity itself is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(404, { message: "opportunity not found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPrefillFromOpportunity("missing-opp")).rejects.toBeInstanceOf(GhlApiError);
  });
});

// ── findContactMatches ──────────────────────────────────────────────────

describe("findContactMatches — merging and dedup", () => {
  it("runs email and phone searches and dedups by contact id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-1", email: "a@example.com" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-1", email: "a@example.com" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await findContactMatches({ email: "a@example.com", phone: "801-555-0100" });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("contact-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns distinct candidates from email and phone searches without merging them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-1" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-2" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await findContactMatches({ email: "a@example.com", phone: "801-555-0100" });

    const ids = result.map((c) => c.id).sort();
    expect(ids).toEqual(["contact-1", "contact-2"]);
  });

  it("includes a direct stable-contact-ID lookup alongside the search legs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { contact: { id: "contact-known", email: "known@example.com" } }))
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-known", email: "known@example.com" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await findContactMatches({ ghlContactId: "contact-known", email: "known@example.com" });

    // The direct lookup and the email search resolve to the same contact —
    // deduped to one candidate, not two.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("contact-known");
  });

  it("degrades a stale/deleted contact id (confirmed 404) to 'no match' instead of throwing (fix round F3)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { message: "not found" }))
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await findContactMatches({ ghlContactId: "contact-stale", email: "nobody@example.com" });

    expect(result).toEqual([]);
  });

  it("rejects (does not manufacture 'no match') when the stable-contact-ID leg fails with a non-404 error (fix round F3)", async () => {
    // A 500 is retried once by ghlFetch after a 2s delay before finally
    // throwing — fake timers needed, same pattern as the other retry
    // tests in this suite/client.test.ts.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(500, { message: "outage" })));
    vi.stubGlobal("fetch", fetchMock);

    const promise = findContactMatches({ ghlContactId: "contact-during-outage" });
    const assertion = expect(promise).rejects.toBeInstanceOf(GhlApiError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    vi.useRealTimers();

    // Exactly the initial attempt + one retry (ghlFetch's own contract) —
    // not swallowed into a silent "no candidates" result.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("union of legs — email and phone each contributing one distinct candidate both surface", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-a" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-b" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await findContactMatches({ email: "shared@example.com", phone: "801-555-0199" });

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id).sort()).toEqual(["contact-a", "contact-b"]);
  });

  it("never auto-picks — a SINGLE leg (phone) returning multiple contacts surfaces all of them (fix round F1)", async () => {
    // Before F1, searchContactByPhone (singular, first-match-only) meant
    // findContactMatches could never see more than one candidate from any
    // one leg, no matter how many real GHL contacts shared that phone
    // number — a structural violation of "show possible matches, never
    // silently merge". This asserts the fix: two contacts on the SAME
    // (phone) leg both surface.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        contacts: [{ id: "contact-x", phone: "801-555-0199" }, { id: "contact-y", phone: "801-555-0199" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await findContactMatches({ phone: "801-555-0199" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id).sort()).toEqual(["contact-x", "contact-y"]);
  });

  it("returns [] and makes no calls when no query fields are supplied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await findContactMatches({});

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only runs the email search when phone is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contacts: [{ id: "contact-1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await findContactMatches({ email: "solo@example.com" });

    expect(result).toEqual([{ id: "contact-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("findContactMatches — phone search request shape", () => {
  it("POSTs a structured eq filter on phone, same shape as the email search", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { contacts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await findContactMatches({ phone: "801-555-0123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://services.leadconnectorhq.com/contacts/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.filters).toEqual([{ field: "phone", operator: "eq", value: "801-555-0123" }]);
    expect(body.locationId).toBe("test-location-id");
  });
});
