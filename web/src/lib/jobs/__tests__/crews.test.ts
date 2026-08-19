import { describe, expect, it } from "vitest";
import { CREW_OPTIONS, isCrew } from "../crews";

describe("CREW_OPTIONS", () => {
  it("is exactly the four operational crews, in order", () => {
    expect(CREW_OPTIONS).toEqual(["Crew 1", "Crew 2", "Crew 3", "Crew 4"]);
  });
});

describe("isCrew", () => {
  it.each(CREW_OPTIONS)("accepts %j", (crew) => {
    expect(isCrew(crew)).toBe(true);
  });

  it("rejects a non-member string", () => {
    expect(isCrew("Crew 5")).toBe(false);
  });

  it("rejects the legacy 'Jackson'/'Other' values", () => {
    expect(isCrew("Jackson")).toBe(false);
    expect(isCrew("Other")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isCrew(1)).toBe(false);
    expect(isCrew(null)).toBe(false);
    expect(isCrew(undefined)).toBe(false);
  });
});
