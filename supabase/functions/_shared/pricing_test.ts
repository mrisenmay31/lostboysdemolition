import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEstimate, DEFAULT_RATES, roundToCent } from "./pricing.ts";

Deno.test("roundToCent rounds half-up to 2 decimals", () => {
  assertEquals(roundToCent(1.005), 1.01);
  assertEquals(roundToCent(2.674999), 2.67);
  assertEquals(roundToCent(0), 0);
});

Deno.test("roundToCent rounds half-up above $2 (Finding 1 regression)", () => {
  assertEquals(roundToCent(2.135), 2.14);
  assertEquals(roundToCent(320.155), 320.16);
});

// Jorge's Interior (estimate 1321, live Fillout output 2026-08-12):
// 34 hrs, 1 dump, $0 JSC, 25% markup → total bid $2,543.51
Deno.test("total_hours method matches live record Jorge's Interior", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 34,
    dumpCount: 1, jobSpecificCosts: 0, markupPct: 25,
  });
  assertEquals(out.effectiveHours, 34);
  assertEquals(out.laborCost, 884.00);      // 26 × 34
  assertEquals(out.dumpFees, 300.00);
  assertEquals(out.totalDirect, 1184.00);
  assertEquals(out.overhead, 782.00);       // 23 × 34
  assertEquals(out.profit, 491.50);         // (1184+782) × 0.25
  assertEquals(out.ccFee, 86.01);           // (1184+782+491.50) × 0.035
  assertEquals(out.totalBid, 2543.51);
});

// Blake's Commerical [sic] Demo (estimate 1320, live 2026-08-12): FRACTIONAL dump count 0.5
// 22 hrs, 0.5 dumps, $0 JSC, 25% → $1,588.73
Deno.test("fractional dump count (0.5) matches live record Blake's", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 22,
    dumpCount: 0.5, jobSpecificCosts: 0, markupPct: 25,
  });
  assertEquals(out.dumpFees, 150.00);
  assertEquals(out.totalBid, 1588.73);
});

// Big Horn Construction (bulk import but formula-clean): days_employees method
// 4 days × 4 employees × 8 = 128 hrs, 4 dumps, $500 JSC, 20% → $9,901.22
Deno.test("days_employees method matches live record Big Horn", () => {
  const out = computeEstimate({
    laborMethod: "days_employees", daysAtJob: 4, numEmployees: 4,
    dumpCount: 4, jobSpecificCosts: 500, markupPct: 20,
  });
  assertEquals(out.effectiveHours, 128);
  assertEquals(out.totalBid, 9901.22);
});

// Sean Michaelis (estimate 1108, live): highest markup in dataset (42%), 427 hrs, 13 dumps, $3,100 JSC → $41,038.43
Deno.test("high markup 42% matches live record Sean Michaelis", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 427,
    dumpCount: 13, jobSpecificCosts: 3100, markupPct: 42,
  });
  assertEquals(out.totalBid, 41038.43);
});

// Dr. Russell's Office Space (live): zero dumps, JSC-heavy
// 170 hrs, 0 dumps, $1,500 JSC, 25% → $12,717.56
Deno.test("zero dumps matches live record Dr. Russell's", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 170,
    dumpCount: 0, jobSpecificCosts: 1500, markupPct: 25,
  });
  assertEquals(out.totalBid, 12717.56);
});

Deno.test("true margin: entered 25 markup realises ~19.3% of revenue (DISCOVERY §1)", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 100,
    dumpCount: 0, jobSpecificCosts: 0, markupPct: 25,
  });
  // labor 2600 + overhead 2300 = 4900; profit 1225; cc 214.38; totalBid 6339.38
  // trueMargin = 1225 / 6339.38 × 100 = 19.32%
  assertEquals(out.trueMarginPct, 19.32);
});

Deno.test("custom rates override DEFAULT_RATES", () => {
  const out = computeEstimate(
    { laborMethod: "total_hours", totalJobHours: 10, dumpCount: 1, jobSpecificCosts: 0, markupPct: 25 },
    { ...DEFAULT_RATES, ccFeeRate: 0.03 },
  );
  // (260+300+230) × 1.25 = 987.50; cc = 29.63 (@3%); total = 1017.13
  assertEquals(out.ccFee, 29.63);
  assertEquals(out.totalBid, 1017.13);
});

// Cent-bearing jobSpecificCosts (0.62), hand-derived under the half-up fix:
// 20 hrs, 1 dump, $0.62 JSC, 25% markup.
// laborCost 520.00, dumpFees 300.00, totalDirect 820.62, overhead 460.00,
// profit = roundToCent(1280.62 × 0.25) = roundToCent(320.155) = 320.16 (half-up),
// ccFee = roundToCent(1600.78 × 0.035) = 56.03, totalBid = 1656.81.
Deno.test("cent-bearing jobSpecificCosts rounds profit half-up (Finding 1)", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 20,
    dumpCount: 1, jobSpecificCosts: 0.62, markupPct: 25,
  });
  assertEquals(out.effectiveHours, 20);
  assertEquals(out.laborCost, 520.00);
  assertEquals(out.dumpFees, 300.00);
  assertEquals(out.totalDirect, 820.62);
  assertEquals(out.overhead, 460.00);
  assertEquals(out.profit, 320.16);
  assertEquals(out.ccFee, 56.03);
  assertEquals(out.totalBid, 1656.81);
});

Deno.test("validation: rejects bad rates (Finding 2)", () => {
  const base = { laborMethod: "total_hours" as const, totalJobHours: 10, dumpCount: 1, jobSpecificCosts: 0, markupPct: 25 };
  assertThrows(() => computeEstimate(base, { ...DEFAULT_RATES, laborRatePerHour: -1 }));
  assertThrows(() => computeEstimate(base, { ...DEFAULT_RATES, overheadRatePerHour: NaN }));
  assertThrows(() => computeEstimate(base, { ...DEFAULT_RATES, dumpRatePerLoad: -300 }));
  assertThrows(() => computeEstimate(base, { ...DEFAULT_RATES, ccFeeRate: -0.01 }));
  // The exact regression this finding guards against: a rate entered as a
  // whole-number percent (3.5) instead of a fraction (0.035) must be rejected,
  // not silently accepted and left to inflate every bid ~100x.
  assertThrows(() => computeEstimate(base, { ...DEFAULT_RATES, ccFeeRate: 3.5 }));
  assertThrows(() => computeEstimate(base, { ...DEFAULT_RATES, ccFeeRate: 1 }));
});

Deno.test("validation: rejects bad inputs", () => {
  const base = { laborMethod: "total_hours" as const, totalJobHours: 10, dumpCount: 1, jobSpecificCosts: 0, markupPct: 25 };
  assertThrows(() => computeEstimate({ ...base, totalJobHours: undefined }));
  assertThrows(() => computeEstimate({ ...base, totalJobHours: -1 }));
  assertThrows(() => computeEstimate({ ...base, dumpCount: -0.5 }));
  assertThrows(() => computeEstimate({ ...base, markupPct: NaN }));
  assertThrows(() => computeEstimate({ ...base, jobSpecificCosts: -100 }));
  assertThrows(() => computeEstimate({ laborMethod: "days_employees", dumpCount: 1, jobSpecificCosts: 0, markupPct: 25 })); // missing days/employees
});
