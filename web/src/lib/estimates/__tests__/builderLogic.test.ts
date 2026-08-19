import { describe, expect, it } from "vitest";
import {
  assignSortOrders,
  deriveMode,
  isInvalidDecimalInput,
  parseNonNegativeDecimal,
  resolveReviseCostDefaults,
  sumLineItems,
} from "@/lib/estimates/builderLogic";
import type { EstimateFinancialDetailsRow, LineItemDraft } from "@/lib/estimates/types";

function item(overrides: Partial<LineItemDraft> = {}): LineItemDraft {
  return {
    name: "Item",
    laborHours: 1,
    dumpCount: 1,
    materialsCost: 1,
    ...overrides,
  };
}

describe("deriveMode", () => {
  it("total_hours with no line items -> quick", () => {
    expect(deriveMode("total_hours", 0)).toBe("quick");
  });

  it("total_hours with line items -> itemized", () => {
    expect(deriveMode("total_hours", 1)).toBe("itemized");
    expect(deriveMode("total_hours", 5)).toBe("itemized");
  });

  it("days_employees is always quick, even if line items were somehow present", () => {
    expect(deriveMode("days_employees", 0)).toBe("quick");
    expect(deriveMode("days_employees", 3)).toBe("quick");
  });
});

describe("sumLineItems", () => {
  it("returns all-zero sums for an empty array", () => {
    expect(sumLineItems([])).toEqual({ laborHours: 0, dumpCount: 0, materialsCost: 0 });
  });

  it("sums a single line item", () => {
    expect(sumLineItems([item({ laborHours: 8, dumpCount: 1, materialsCost: 50 })])).toEqual({
      laborHours: 8,
      dumpCount: 1,
      materialsCost: 50,
    });
  });

  it("sums multiple line items, including fractional dump counts", () => {
    const items = [
      item({ laborHours: 8, dumpCount: 1, materialsCost: 50 }),
      item({ laborHours: 4, dumpCount: 0.5, materialsCost: 75 }),
      item({ laborHours: 2.5, dumpCount: 0.25, materialsCost: 0 }),
    ];
    expect(sumLineItems(items)).toEqual({ laborHours: 14.5, dumpCount: 1.75, materialsCost: 125 });
  });

  it("does not mutate the input array or its items", () => {
    const items = [item({ laborHours: 3 })];
    const snapshot = JSON.parse(JSON.stringify(items));
    sumLineItems(items);
    expect(items).toEqual(snapshot);
  });
});

describe("parseNonNegativeDecimal — Task 11 review Finding 1", () => {
  it("empty string -> 0", () => {
    expect(parseNonNegativeDecimal("")).toBe(0);
  });

  it("whitespace-only -> 0", () => {
    expect(parseNonNegativeDecimal("   ")).toBe(0);
  });

  it("LOCK: parses a leading-dot decimal — the exact failure case from the finding", () => {
    expect(parseNonNegativeDecimal(".25")).toBe(0.25);
  });

  it("parses a trailing-dot decimal (another legal type=number intermediate state)", () => {
    expect(parseNonNegativeDecimal("1.")).toBe(1);
    expect(parseNonNegativeDecimal("0.")).toBe(0);
  });

  it("parses a plain whole number", () => {
    expect(parseNonNegativeDecimal("12")).toBe(12);
  });

  it("parses an ordinary decimal", () => {
    expect(parseNonNegativeDecimal("3.5")).toBe(3.5);
  });

  it("clamps a negative number to 0 (HARD REQUIREMENT: never negative)", () => {
    expect(parseNonNegativeDecimal("-5")).toBe(0);
  });

  it("treats non-numeric garbage as 0 rather than throwing", () => {
    expect(parseNonNegativeDecimal("abc")).toBe(0);
    expect(parseNonNegativeDecimal("1.2.3")).toBe(0);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseNonNegativeDecimal("  3.5  ")).toBe(3.5);
  });

  it("leading zeros still parse to the plain numeric value", () => {
    expect(parseNonNegativeDecimal("007")).toBe(7);
  });

  it("strips thousands-separator commas (integration round polish)", () => {
    expect(parseNonNegativeDecimal("1,200")).toBe(1200);
    expect(parseNonNegativeDecimal("12,345.67")).toBe(12345.67);
  });

  it("strips internal whitespace alongside commas", () => {
    expect(parseNonNegativeDecimal("1, 200")).toBe(1200);
    expect(parseNonNegativeDecimal("1 200")).toBe(1200);
  });
});

describe("isInvalidDecimalInput — integration round polish", () => {
  it("empty/whitespace-only is not flagged invalid (it's just unset, treated as 0)", () => {
    expect(isInvalidDecimalInput("")).toBe(false);
    expect(isInvalidDecimalInput("   ")).toBe(false);
  });

  it("flags non-numeric garbage as invalid", () => {
    expect(isInvalidDecimalInput("abc")).toBe(true);
    expect(isInvalidDecimalInput("1.2.3")).toBe(true);
  });

  it("does not flag anything parseNonNegativeDecimal can actually parse", () => {
    expect(isInvalidDecimalInput("5")).toBe(false);
    expect(isInvalidDecimalInput(".25")).toBe(false);
    expect(isInvalidDecimalInput("1.")).toBe(false);
    expect(isInvalidDecimalInput("1,200")).toBe(false);
    expect(isInvalidDecimalInput("1, 200")).toBe(false);
  });

  it("a negative number is parseable, so NOT flagged invalid (it's a sign/clamp concern, not a parse failure)", () => {
    expect(isInvalidDecimalInput("-5")).toBe(false);
  });
});

describe("assignSortOrders — Task 11 review Finding 3", () => {
  it("returns an empty array for no items", () => {
    expect(assignSortOrders([])).toEqual([]);
  });

  it("assigns 0-based sequential sort_order matching array position, discarding any prior value", () => {
    const items: LineItemDraft[] = [
      item({ name: "A", sortOrder: 99 }),
      item({ name: "B", sortOrder: 99 }),
      item({ name: "C", sortOrder: 99 }),
    ];
    expect(assignSortOrders(items).map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it("LOCK: never collides sort_order after a remove-then-add sequence", () => {
    // Simulates: add A, add B, add C, remove B, add D. Assigning
    // sort_order at add time (sortOrder = prev.length) used to leave C
    // and D both claiming sort_order 2 here. assignSortOrders is called
    // on the FINAL array at submit time instead, so it can't collide.
    const afterRemoveAndAdd: LineItemDraft[] = [
      item({ name: "A" }),
      item({ name: "C" }),
      item({ name: "D" }),
    ];
    const result = assignSortOrders(afterRemoveAndAdd);
    const sortOrders = result.map((i) => i.sortOrder);
    expect(sortOrders).toEqual([0, 1, 2]);
    expect(new Set(sortOrders).size).toBe(sortOrders.length);
  });

  it("does not mutate its input", () => {
    const items = [item({ name: "A", sortOrder: 5 })];
    const snapshot = JSON.parse(JSON.stringify(items));
    assignSortOrders(items);
    expect(items).toEqual(snapshot);
  });
});

describe("resolveReviseCostDefaults — fix round F5", () => {
  function financialDetails(
    overrides: Partial<EstimateFinancialDetailsRow> = {},
  ): Pick<
    EstimateFinancialDetailsRow,
    "materials_cost" | "rentals_cost" | "subcontractors_cost" | "other_direct_cost"
  > {
    return {
      materials_cost: 100,
      rentals_cost: 50,
      subcontractors_cost: 25,
      other_direct_cost: 10,
      ...overrides,
    };
  }

  it("with financialDetails present, maps each of the 4 category costs verbatim to its Raw string", () => {
    expect(resolveReviseCostDefaults(185, financialDetails())).toEqual({
      materialsCostRaw: "100",
      rentalsCostRaw: "50",
      subcontractorsCostRaw: "25",
      otherDirectCostRaw: "10",
    });
  });

  it("LOCK (details-less legacy estimate): folds the whole job_specific_costs aggregate into otherDirectCostRaw, zeroing the other three", () => {
    expect(resolveReviseCostDefaults(742.5, null)).toEqual({
      materialsCostRaw: "0",
      rentalsCostRaw: "0",
      subcontractorsCostRaw: "0",
      otherDirectCostRaw: "742.5",
    });
  });

  it("LOCK: the details-less fallback preserves the parent's aggregate EXACTLY (0+0+0+otherDirect == jobSpecificCosts)", () => {
    const jobSpecificCosts = 1234.56;
    const result = resolveReviseCostDefaults(jobSpecificCosts, null);
    const sum =
      Number(result.materialsCostRaw) +
      Number(result.rentalsCostRaw) +
      Number(result.subcontractorsCostRaw) +
      Number(result.otherDirectCostRaw);
    expect(sum).toBe(jobSpecificCosts);
  });

  it("a details-less estimate with jobSpecificCosts = 0 still returns all-zero strings, not blank", () => {
    expect(resolveReviseCostDefaults(0, null)).toEqual({
      materialsCostRaw: "0",
      rentalsCostRaw: "0",
      subcontractorsCostRaw: "0",
      otherDirectCostRaw: "0",
    });
  });
});
