import { describe, expect, it } from "vitest";
import {
  assignSortOrders,
  deriveMode,
  parseNonNegativeDecimal,
  sumLineItems,
} from "@/lib/estimates/builderLogic";
import type { LineItemDraft } from "@/lib/estimates/types";

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
