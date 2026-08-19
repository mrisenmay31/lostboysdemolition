import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PricingVariableRow = { key: string; value: number | string };

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));

// vitest runs in a plain Node environment (no "react-server" export
// condition), so the real server-only package throws on import outside a
// Server Component. Stub it so rates.ts's `import "server-only"` is inert
// under test — same pattern the module itself relies on in production.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

function mockAdminClient(
  rows: PricingVariableRow[],
  queryError: { message: string } | null = null,
) {
  return {
    from: vi.fn((table: string) => {
      expect(table).toBe("pricing_variables");
      return {
        select: vi.fn(async (columns: string) => {
          expect(columns).toBe("key, value");
          return { data: queryError ? null : rows, error: queryError };
        }),
      };
    }),
  };
}

const ALL_ROWS: PricingVariableRow[] = [
  { key: "labor_rate_per_hour", value: 26 },
  { key: "overhead_rate_per_hour", value: 23 },
  { key: "dump_rate_per_load", value: 300 },
  { key: "cc_fee_rate", value: 0.035 },
  { key: "default_markup_pct", value: 25 },
  { key: "markup_floor_pct", value: 15 },
  { key: "estimated_dump_cost_per_load", value: 65 },
];

// Each test dynamically re-imports the module after vi.resetModules() so it
// gets a fresh react `cache()` instance — otherwise the first test's result
// would be memoized and reused by every later test regardless of mock setup.
async function importLoader() {
  const mod = await import("@/lib/rates");
  return mod.loadRatesConfig;
}

beforeEach(() => {
  vi.resetModules();
  createAdminClientMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadRatesConfig — happy path", () => {
  it("maps all 7 snake_case pricing_variables keys to the correct camelCase RatesConfig shape", async () => {
    createAdminClientMock.mockReturnValue(mockAdminClient(ALL_ROWS));
    const loadRatesConfig = await importLoader();

    const config = await loadRatesConfig();

    expect(config).toEqual({
      rates: {
        laborRatePerHour: 26,
        overheadRatePerHour: 23,
        dumpRatePerLoad: 300,
        ccFeeRate: 0.035,
      },
      defaultMarkupPct: 25,
      markupFloorPct: 15,
      estimatedDumpCostPerLoad: 65,
    });
  });

  it("coerces string-numeric values, as Supabase returns for numeric columns", async () => {
    const stringRows = ALL_ROWS.map((row) => ({ ...row, value: String(row.value) }));
    createAdminClientMock.mockReturnValue(mockAdminClient(stringRows));
    const loadRatesConfig = await importLoader();

    const config = await loadRatesConfig();

    expect(config.rates.laborRatePerHour).toBe(26);
    expect(typeof config.rates.laborRatePerHour).toBe("number");
    expect(config.rates.ccFeeRate).toBe(0.035);
    expect(config.defaultMarkupPct).toBe(25);
    expect(config.markupFloorPct).toBe(15);
    expect(config.estimatedDumpCostPerLoad).toBe(65);
    expect(typeof config.estimatedDumpCostPerLoad).toBe("number");
  });
});

describe("loadRatesConfig — missing key, no fallback to DEFAULT_RATES", () => {
  it.each([
    "labor_rate_per_hour",
    "overhead_rate_per_hour",
    "dump_rate_per_load",
    "cc_fee_rate",
    "default_markup_pct",
    "markup_floor_pct",
    "estimated_dump_cost_per_load",
  ])("throws naming %s when that key is absent from pricing_variables", async (missingKey) => {
    const rows = ALL_ROWS.filter((row) => row.key !== missingKey);
    createAdminClientMock.mockReturnValue(mockAdminClient(rows));
    const loadRatesConfig = await importLoader();

    await expect(loadRatesConfig()).rejects.toThrow(new RegExp(missingKey));
  });

  it("throws (not a silent DEFAULT_RATES fallback) when the query itself errors", async () => {
    createAdminClientMock.mockReturnValue(
      mockAdminClient([], { message: "connection refused" }),
    );
    const loadRatesConfig = await importLoader();

    await expect(loadRatesConfig()).rejects.toThrow(/connection refused/);
  });
});

describe("loadRatesConfig — validated via the engine's own requireRates", () => {
  it("throws when cc_fee_rate >= 1", async () => {
    const badRows = ALL_ROWS.map((row) =>
      row.key === "cc_fee_rate" ? { ...row, value: 1 } : row,
    );
    createAdminClientMock.mockReturnValue(mockAdminClient(badRows));
    const loadRatesConfig = await importLoader();

    await expect(loadRatesConfig()).rejects.toThrow(/ccFeeRate/);
  });

  it("throws when a rate is negative", async () => {
    const badRows = ALL_ROWS.map((row) =>
      row.key === "labor_rate_per_hour" ? { ...row, value: -1 } : row,
    );
    createAdminClientMock.mockReturnValue(mockAdminClient(badRows));
    const loadRatesConfig = await importLoader();

    await expect(loadRatesConfig()).rejects.toThrow(/laborRatePerHour/);
  });

  it("throws when default_markup_pct is not finite", async () => {
    const badRows = ALL_ROWS.map((row) =>
      row.key === "default_markup_pct" ? { ...row, value: Number.NaN } : row,
    );
    createAdminClientMock.mockReturnValue(mockAdminClient(badRows));
    const loadRatesConfig = await importLoader();

    await expect(loadRatesConfig()).rejects.toThrow(/default_markup_pct/);
  });

  it("throws when estimated_dump_cost_per_load is not finite", async () => {
    const badRows = ALL_ROWS.map((row) =>
      row.key === "estimated_dump_cost_per_load" ? { ...row, value: Number.NaN } : row,
    );
    createAdminClientMock.mockReturnValue(mockAdminClient(badRows));
    const loadRatesConfig = await importLoader();

    await expect(loadRatesConfig()).rejects.toThrow(/estimated_dump_cost_per_load/);
  });

  it("throws when estimated_dump_cost_per_load is negative", async () => {
    const badRows = ALL_ROWS.map((row) =>
      row.key === "estimated_dump_cost_per_load" ? { ...row, value: -1 } : row,
    );
    createAdminClientMock.mockReturnValue(mockAdminClient(badRows));
    const loadRatesConfig = await importLoader();

    await expect(loadRatesConfig()).rejects.toThrow(/estimated_dump_cost_per_load/);
  });
});
