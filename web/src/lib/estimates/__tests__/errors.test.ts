import { describe, expect, it } from "vitest";
import {
  NEWER_VERSION_EXISTS_MESSAGE,
  POSTGRES_UNIQUE_VIOLATION,
  isUniqueViolationError,
} from "@/lib/estimates/errors";

describe("isUniqueViolationError", () => {
  it("recognizes Postgres unique_violation (23505)", () => {
    expect(isUniqueViolationError({ code: "23505" })).toBe(true);
  });

  it("rejects other Postgres error codes", () => {
    expect(isUniqueViolationError({ code: "23514" })).toBe(false); // check_violation
    expect(isUniqueViolationError({ code: "23503" })).toBe(false); // foreign_key_violation
  });

  it("rejects null/undefined/empty error shapes", () => {
    expect(isUniqueViolationError(null)).toBe(false);
    expect(isUniqueViolationError(undefined)).toBe(false);
    expect(isUniqueViolationError({})).toBe(false);
    expect(isUniqueViolationError({ code: null })).toBe(false);
  });

  it("exposes the SQLSTATE constant it checks against", () => {
    expect(POSTGRES_UNIQUE_VIOLATION).toBe("23505");
  });

  it("exposes a non-empty friendly message", () => {
    expect(typeof NEWER_VERSION_EXISTS_MESSAGE).toBe("string");
    expect(NEWER_VERSION_EXISTS_MESSAGE.length).toBeGreaterThan(0);
  });
});
