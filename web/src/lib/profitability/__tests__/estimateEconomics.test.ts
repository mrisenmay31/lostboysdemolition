import { describe, expect, it } from "vitest";
import {
  computeEstimateEconomics,
  type EstimateEconomicsInput,
} from "../estimateEconomics";

/** A fully-populated, internally consistent baseline input. Every field is
 *  set to something innocuous (mostly 0) so each test states only its
 *  deltas — mirroring `calculateJobHealth.test.ts`'s `makeInput` pattern. */
function makeInput(overrides: Partial<EstimateEconomicsInput> = {}): EstimateEconomicsInput {
  return {
    productiveHours: 0,
    operationalLaborCost: 0,
    materialsCost: 0,
    rentalsCost: 0,
    expectedDumpCost: 0,
    subcontractorsCost: 0,
    otherDirectCost: 0,
    allocatedOverhead: 0,
    expectedProcessingCost: 0,
    dumpPricingBasis: 0,
    markupAmount: 0,
    processingPricingAllowance: 0,
    calculatedBid: 0,
    quotedPrice: null,
    ...overrides,
  };
}

describe("computeEstimateEconomics", () => {
  // --- Spec-pinned cases (v2 doc lines 715–837), hand-verified before
  // implementation was written: see the session report for the arithmetic. ---

  it("separates dump pricing allowance from expected dump cost without changing price (Jorge case)", () => {
    const result = computeEstimateEconomics({
      productiveHours: 34,
      operationalLaborCost: 884,
      materialsCost: 0,
      rentalsCost: 0,
      expectedDumpCost: 65,
      subcontractorsCost: 0,
      otherDirectCost: 0,
      allocatedOverhead: 782,
      expectedProcessingCost: 86.01,
      dumpPricingBasis: 300,
      markupAmount: 491.50,
      processingPricingAllowance: 86.01,
      calculatedBid: 2543.51,
      quotedPrice: null,
    });

    expect(result.operationalDirectCost).toBe(949);
    expect(result.fullyLoadedCost).toBe(1817.01);
    expect(result.riskPricingAllowance).toBe(235);
    expect(result.discountAmount).toBe(0);
    expect(result.customerPrice).toBe(2543.51);
    expect(result.plannedEconomicProfit).toBe(726.50);
    expect(result.plannedProfitPct).toBe(28.56);
  });

  it("uses quoted price and records its discount", () => {
    const result = computeEstimateEconomics({
      productiveHours: 10,
      operationalLaborCost: 260,
      materialsCost: 100,
      rentalsCost: 0,
      expectedDumpCost: 0,
      subcontractorsCost: 0,
      otherDirectCost: 0,
      allocatedOverhead: 230,
      expectedProcessingCost: 30,
      dumpPricingBasis: 0,
      markupAmount: 147.50,
      processingPricingAllowance: 25.81,
      calculatedBid: 763.31,
      quotedPrice: 700,
    });

    expect(result.operationalDirectCost).toBe(360);
    expect(result.fullyLoadedCost).toBe(620);
    expect(result.riskPricingAllowance).toBe(0);
    expect(result.discountAmount).toBe(63.31);
    expect(result.customerPrice).toBe(700);
    expect(result.plannedEconomicProfit).toBe(80);
    expect(result.plannedProfitPct).toBe(11.43);
  });

  // --- Edge cases ---

  it("quotedPrice null: no discount, customer price is the calculated bid", () => {
    const result = computeEstimateEconomics(makeInput({ calculatedBid: 1000, quotedPrice: null }));
    expect(result.discountAmount).toBe(0);
    expect(result.customerPrice).toBe(1000);
    expect(result.plannedEconomicProfit).toBe(1000);
    expect(result.plannedProfitPct).toBe(100);
  });

  it("quotedPrice ABOVE calculatedBid: discount is negative (a markup-up, allowed by contract)", () => {
    const result = computeEstimateEconomics(makeInput({ calculatedBid: 500, quotedPrice: 600 }));
    expect(result.customerPrice).toBe(600);
    expect(result.discountAmount).toBe(-100);
  });

  it("customerPrice 0: plannedProfitPct is 0, not a divide-by-zero", () => {
    const result = computeEstimateEconomics(
      makeInput({ calculatedBid: 0, quotedPrice: null, allocatedOverhead: 50 }),
    );
    expect(result.customerPrice).toBe(0);
    expect(result.fullyLoadedCost).toBe(50);
    expect(result.plannedEconomicProfit).toBe(-50);
    expect(result.plannedProfitPct).toBe(0);
  });

  it("riskPricingAllowance is negative when expectedDumpCost exceeds dumpPricingBasis (no floor — see module comment)", () => {
    const result = computeEstimateEconomics(
      makeInput({ dumpPricingBasis: 300, expectedDumpCost: 400 }),
    );
    expect(result.riskPricingAllowance).toBe(-100);
  });

  it("quotedPrice 0 is honored, not treated as absent (?? not ||)", () => {
    // Review-mandated mutation pin (2026-08-19): a `??` -> `||` refactor
    // survived the whole suite before this test. A deliberate $0 quote
    // (warranty/callback job at no charge) must price at 0, never fall
    // back to the calculated bid — the wrong customer_price would be
    // frozen immutably into estimate_financial_details.
    const result = computeEstimateEconomics(makeInput({ calculatedBid: 500, quotedPrice: 0 }));
    expect(result.customerPrice).toBe(0);
    expect(result.discountAmount).toBe(500);
  });

  it("discountAmount 0 when quotedPrice equals calculatedBid exactly", () => {
    const result = computeEstimateEconomics(makeInput({ calculatedBid: 250, quotedPrice: 250 }));
    expect(result.discountAmount).toBe(0);
    expect(result.customerPrice).toBe(250);
  });

  // --- Non-finite input validation (matches the `calculateJobHealth.ts` idiom) ---

  const requiredNumericFields: (keyof EstimateEconomicsInput)[] = [
    "productiveHours",
    "operationalLaborCost",
    "materialsCost",
    "rentalsCost",
    "expectedDumpCost",
    "subcontractorsCost",
    "otherDirectCost",
    "allocatedOverhead",
    "expectedProcessingCost",
    "dumpPricingBasis",
    "markupAmount",
    "processingPricingAllowance",
    "calculatedBid",
  ];

  for (const field of requiredNumericFields) {
    it(`throws naming ${field} when it is NaN`, () => {
      expect(() => computeEstimateEconomics(makeInput({ [field]: NaN } as Partial<EstimateEconomicsInput>)))
        .toThrow(new RegExp(`${field} must be a finite number`));
    });

    it(`throws naming ${field} when it is Infinity`, () => {
      expect(() =>
        computeEstimateEconomics(makeInput({ [field]: Infinity } as Partial<EstimateEconomicsInput>)),
      ).toThrow(new RegExp(`${field} must be a finite number`));
    });

    it(`throws naming ${field} when it is undefined`, () => {
      expect(() =>
        computeEstimateEconomics(makeInput({ [field]: undefined } as unknown as Partial<EstimateEconomicsInput>)),
      ).toThrow(new RegExp(`${field} must be a finite number`));
    });

    it(`throws naming ${field} when it is a numeric string`, () => {
      expect(() =>
        computeEstimateEconomics(makeInput({ [field]: "100" } as unknown as Partial<EstimateEconomicsInput>)),
      ).toThrow(new RegExp(`${field} must be a finite number`));
    });
  }

  it("throws naming quotedPrice when it is a non-null non-finite value", () => {
    // Also pins the module's own error prefix (review finding: a copy-paste
    // leaving the sibling module's prefix would otherwise pass every test).
    expect(() => computeEstimateEconomics(makeInput({ quotedPrice: NaN })))
      .toThrow(/computeEstimateEconomics: quotedPrice must be a finite number/);
  });

  it("does not throw when quotedPrice is null", () => {
    expect(() => computeEstimateEconomics(makeInput({ quotedPrice: null }))).not.toThrow();
  });
});
