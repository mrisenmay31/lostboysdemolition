import { describe, expect, it } from "vitest";
import { validateForecastOverrideInput } from "../validate";

const labor = {
  kind: "labor",
  jobNumber: "JOB-1108",
  remainingWorkdays: 3,
  expectedCrewSize: 4,
  hoursPerDay: 8,
  reason: "Crew 2 pulled to another job two days",
};

const category = {
  kind: "category",
  jobNumber: "JOB-1108",
  category: "dump",
  expectedRemainingCost: 130,
  reason: "Two more loads expected",
};

describe("validateForecastOverrideInput — labor", () => {
  it("accepts a full labor triple", () => {
    const r = validateForecastOverrideInput(labor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(labor);
  });

  it("accepts remainingWorkdays 0 (job nearly done)", () => {
    expect(validateForecastOverrideInput({ ...labor, remainingWorkdays: 0 }).ok).toBe(true);
  });

  it("rejects zero or negative expectedCrewSize (zero-divisor guard)", () => {
    expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: 0 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: -2 }).ok).toBe(false);
  });

  it("rejects non-integer expectedCrewSize", () => {
    expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: 2.5 }).ok).toBe(false);
  });

  it("rejects hoursPerDay of 0, negative, or > 24 (zero-divisor guard)", () => {
    expect(validateForecastOverrideInput({ ...labor, hoursPerDay: 0 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, hoursPerDay: -1 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, hoursPerDay: 24.5 }).ok).toBe(false);
  });

  it("rejects negative remainingWorkdays", () => {
    expect(validateForecastOverrideInput({ ...labor, remainingWorkdays: -1 }).ok).toBe(false);
  });

  it("rejects a partial labor triple", () => {
    const partial: Record<string, unknown> = { ...labor };
    delete partial.hoursPerDay;
    expect(validateForecastOverrideInput(partial).ok).toBe(false);
  });

  it.each(["", "3", NaN, Infinity, null])(
    "rejects %p in every numeric field (empty-string/coercion carry)",
    (bad) => {
      expect(validateForecastOverrideInput({ ...labor, remainingWorkdays: bad }).ok).toBe(false);
      expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: bad }).ok).toBe(false);
      expect(validateForecastOverrideInput({ ...labor, hoursPerDay: bad }).ok).toBe(false);
    },
  );
});

describe("validateForecastOverrideInput — category", () => {
  it("accepts a category ETC override", () => {
    const r = validateForecastOverrideInput(category);
    expect(r.ok).toBe(true);
  });

  it("accepts expectedRemainingCost 0 (nothing left to spend)", () => {
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: 0 }).ok).toBe(true);
  });

  it("rejects negative and non-number expectedRemainingCost", () => {
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: -5 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: "130" }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: "" }).ok).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(validateForecastOverrideInput({ ...category, category: "overhead" }).ok).toBe(false);
  });
});

describe("validateForecastOverrideInput — shared", () => {
  it("rejects an unknown kind and a mixed submission", () => {
    expect(validateForecastOverrideInput({ ...labor, kind: "both" }).ok).toBe(false);
    expect(
      validateForecastOverrideInput({ ...labor, category: "dump", expectedRemainingCost: 100 }).ok,
    ).toBe(false); // labor schema is strict — category fields on a labor submission are rejected
  });

  it("rejects a blank or whitespace reason", () => {
    expect(validateForecastOverrideInput({ ...labor, reason: "" }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, reason: "   " }).ok).toBe(false);
  });

  it("rejects a malformed job number", () => {
    expect(validateForecastOverrideInput({ ...labor, jobNumber: "1108" }).ok).toBe(false);
  });

  it("returns path-prefixed error strings", () => {
    const r = validateForecastOverrideInput({ ...labor, expectedCrewSize: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("expectedCrewSize"))).toBe(true);
  });
});
