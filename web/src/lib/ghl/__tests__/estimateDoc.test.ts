import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allocateAmounts,
  buildEstimateDocPayload,
  createEstimateDoc,
  deleteEstimateDoc,
  findDocByMeta,
  updateEstimateDoc,
  type EstimateForDoc,
  type EstimateLineItemForDoc,
  type EstimateDocContact,
} from "@/lib/ghl/estimateDoc";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeEstimate(overrides: Partial<EstimateForDoc> = {}): EstimateForDoc {
  return {
    id: "estimate-uuid-1",
    estimate_number: 1412,
    version: 1,
    quoted_price: null,
    total_bid: 2543.51,
    labor_rate: 26,
    dump_rate: 300,
    estimate_date: "2026-08-14",
    job_name: "Jorge's Interior",
    job_address: "123 Main St, Salt Lake City, UT",
    ...overrides,
  };
}

function makeContact(overrides: Partial<EstimateDocContact> = {}): EstimateDocContact {
  return {
    id: "contact-1",
    name: "Jorge Ramirez",
    email: "jorge@example.com",
    phone: "+18015551234",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.GHL_API_KEY = "test-api-key";
  process.env.GHL_LOCATION_ID = "test-location-id";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("allocateAmounts — pure allocation", () => {
  it("sums exactly to docTotal with clean proportional weights", () => {
    const amounts = allocateAmounts(1000, [1, 2, 3]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 10);
    expect(amounts).toEqual([166.67, 333.33, 500]);
  });

  it("sums exactly to docTotal on an awkward split — 3 lines / $100.01", () => {
    const amounts = allocateAmounts(100.01, [1, 1, 1]);
    const sum = amounts.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(100.01);
    expect(amounts).toHaveLength(3);
  });

  it("sums exactly to docTotal across many uneven weight vectors (property-style sweep)", () => {
    const cases: Array<[number, number[]]> = [
      [100.01, [1, 1, 1]],
      [2543.51, [10, 3, 300]],
      [0.03, [1, 1, 1]],
      [9999.99, [7, 11, 13, 17]],
      [1.01, [1, 2]],
      [50, [1, 1, 1, 1, 1, 1, 1]],
    ];
    for (const [docTotal, weights] of cases) {
      const amounts = allocateAmounts(docTotal, weights);
      const sumCents = amounts.reduce((a, b) => a + Math.round(b * 100), 0);
      expect(sumCents).toBe(Math.round(docTotal * 100));
    }
  });

  it("puts the entire rounding remainder on the LAST weight, not distributed elsewhere", () => {
    // Three equal weights splitting $10.00 evenly would be $3.333... each;
    // rounded that's 3.33/3.33/3.33 = 9.99, one cent short of 10.00 — the
    // last line must absorb it, landing at 3.34.
    const amounts = allocateAmounts(10, [1, 1, 1]);
    expect(amounts[0]).toBe(3.33);
    expect(amounts[1]).toBe(3.33);
    expect(amounts[2]).toBe(3.34);
  });

  it("equal-split path when all weights are zero", () => {
    const amounts = allocateAmounts(30, [0, 0, 0]);
    expect(amounts).toEqual([10, 10, 10]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(30);
  });

  it("equal-split path handles a remainder too", () => {
    const amounts = allocateAmounts(10, [0, 0, 0]);
    const sum = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(10);
    // 10 / 3 = 3.333..., two lines at 3.33 and the last absorbing the cent.
    expect(amounts[0]).toBe(3.33);
    expect(amounts[1]).toBe(3.33);
    expect(amounts[2]).toBe(3.34);
  });

  it("returns an empty array for zero weights", () => {
    expect(allocateAmounts(100, [])).toEqual([]);
  });
});

describe("buildEstimateDocPayload — allocation via full builder", () => {
  it("allocates line item amounts proportional to direct cost, sorted by sort_order, summing exactly", () => {
    const estimate = makeEstimate({ quoted_price: null, total_bid: 100.01 });
    const lineItems: EstimateLineItemForDoc[] = [
      { name: "Kitchen Demo", sort_order: 2, labor_hours: 4, dump_count: 0, materials_cost: 0 },
      { name: "Bathroom Demo", sort_order: 1, labor_hours: 2, dump_count: 0, materials_cost: 0 },
      { name: "Haul Away", sort_order: 3, labor_hours: 0, dump_count: 0.5, materials_cost: 0 },
    ];
    const contact = makeContact();

    const payload = buildEstimateDocPayload(estimate, lineItems, contact);

    expect(payload.items).toHaveLength(3);
    // sorted by sort_order: Bathroom(1), Kitchen(2), Haul Away(3)
    expect(payload.items.map((i) => i.name)).toEqual(["Bathroom Demo", "Kitchen Demo", "Haul Away"]);

    const sum = payload.items.reduce((a, b) => a + b.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(100.01);
  });

  it("last line by sort_order absorbs the remainder", () => {
    const estimate = makeEstimate({ quoted_price: 10 });
    // Equal weights (same direct cost) so the split is as even as possible.
    const lineItems: EstimateLineItemForDoc[] = [
      { name: "A", sort_order: 3, labor_hours: 1, dump_count: 0, materials_cost: 0 },
      { name: "B", sort_order: 1, labor_hours: 1, dump_count: 0, materials_cost: 0 },
      { name: "C", sort_order: 2, labor_hours: 1, dump_count: 0, materials_cost: 0 },
    ];
    const payload = buildEstimateDocPayload(estimate, lineItems, makeContact());

    // sorted order: B(1), C(2), A(3) — A is last, must absorb the remainder
    const sorted = payload.items;
    expect(sorted.map((i) => i.name)).toEqual(["B", "C", "A"]);
    const [b, c, a] = sorted.map((i) => i.amount);
    expect(b).toBe(3.33);
    expect(c).toBe(3.33);
    expect(a).toBe(3.34);
  });

  it("equal split when all line items have zero direct cost", () => {
    const estimate = makeEstimate({ quoted_price: 30 });
    const lineItems: EstimateLineItemForDoc[] = [
      { name: "A", sort_order: 1, labor_hours: 0, dump_count: 0, materials_cost: 0 },
      { name: "B", sort_order: 2, labor_hours: 0, dump_count: 0, materials_cost: 0 },
      { name: "C", sort_order: 3, labor_hours: 0, dump_count: 0, materials_cost: 0 },
    ];
    const payload = buildEstimateDocPayload(estimate, lineItems, makeContact());
    expect(payload.items.map((i) => i.amount)).toEqual([10, 10, 10]);
  });

  it("falls back to a single 'Demolition Services' line when there are no line items", () => {
    const estimate = makeEstimate({ quoted_price: 500 });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.items).toEqual([
      { name: "Demolition Services", description: "", qty: 1, amount: 500, currency: "USD", type: "one_time" },
    ]);
  });

  it("uses the supplied job scope summary as the fallback item's description", () => {
    const estimate = makeEstimate({ quoted_price: 500 });
    const payload = buildEstimateDocPayload(estimate, [], makeContact(), {
      jobScopeSummary: "Full interior demo, 2 dump loads",
    });
    expect(payload.items[0].description).toBe("Full interior demo, 2 dump loads");
  });

  it("prefers quoted_price over total_bid when both are present", () => {
    const estimate = makeEstimate({ quoted_price: 2000, total_bid: 2543.51 });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.items[0].amount).toBe(2000);
  });

  it("falls back to total_bid when quoted_price is null", () => {
    const estimate = makeEstimate({ quoted_price: null, total_bid: 2543.51 });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.items[0].amount).toBe(2543.51);
  });

  it("treats quoted_price of 0 as an explicit override, not 'missing'", () => {
    const estimate = makeEstimate({ quoted_price: 0, total_bid: 2543.51 });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.items[0].amount).toBe(0);
  });
});

describe("buildEstimateDocPayload — required fields, naming, meta, dates", () => {
  it("throws a clear error when the contact has no email", () => {
    const estimate = makeEstimate();
    const contact = makeContact({ email: null });
    expect(() => buildEstimateDocPayload(estimate, [], contact)).toThrow(/email/i);
  });

  it("throws a clear error when the contact has no phone", () => {
    const estimate = makeEstimate();
    const contact = makeContact({ phone: null });
    expect(() => buildEstimateDocPayload(estimate, [], contact)).toThrow(/phone/i);
  });

  it("names the doc from the bare job_name when present (no prefix — see live-spike finding)", () => {
    const estimate = makeEstimate({ job_name: "Jorge's Interior", job_address: "123 Main St" });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.name).toBe("Jorge's Interior");
  });

  it("falls back to job_address when job_name is absent", () => {
    const estimate = makeEstimate({ job_name: null, job_address: "456 Oak Ave" });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.name).toBe("456 Oak Ave");
  });

  it("falls back to 'Estimate #<number>' when both job_name and job_address are absent", () => {
    const estimate = makeEstimate({ job_name: null, job_address: null, estimate_number: 1412 });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.name).toBe("Estimate #1412");
  });

  it("truncates a name over 40 chars to GHL's live validator limit, with an ellipsis", () => {
    const estimate = makeEstimate({
      job_name: "Blue Ridge Builders - Full Interior Demolition Project",
      job_address: null,
    });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.name.length).toBe(40);
    expect(payload.name.endsWith("…")).toBe(true);
    expect(payload.name).toBe("Blue Ridge Builders - Full Interior Dem…");
  });

  it("leaves a name exactly at 40 chars untouched", () => {
    const fortyChars = "A".repeat(40);
    const estimate = makeEstimate({ job_name: fortyChars, job_address: null });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.name).toBe(fortyChars);
    expect(payload.name.length).toBe(40);
  });

  it("titles a fresh doc 'ESTIMATE'", () => {
    const payload = buildEstimateDocPayload(makeEstimate(), [], makeContact());
    expect(payload.title).toBe("ESTIMATE");
  });

  it("titles a revision doc 'ESTIMATE (REVISED)' when told it's a revision", () => {
    const payload = buildEstimateDocPayload(makeEstimate(), [], makeContact(), { isRevision: true });
    expect(payload.title).toBe("ESTIMATE (REVISED)");
  });

  it("carries the meta breadcrumb (lbd_estimate_id / lbd_estimate_number / lbd_version)", () => {
    const estimate = makeEstimate({ id: "estimate-uuid-42", estimate_number: 1412, version: 2 });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.meta).toEqual({
      lbd_estimate_id: "estimate-uuid-42",
      lbd_estimate_number: 1412,
      lbd_version: 2,
    });
  });

  it("sets expiryDate to issueDate + 30 days", () => {
    const estimate = makeEstimate({ estimate_date: "2026-08-14" });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.issueDate).toBe("2026-08-14");
    expect(payload.expiryDate).toBe("2026-09-13");
  });

  it("expiryDate correctly crosses a year boundary", () => {
    const estimate = makeEstimate({ estimate_date: "2026-12-15" });
    const payload = buildEstimateDocPayload(estimate, [], makeContact());
    expect(payload.expiryDate).toBe("2027-01-14");
  });

  it("carries the required constant/derived fields verbatim", () => {
    const payload = buildEstimateDocPayload(makeEstimate(), [], makeContact());
    expect(payload.altId).toBe("test-location-id");
    expect(payload.altType).toBe("location");
    expect(payload.businessDetails).toEqual({ name: "Lost Boys Demolition" });
    expect(payload.currency).toBe("USD");
    expect(payload.discount).toEqual({ type: "percentage", value: 0 });
    // Live-spike finding: GHL requires `schedule: null`, not `{}` (see
    // task-10-report.md) — every real non-recurring doc stores it that way.
    expect(payload.frequencySettings).toEqual({ enabled: false, schedule: null });
    expect(payload.liveMode).toBe(true);
  });

  it("maps contact fields into contactDetails, including phoneNo naming", () => {
    const contact = makeContact({ id: "contact-99", name: "Dane Owner", email: "dane@example.com", phone: "+18015559999" });
    const payload = buildEstimateDocPayload(makeEstimate(), [], contact);
    expect(payload.contactDetails).toEqual({
      id: "contact-99",
      name: "Dane Owner",
      email: "dane@example.com",
      phoneNo: "+18015559999",
    });
  });
});

describe("API wrappers — built on ghlFetch (mocked)", () => {
  it("createEstimateDoc POSTs to /invoices/estimate and extracts id + estimateNumber", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { _id: "doc-1", estimateNumber: "EST-1234" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = buildEstimateDocPayload(makeEstimate(), [], makeContact());
    const result = await createEstimateDoc(payload);

    expect(result).toEqual({ id: "doc-1", estimateNumber: "EST-1234", raw: { _id: "doc-1", estimateNumber: "EST-1234" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/invoices/estimate");
    expect(init.method).toBe("POST");
  });

  it("updateEstimateDoc PUTs to /invoices/estimate/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { _id: "doc-1", estimateNumber: "EST-1234" }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = buildEstimateDocPayload(makeEstimate(), [], makeContact());
    const result = await updateEstimateDoc("doc-1", payload);

    expect(result.id).toBe("doc-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/invoices/estimate/doc-1");
    expect(init.method).toBe("PUT");
  });

  it("deleteEstimateDoc DELETEs with an altId/altType body", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteEstimateDoc("doc-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/invoices/estimate/doc-1");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ altId: "test-location-id", altType: "location" });
  });

  it("findDocByMeta returns the doc whose meta.lbdEstimateId matches (camelCase — GHL round-trips meta camelCased)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        estimates: [
          { _id: "doc-other", estimateNumber: "EST-1", meta: { lbdEstimateId: "not-it" } },
          { _id: "doc-1", estimateNumber: "EST-1234", meta: { lbdEstimateId: "estimate-uuid-1" } },
        ],
        total: 2,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await findDocByMeta("contact-1", "estimate-uuid-1");
    expect(result).toEqual({
      id: "doc-1",
      estimateNumber: "EST-1234",
      raw: { _id: "doc-1", estimateNumber: "EST-1234", meta: { lbdEstimateId: "estimate-uuid-1" } },
    });
  });

  it("findDocByMeta does NOT match on the snake_case key it sends on create — only the camelCase round-trip", async () => {
    // Regression guard for the live-spike finding: a naive implementation
    // matching on `meta.lbd_estimate_id` (the key this module SENDS) would
    // silently never find anything, since GHL never returns that key name.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        estimates: [{ _id: "doc-1", estimateNumber: "EST-1234", meta: { lbd_estimate_id: "estimate-uuid-1" } }],
        total: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await findDocByMeta("contact-1", "estimate-uuid-1");
    expect(result).toBeNull();
  });

  it("findDocByMeta returns null when nothing matches", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { estimates: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await findDocByMeta("contact-1", "estimate-uuid-1");
    expect(result).toBeNull();
  });
});
