import { describe, expect, it } from "vitest";
import { isValidEstimateId } from "@/lib/estimates/ids";

describe("isValidEstimateId", () => {
  it("accepts a well-formed UUID (any case)", () => {
    expect(isValidEstimateId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isValidEstimateId("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(isValidEstimateId("not-a-uuid")).toBe(false);
    expect(isValidEstimateId("")).toBe(false);
    expect(isValidEstimateId("123e4567-e89b-12d3-a456")).toBe(false);
  });

  it("rejects an attempted filter/SQL-injection payload", () => {
    expect(isValidEstimateId("1' OR '1'='1")).toBe(false);
    expect(isValidEstimateId("../../etc/passwd")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidEstimateId(null)).toBe(false);
    expect(isValidEstimateId(undefined)).toBe(false);
    expect(isValidEstimateId(123)).toBe(false);
    expect(isValidEstimateId({})).toBe(false);
  });
});
