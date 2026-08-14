import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEstimate, type EstimateInputs } from "./pricing.ts";

interface FixtureRecord {
  estimate_id: number;
  job_name: string | null;
  method: string;
  hours: number | null;
  days: number | null;
  emps: number | null;
  dumps: number | null;
  jsc: number | null;
  profit_pct_in: number | null;
  stored: {
    labor: number | null; dump: number | null; supplies: number | null;
    total_direct: number | null; overhead: number | null; profit: number | null;
    cc: number | null; revenue: number;
  };
}
// Note: estimate 1057 ("Test Job") has a NULL stored total_direct — the only
// null output field in the dataset. Null stored fields are skipped, not asserted.

// The 2026-03-19T17:21:17Z bulk-import batch: hand-keyed historical backfill,
// never produced by the live calculator. Diffs (stored − computed revenue) are
// locked so silent drift in either direction fails loudly.
// See research doc §2 for the per-record causes ($150/$250/$375 dump rates, off-rate labor).
const KNOWN_LEGACY_DIFFS: Record<number, number> = {
  1007: -30.43, 1019: -30.42, 1025: -186.30, 1031: -186.30, 1039: -186.30,
  1040: -186.30, 1041: -186.30, 1046: 93.15, 1048: -30.42, 1049: 93.15, 1056: -186.30,
};
// Zao Remodel (HVAC), live record with a single $0.01 rounding artifact in Fillout's output.
const PENNY_TOLERANCE_IDS = new Set([1075]);

function toInputs(r: FixtureRecord): EstimateInputs {
  const base = {
    dumpCount: r.dumps ?? 0,
    jobSpecificCosts: r.jsc ?? 0,
    markupPct: r.profit_pct_in ?? 0,
  };
  if (r.method === "Days at job/Number of Employees") {
    return { ...base, laborMethod: "days_employees", daysAtJob: r.days ?? 0, numEmployees: r.emps ?? 0 };
  }
  return { ...base, laborMethod: "total_hours", totalJobHours: r.hours ?? 0 };
}

const fixturePath = new URL("./fixtures/estimates-golden-321.json", import.meta.url);
const records: FixtureRecord[] = JSON.parse(Deno.readTextFileSync(fixturePath));

Deno.test("fixture contains all 321 estimates", () => {
  assertEquals(records.length, 321);
});

Deno.test("golden master: every live-calculator estimate reproduces to the cent", () => {
  let exact = 0;
  for (const r of records) {
    const out = computeEstimate(toInputs(r));
    const label = `estimate ${r.estimate_id} (${r.job_name ?? "no name"})`;

    if (r.estimate_id in KNOWN_LEGACY_DIFFS) {
      assertAlmostEquals(
        r.stored.revenue - out.totalBid, KNOWN_LEGACY_DIFFS[r.estimate_id], 0.005,
        `${label}: legacy diff drifted — engine or fixture changed`,
      );
      continue;
    }
    if (PENNY_TOLERANCE_IDS.has(r.estimate_id)) {
      assertAlmostEquals(out.totalBid, r.stored.revenue, 0.011, `${label}: beyond penny tolerance`);
      continue;
    }
    // Null stored fields (rare data gaps in Airtable) are skipped; revenue is always asserted.
    if (r.stored.labor !== null) assertEquals(out.laborCost, r.stored.labor, `${label}: labor`);
    if (r.stored.dump !== null) assertEquals(out.dumpFees, r.stored.dump, `${label}: dump`);
    if (r.stored.total_direct !== null) assertEquals(out.totalDirect, r.stored.total_direct, `${label}: totalDirect`);
    if (r.stored.overhead !== null) assertEquals(out.overhead, r.stored.overhead, `${label}: overhead`);
    if (r.stored.profit !== null) assertEquals(out.profit, r.stored.profit, `${label}: profit`);
    if (r.stored.cc !== null) assertEquals(out.ccFee, r.stored.cc, `${label}: ccFee`);
    assertEquals(out.totalBid, r.stored.revenue, `${label}: totalBid`);
    exact++;
  }
  assertEquals(exact, 309, "expected exactly 309 cent-exact records (321 − 11 legacy − 1 penny)");
});
