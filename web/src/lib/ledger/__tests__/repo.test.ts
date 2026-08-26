import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// scheduleActions.test.ts / exceptionActions.test.ts's matching comment.
vi.mock("server-only", () => ({}));

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(() => ({ rpc: rpcMock, from: fromMock })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import {
  classifyLedgerError,
  correctCostEntry,
  createCostEntry,
  createRevenueEntry,
  loadLedgerJobContext,
} from "../repo";
import type { CostCorrectionInput, CostEntryInput, RevenueEntryInput } from "../types";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  createAdminClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Fake query-builder for `.from(table).select(...).eq(...)....` chains ──
// Mirrors exceptionActions.test.ts's chainableQuery fake — every link
// except the terminal one returns the builder itself; the terminal call
// (whichever is invoked — `.maybeSingle()` or `.order()`) resolves to the
// queued result.
function chainableQuery(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

// ============================================================
// createCostEntry
// ============================================================

const VALID_COST_ENTRY: CostEntryInput = {
  jobNumber: "JOB-1104",
  category: "materials",
  state: "provisional",
  amount: 460,
  quantity: null,
  unitCost: null,
  employeeName: null,
  vendorName: "Home Depot",
  incurredOn: "2026-08-20",
  note: "Plywood + fasteners",
};

describe("createCostEntry", () => {
  it("calls create_job_cost_entry with snake_case p_entry keys, p_actor null, and the picker actor name", async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: "11111111-1111-1111-1111-111111111111",
        job_number: "JOB-1104",
        category: "materials",
        state: "provisional",
        reconciliation_state: "matched",
        amount: "460.00",
        quantity: null,
        employee_name: null,
        vendor_name: "Home Depot",
        incurred_at: "2026-08-20T00:00:00Z",
        source_system: "manual",
        updated_at: "2026-08-20T12:00:00Z",
      },
      error: null,
    });

    await createCostEntry(VALID_COST_ENTRY, "Dane");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("create_job_cost_entry");
    expect(args.p_actor).toBeNull();
    expect(args.p_actor_name).toBe("Dane");
    expect(args.p_entry).toEqual({
      job_number: "JOB-1104",
      category: "materials",
      state: "provisional",
      amount: 460,
      quantity: null,
      unit_cost: null,
      employee_name: null,
      vendor_name: "Home Depot",
      incurred_on: "2026-08-20",
      note: "Plywood + fasteners",
    });

    // incurredOn passes through untouched — no timezone math in TS.
    expect(args.p_entry.incurred_on).toBe("2026-08-20");
  });

  it("normalizes the returned row's numeric strings via normalizeCostEntryRow", async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: "11111111-1111-1111-1111-111111111111",
        job_number: "JOB-1104",
        category: "materials",
        state: "provisional",
        reconciliation_state: "matched",
        amount: "460.00",
        quantity: "3.5",
        employee_name: null,
        vendor_name: "Home Depot",
        incurred_at: "2026-08-20T00:00:00Z",
        source_system: "manual",
        updated_at: "2026-08-20T12:00:00Z",
      },
      error: null,
    });

    const entry = await createCostEntry(VALID_COST_ENTRY, "Dane");

    expect(entry.amount).toBe(460);
    expect(typeof entry.amount).toBe("number");
    expect(entry.quantity).toBe(3.5);
    expect(typeof entry.quantity).toBe("number");
  });

  it("throws a LedgerError when the RPC errors, classified via classifyLedgerError", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "create_job_cost_entry: job JOB-9 not found" },
    });

    await expect(createCostEntry(VALID_COST_ENTRY, "Dane")).rejects.toMatchObject({
      name: "LedgerError",
      code: "not_found",
    });
  });

  it("throws other-coded LedgerError when the RPC succeeds with no row", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(createCostEntry(VALID_COST_ENTRY, "Dane")).rejects.toMatchObject({
      name: "LedgerError",
      code: "other",
    });
  });
});

// ============================================================
// createRevenueEntry — sign rule
// ============================================================

const VALID_REVENUE_ENTRY: RevenueEntryInput = {
  jobNumber: "JOB-1104",
  entryType: "invoice",
  amount: 100,
  occurredOn: "2026-08-20",
  note: "Final invoice",
};

function mockRevenueRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    job_number: "JOB-1104",
    entry_type: "invoice",
    amount: "100.00",
    occurred_at: "2026-08-20T00:00:00Z",
    source_system: "manual",
    created_at: "2026-08-20T12:00:00Z",
    ...overrides,
  };
}

describe("createRevenueEntry — the sign rule", () => {
  it("entryType credit, amount 50 -> p_entry.amount is -50", async () => {
    rpcMock.mockResolvedValue({ data: mockRevenueRow({ entry_type: "credit", amount: "-50.00" }), error: null });

    await createRevenueEntry({ ...VALID_REVENUE_ENTRY, entryType: "credit", amount: 50 }, "Dane");

    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_entry.amount).toBe(-50);
  });

  it("entryType refund, amount 25 -> p_entry.amount is -25", async () => {
    rpcMock.mockResolvedValue({ data: mockRevenueRow({ entry_type: "refund", amount: "-25.00" }), error: null });

    await createRevenueEntry({ ...VALID_REVENUE_ENTRY, entryType: "refund", amount: 25 }, "Dane");

    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_entry.amount).toBe(-25);
  });

  it("entryType invoice, amount 100 -> p_entry.amount is 100 (unchanged)", async () => {
    rpcMock.mockResolvedValue({ data: mockRevenueRow(), error: null });

    await createRevenueEntry(VALID_REVENUE_ENTRY, "Dane");

    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_entry.amount).toBe(100);
  });

  it("calls create_job_revenue_entry with p_actor null and the picker actor name", async () => {
    rpcMock.mockResolvedValue({ data: mockRevenueRow(), error: null });

    await createRevenueEntry(VALID_REVENUE_ENTRY, "Jackson");

    const [rpcName, args] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("create_job_revenue_entry");
    expect(args.p_actor).toBeNull();
    expect(args.p_actor_name).toBe("Jackson");
  });

  it("normalizes the returned row's numeric amount", async () => {
    rpcMock.mockResolvedValue({ data: mockRevenueRow({ amount: "100.00" }), error: null });

    const entry = await createRevenueEntry(VALID_REVENUE_ENTRY, "Dane");

    expect(entry.amount).toBe(100);
    expect(typeof entry.amount).toBe("number");
  });
});

// ============================================================
// correctCostEntry
// ============================================================

const VALID_CORRECTION_ENTRY_ID = "33333333-3333-3333-3333-333333333333";

function mockCostEntryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_CORRECTION_ENTRY_ID,
    job_number: "JOB-1104",
    category: "materials",
    state: "provisional",
    reconciliation_state: "matched",
    amount: "500.00",
    quantity: null,
    employee_name: null,
    vendor_name: "Home Depot",
    incurred_at: "2026-08-20T00:00:00Z",
    source_system: "manual",
    updated_at: "2026-08-20T12:00:00Z",
    ...overrides,
  };
}

describe("correctCostEntry", () => {
  it("calls correct_job_cost_entry with p_id, p_patch, p_reason, p_actor null, p_actor_name", async () => {
    rpcMock.mockResolvedValue({ data: mockCostEntryRow(), error: null });

    const input: CostCorrectionInput = {
      entryId: VALID_CORRECTION_ENTRY_ID,
      reason: "Vendor invoice corrected",
      patch: { amount: 500 },
    };

    await correctCostEntry(input, "Dane");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("correct_job_cost_entry");
    expect(args.p_id).toBe(VALID_CORRECTION_ENTRY_ID);
    expect(args.p_reason).toBe("Vendor invoice corrected");
    expect(args.p_actor).toBeNull();
    expect(args.p_actor_name).toBe("Dane");
  });

  it("maps patch keys unitCost/employeeName/vendorName/incurredOn to their snake_case RPC names", async () => {
    rpcMock.mockResolvedValue({ data: mockCostEntryRow(), error: null });

    const input: CostCorrectionInput = {
      entryId: VALID_CORRECTION_ENTRY_ID,
      reason: "Full field sweep",
      patch: {
        unitCost: 12.5,
        employeeName: "Nick",
        vendorName: "Ace Hardware",
        incurredOn: "2026-08-21",
      },
    };

    await correctCostEntry(input, "Dane");

    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_patch).toEqual({
      unit_cost: 12.5,
      employee_name: "Nick",
      vendor_name: "Ace Hardware",
      incurred_on: "2026-08-21",
    });
  });

  it("patch { amount: 500 } produces p_patch with exactly one key — absent keys stay absent", async () => {
    rpcMock.mockResolvedValue({ data: mockCostEntryRow(), error: null });

    const input: CostCorrectionInput = {
      entryId: VALID_CORRECTION_ENTRY_ID,
      reason: "Amount typo",
      patch: { amount: 500 },
    };

    await correctCostEntry(input, "Dane");

    const [, args] = rpcMock.mock.calls[0];
    expect(Object.keys(args.p_patch)).toEqual(["amount"]);
    expect(args.p_patch.amount).toBe(500);
  });

  it("an explicit null in the patch reaches p_patch as JSON null, not absent", async () => {
    rpcMock.mockResolvedValue({ data: mockCostEntryRow(), error: null });

    const input: CostCorrectionInput = {
      entryId: VALID_CORRECTION_ENTRY_ID,
      reason: "Clear the vendor",
      patch: { vendorName: null },
    };

    await correctCostEntry(input, "Dane");

    const [, args] = rpcMock.mock.calls[0];
    expect("vendor_name" in args.p_patch).toBe(true);
    expect(args.p_patch.vendor_name).toBeNull();
  });

  it("normalizes the returned row", async () => {
    rpcMock.mockResolvedValue({ data: mockCostEntryRow({ amount: "500.00" }), error: null });

    const input: CostCorrectionInput = {
      entryId: VALID_CORRECTION_ENTRY_ID,
      reason: "Amount typo",
      patch: { amount: 500 },
    };

    const entry = await correctCostEntry(input, "Dane");
    expect(entry.amount).toBe(500);
    expect(typeof entry.amount).toBe("number");
  });

  it("throws a not_correctable LedgerError on the correction raise text", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "correct_job_cost_entry: only manual entries can be corrected, entry came from BILL sync" },
    });

    const input: CostCorrectionInput = {
      entryId: VALID_CORRECTION_ENTRY_ID,
      reason: "Amount typo",
      patch: { amount: 500 },
    };

    await expect(correctCostEntry(input, "Dane")).rejects.toMatchObject({
      name: "LedgerError",
      code: "not_correctable",
    });
  });
});

// ============================================================
// classifyLedgerError — raise-text substrings (the cross-lane API)
// ============================================================

describe("classifyLedgerError", () => {
  const cases: Array<[string, string]> = [
    ["create_job_cost_entry: job JOB-9 not found", "not_found"],
    [
      "correct_job_cost_entry: only manual entries can be corrected, entry came from BILL sync",
      "not_correctable",
    ],
    ["create_job_cost_entry: amount must be a positive number", "invalid_input"],
    ["create_job_revenue_entry: credit entry must carry a negative amount", "invalid_input"],
    ["correct_job_cost_entry: unknown patch field flavor", "invalid_input"],
  ];

  it.each(cases)("classifies %j as %s", (message, code) => {
    expect(classifyLedgerError(message)).toBe(code);
  });

  it("is case-insensitive", () => {
    expect(classifyLedgerError("JOB JOB-9 NOT FOUND")).toBe("not_found");
  });

  it("falls back to other for an unrecognized message", () => {
    expect(classifyLedgerError("connection reset by peer")).toBe("other");
  });
});

// ============================================================
// loadLedgerJobContext
// ============================================================

function mockJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    job_number: "JOB-1104",
    status_v2: "scheduled",
    financial_status: "open",
    client_name: "Acme Co",
    client_contact_name: null,
    business_name: null,
    client_type: "commercial",
    client_phone: null,
    job_address: "123 Main St",
    city: "Salt Lake City",
    crew: "Crew 1",
    start_date: "2026-09-01",
    end_date: "2026-09-03",
    start_time: null,
    scope_summary: null,
    original_estimate_id: null,
    original_estimate_number: null,
    current_budget_version: 1,
    cancelled_at: null,
    cancellation_reason: null,
    last_forecast_at: null,
    updated_at: "2026-08-20T12:00:00Z",
    ...overrides,
  };
}

function mockBudgetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    job_number: "JOB-1104",
    version: "1",
    source_estimate_id: null,
    source_change_order_version_id: null,
    approved_revenue: "10000.00",
    productive_hours: "80.00",
    direct_labor_cost: "2080.00",
    materials_cost: "500.00",
    rentals_cost: "0.00",
    dump_cost: "900.00",
    subcontractors_cost: "0.00",
    other_direct_cost: "0.00",
    allocated_overhead: "1840.00",
    payment_processing_cost: "350.00",
    planned_economic_profit: "4330.00",
    planned_profit_pct: "43.30",
    overhead_rate: "23.00",
    labor_rate: "26.00",
    created_by_name: "Dane",
    created_at: "2026-08-19T12:00:00Z",
    ...overrides,
  };
}

describe("loadLedgerJobContext", () => {
  it('"not-a-job" returns null without querying (regex gate)', async () => {
    const result = await loadLedgerJobContext("not-a-job");
    expect(result).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns null when the jobs select returns no row", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "jobs") return chainableQuery({ data: null, error: null });
      return chainableQuery({ data: [], error: null });
    });

    const result = await loadLedgerJobContext("JOB-9999");
    expect(result).toBeNull();
  });

  it("loads job + current budget + cost/revenue entries and normalizes everything", async () => {
    const costEntryRow = {
      id: "55555555-5555-5555-5555-555555555555",
      job_number: "JOB-1104",
      category: "materials",
      state: "provisional",
      reconciliation_state: "matched",
      amount: "460.00",
      quantity: null,
      employee_name: null,
      vendor_name: "Home Depot",
      incurred_at: "2026-08-20T00:00:00Z",
      source_system: "manual",
      updated_at: "2026-08-20T12:00:00Z",
    };
    const revenueEntryRow = {
      id: "66666666-6666-6666-6666-666666666666",
      job_number: "JOB-1104",
      entry_type: "invoice",
      amount: "10000.00",
      occurred_at: "2026-08-20T00:00:00Z",
      source_system: "manual",
      created_at: "2026-08-20T12:00:00Z",
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "jobs") return chainableQuery({ data: mockJobRow(), error: null });
      if (table === "job_budget_versions") return chainableQuery({ data: mockBudgetRow(), error: null });
      if (table === "job_cost_entries") return chainableQuery({ data: [costEntryRow], error: null });
      if (table === "job_revenue_entries") return chainableQuery({ data: [revenueEntryRow], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const context = await loadLedgerJobContext("JOB-1104");

    expect(context).not.toBeNull();
    expect(context!.job.job_number).toBe("JOB-1104");
    expect(context!.currentBudget).not.toBeNull();
    expect(context!.currentBudget!.version).toBe(1);
    expect(typeof context!.currentBudget!.approved_revenue).toBe("number");
    expect(context!.costEntries).toHaveLength(1);
    expect(context!.costEntries[0].amount).toBe(460);
    expect(context!.revenueEntries).toHaveLength(1);
    expect(context!.revenueEntries[0].amount).toBe(10000);
  });

  it("currentBudget is null when jobs.current_budget_version is null — budget query skipped", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "jobs") return chainableQuery({ data: mockJobRow({ current_budget_version: null }), error: null });
      if (table === "job_budget_versions") {
        throw new Error("job_budget_versions should not be queried when current_budget_version is null");
      }
      if (table === "job_cost_entries") return chainableQuery({ data: [], error: null });
      if (table === "job_revenue_entries") return chainableQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const context = await loadLedgerJobContext("JOB-1104");

    expect(context).not.toBeNull();
    expect(context!.currentBudget).toBeNull();
  });
});
