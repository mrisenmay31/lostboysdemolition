import { describe, expect, it } from "vitest";
import { sanitizeSearchTerm } from "@/lib/estimates/search";

describe("sanitizeSearchTerm", () => {
  it("passes ordinary text through unchanged", () => {
    expect(sanitizeSearchTerm("Jorge Ramirez")).toBe("Jorge Ramirez");
  });

  it("strips commas — the PostgREST or() condition separator", () => {
    expect(sanitizeSearchTerm("a,status.eq.declined")).toBe("astatus.eq.declined");
  });

  it("strips parentheses — PostgREST filter grouping", () => {
    expect(sanitizeSearchTerm("a)or(status.eq.draft")).toBe("aorstatus.eq.draft");
  });

  it("neutralizes a combined comma+paren injection attempt", () => {
    // A hostile value trying to smuggle in a second OR condition and
    // close/reopen a group around the injected clause.
    const hostile = "x,status.eq.declined),or(id.eq.1";
    const result = sanitizeSearchTerm(hostile);
    expect(result).not.toContain(",");
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
    expect(result).toBe("xstatus.eq.declinedorid.eq.1");
  });

  it("escapes literal % as a LIKE wildcard, not stripped", () => {
    expect(sanitizeSearchTerm("50% off")).toBe("50\\% off");
  });

  it("escapes literal _ as a LIKE wildcard, not stripped", () => {
    expect(sanitizeSearchTerm("job_42")).toBe("job\\_42");
  });

  it("escapes a literal backslash before escaping wildcards, so it isn't double-escaped", () => {
    expect(sanitizeSearchTerm("a\\b")).toBe("a\\\\b");
    expect(sanitizeSearchTerm("a\\%b")).toBe("a\\\\\\%b");
  });

  it("returns empty string when input is entirely filter-syntax characters", () => {
    expect(sanitizeSearchTerm("(),")).toBe("");
  });

  it("leaves an empty string as empty", () => {
    expect(sanitizeSearchTerm("")).toBe("");
  });
});
