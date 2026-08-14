import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRates, type Rates } from "@/lib/pricing";

export interface RatesConfig {
  rates: Rates;
  defaultMarkupPct: number;
  markupFloorPct: number;
}

// Keys read from pricing_variables, mapped to their Rates field (or null when
// the value belongs on RatesConfig directly, outside the Rates object the
// engine validates).
const RATE_KEYS = [
  "labor_rate_per_hour",
  "overhead_rate_per_hour",
  "dump_rate_per_load",
  "cc_fee_rate",
  "default_markup_pct",
  "markup_floor_pct",
] as const;

type RateKey = (typeof RATE_KEYS)[number];

/**
 * Loads the live pricing_variables row set and maps it onto the engine's
 * Rates shape. NEVER falls back to DEFAULT_RATES on a missing/malformed row —
 * a silent fallback would mask a broken rates table and quietly reprice
 * every estimate off stale in-code defaults. Any gap throws, by name.
 *
 * Wrapped in React's `cache()` for per-request dedup only — this is NOT a
 * cross-request cache; each request gets a fresh read via a fresh
 * `createAdminClient()`.
 */
export const loadRatesConfig = cache(async (): Promise<RatesConfig> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pricing_variables")
    .select("key, value");

  if (error) {
    throw new Error(`loadRatesConfig: pricing_variables query failed: ${error.message}`);
  }

  const values = new Map<string, number>();
  for (const row of data ?? []) {
    const key = row.key as string;
    // Supabase may return `numeric` columns as strings — coerce explicitly.
    values.set(key, Number(row.value as unknown as string | number));
  }

  for (const key of RATE_KEYS) {
    if (!values.has(key)) {
      throw new Error(`loadRatesConfig: pricing_variables is missing required key "${key}"`);
    }
  }

  const get = (key: RateKey): number => values.get(key) as number;

  const rates: Rates = {
    laborRatePerHour: get("labor_rate_per_hour"),
    overheadRatePerHour: get("overhead_rate_per_hour"),
    dumpRatePerLoad: get("dump_rate_per_load"),
    ccFeeRate: get("cc_fee_rate"),
  };

  // The engine's own validator: finite, >= 0, ccFeeRate < 1.
  requireRates(rates);

  const defaultMarkupPct = get("default_markup_pct");
  const markupFloorPct = get("markup_floor_pct");

  if (!Number.isFinite(defaultMarkupPct)) {
    throw new Error(
      `loadRatesConfig: default_markup_pct must be a finite number, got ${defaultMarkupPct}`,
    );
  }
  if (!Number.isFinite(markupFloorPct)) {
    throw new Error(
      `loadRatesConfig: markup_floor_pct must be a finite number, got ${markupFloorPct}`,
    );
  }

  return { rates, defaultMarkupPct, markupFloorPct };
});
