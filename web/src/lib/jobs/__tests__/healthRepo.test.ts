import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// jobs/__tests__/repo.test.ts / ledger/__tests__/repo.test.ts's matching
// comment.
vi.mock("server-only", () => ({}));

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(() => ({ from: fromMock })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { getJobHealthDetail, normalizeCostAuditRow } from "../healthRepo";

beforeEach(() => {
  fromMock.mockReset();
  createAdminClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Fake query-builder for `.from(table).select(...).eq(...)....` chains ──
// Mirrors ledger/__tests__/repo.test.ts's chainableQuery fake, extended to
// support the shapes healthRepo.ts's getJobHealthDetail actually chains:
// `.is(...)` (job_alerts) and `.limit(N).maybeSingle()` in the SAME chain
// (job_checklists) alongside `.limit(N)` used as the terminal call on its
// own (every other table, resolved as a Promise.all element). `select`,
// `eq`, `is`, and `order` all just return the builder — every link except
// the terminal one is a no-op pass-through, same as the ledger fake — but
// `.limit()` here returns an object that is BOTH thenable (so a bare
// `await ...limit(N)` or a `Promise.all([...])` element resolves) AND
// carries its own `.maybeSingle()` (so job_checklists's `.limit(1)
// .maybeSingle()` chain also resolves to the same result).
function chainableQuery(result: { data?: unknown; error?: unknown }) {
  const limitResult = {
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => limitResult),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

const EMPTY = { data: [], error: null };

function mockJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    job_number: "JOB-1108",
    status_v2: "cancelled", // outside isEngineScorable — keeps the engine/snapshot path un-exercised
    financial_status: "open",
    client_name: "Acme Co",
    client_contact_name: null,
    business_name: null,
    client_type: "commercial",
    client_phone: null,
    job_address: "123 Main St",
    city: "Salt Lake City",
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: "2026-08-21",
    start_time: null,
    scope_summary: null,
    original_estimate_id: null,
    original_estimate_number: null,
    current_budget_version: null, // -> currentBudget stays null, engine never runs
    cancelled_at: null,
    cancellation_reason: null,
    last_forecast_at: null,
    updated_at: "2026-08-20T12:00:00Z",
    ...overrides,
  };
}

/** Routes `.from(table)` to per-table fixtures; every table not overridden
 *  in `overrides` resolves to an empty/no-row result, so a test only needs
 *  to specify the tables it cares about. */
function mockAllTables(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
  fromMock.mockImplementation((table: string) => {
    if (table === "jobs") return chainableQuery(overrides.jobs ?? { data: mockJobRow(), error: null });
    if (table === "job_checklists") return chainableQuery(overrides.job_checklists ?? { data: null, error: null });
    return chainableQuery(overrides[table] ?? EMPTY);
  });
}

function mockCostAuditRawRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "audit-1",
    reason: "TEST gate correction",
    actor_name: "Matt",
    changed_at: "2026-08-20T12:00:00Z",
    old_record: { amount: "150.00", state: "provisional" },
    new_record: { amount: "175.00", state: "provisional" },
    job_cost_entries: { job_number: "JOB-1108", category: "materials" },
    ...overrides,
  };
}

// ============================================================
// normalizeCostAuditRow
// ============================================================

describe("normalizeCostAuditRow", () => {
  it("coerces numeric-string amounts to numbers", () => {
    const row = normalizeCostAuditRow(mockCostAuditRawRow());

    expect(row.old_amount).toBe(150);
    expect(typeof row.old_amount).toBe("number");
    expect(row.new_amount).toBe(175);
    expect(typeof row.new_amount).toBe("number");
    expect(row.category).toBe("materials");
  });

  it("missing amount/state keys inside old_record/new_record normalize to null, never NaN", () => {
    const row = normalizeCostAuditRow(
      mockCostAuditRawRow({ old_record: {}, new_record: {} }),
    );

    expect(row.old_amount).toBeNull();
    expect(row.new_amount).toBeNull();
    expect(row.old_state).toBeNull();
    expect(row.new_state).toBeNull();
    expect(Number.isNaN(row.old_amount)).toBe(false);
    expect(Number.isNaN(row.new_amount)).toBe(false);
  });

  it("null old_record/new_record (missing snapshot entirely) normalizes to null, never NaN", () => {
    const row = normalizeCostAuditRow(
      mockCostAuditRawRow({ old_record: null, new_record: null }),
    );

    expect(row.old_amount).toBeNull();
    expect(row.new_amount).toBeNull();
    expect(row.old_state).toBeNull();
    expect(row.new_state).toBeNull();
  });

  it("a malformed non-numeric amount string normalizes to null, never NaN", () => {
    const row = normalizeCostAuditRow(
      mockCostAuditRawRow({ old_record: { amount: "not-a-number", state: "provisional" } }),
    );

    expect(row.old_amount).toBeNull();
    expect(Number.isNaN(row.old_amount)).toBe(false);
  });

  it("handles job_cost_entries arriving as a single-element array defensively", () => {
    const row = normalizeCostAuditRow(
      mockCostAuditRawRow({ job_cost_entries: [{ job_number: "JOB-1108", category: "dump" }] }),
    );

    expect(row.category).toBe("dump");
  });

  it("falls back to an empty-string category when the embed is missing entirely", () => {
    const row = normalizeCostAuditRow(mockCostAuditRawRow({ job_cost_entries: undefined }));

    expect(row.category).toBe("");
  });

  it("passes through id/reason/actor_name/changed_at verbatim", () => {
    const row = normalizeCostAuditRow(mockCostAuditRawRow());

    expect(row.id).toBe("audit-1");
    expect(row.reason).toBe("TEST gate correction");
    expect(row.actor_name).toBe("Matt");
    expect(row.changed_at).toBe("2026-08-20T12:00:00Z");
  });

  it("actor_name null (no attribution) passes through as null, not undefined-coerced", () => {
    const row = normalizeCostAuditRow(mockCostAuditRawRow({ actor_name: null }));
    expect(row.actor_name).toBeNull();
  });
});

// ============================================================
// getJobHealthDetail — job_cost_entry_audit wiring
// ============================================================

describe("getJobHealthDetail — costEntryAudit", () => {
  it("populates costEntryAudit from job_cost_entry_audit, normalized", async () => {
    mockAllTables({
      job_cost_entry_audit: { data: [mockCostAuditRawRow()], error: null },
    });

    const detail = await getJobHealthDetail("JOB-1108");

    expect(detail).not.toBeNull();
    expect(detail!.costEntryAudit).toHaveLength(1);
    expect(detail!.costEntryAudit[0].old_amount).toBe(150);
    expect(detail!.costEntryAudit[0].new_amount).toBe(175);
    expect(detail!.costEntryAudit[0].category).toBe("materials");
  });

  it("returns an empty costEntryAudit array when there are no correction/void rows", async () => {
    mockAllTables();

    const detail = await getJobHealthDetail("JOB-1108");

    expect(detail).not.toBeNull();
    expect(detail!.costEntryAudit).toEqual([]);
  });

  it("throws a named error when the job_cost_entry_audit query errors, matching every other query's error-check style", async () => {
    mockAllTables({
      job_cost_entry_audit: { data: null, error: { message: "connection reset" } },
    });

    await expect(getJobHealthDetail("JOB-1108")).rejects.toThrow(
      "getJobHealthDetail: cost entry audit query failed: connection reset",
    );
  });
});
