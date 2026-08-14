import { describe, expect, it } from "vitest";
import { deriveMode, sumLineItems } from "@/lib/estimates/builderLogic";
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
