import { describe, expect, it } from "vitest";
import { validateScheduleEstimateInput } from "../validate";

const VALID_ID = "0d5e2b9a-1c3f-4a7e-9b2d-6f8a1c3e5d7b";

function base(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    estimateId: VALID_ID,
    crew: "Crew 1",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    ...overrides,
  };
}

describe("validateScheduleEstimateInput", () => {
  it("accepts a well-formed input", () => {
    const result = validateScheduleEstimateInput(base());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        estimateId: VALID_ID,
        crew: "Crew 1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      });
    }
  });

  it("accepts a single-day job (endDate === startDate)", () => {
    const result = validateScheduleEstimateInput(
      base({ startDate: "2026-09-01", endDate: "2026-09-01" }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a real leap-day date (2028-02-29)", () => {
    const result = validateScheduleEstimateInput(
      base({ startDate: "2028-02-28", endDate: "2028-02-29" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a non-leap-year Feb 29 (2027-02-29 does not exist)", () => {
    const result = validateScheduleEstimateInput(base({ endDate: "2027-02-29" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith("endDate:"))).toBe(true);
    }
  });

  it("rejects Feb 30 (does not exist in any year)", () => {
    const result = validateScheduleEstimateInput(base({ endDate: "2026-02-30" }));
    expect(result.success).toBe(false);
  });

  it("rejects month 13", () => {
    const result = validateScheduleEstimateInput(base({ startDate: "2026-13-01" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith("startDate:"))).toBe(true);
    }
  });

  it("rejects month 00", () => {
    const result = validateScheduleEstimateInput(base({ startDate: "2026-00-15" }));
    expect(result.success).toBe(false);
  });

  it("rejects day 00", () => {
    const result = validateScheduleEstimateInput(base({ startDate: "2026-05-00" }));
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date string (not YYYY-MM-DD)", () => {
    const result = validateScheduleEstimateInput(base({ startDate: "09/01/2026" }));
    expect(result.success).toBe(false);
  });

  it("rejects an ISO datetime instead of a bare date", () => {
    const result = validateScheduleEstimateInput(base({ startDate: "2026-09-01T00:00:00Z" }));
    expect(result.success).toBe(false);
  });

  it("rejects endDate before startDate", () => {
    const result = validateScheduleEstimateInput(
      base({ startDate: "2026-09-05", endDate: "2026-09-01" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith("endDate:"))).toBe(true);
    }
  });

  it("rejects a blank crew", () => {
    const result = validateScheduleEstimateInput(base({ crew: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith("crew:"))).toBe(true);
    }
  });

  it("rejects a whitespace-only crew", () => {
    const result = validateScheduleEstimateInput(base({ crew: "   " }));
    expect(result.success).toBe(false);
  });

  it("trims crew whitespace on success", () => {
    const result = validateScheduleEstimateInput(base({ crew: "  Crew 2  " }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crew).toBe("Crew 2");
    }
  });

  // Fix round 1 (review finding #2, MINOR/trust boundary): crew is now a
  // CLOSED set enforced server-side (z.enum via the shared
  // @/lib/jobs/crews.ts CREW_OPTIONS), not merely "any nonblank string".
  // A network-open, no-login deployment means these are real inputs a
  // crafted request could send, not just hypothetical form bypasses.
  it("rejects a nonblank crew that isn't one of the four operational crews", () => {
    const result = validateScheduleEstimateInput(base({ crew: "whatever" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith("crew:"))).toBe(true);
    }
  });

  it("rejects the legacy Airtable-era crew values ('Jackson'/'Other') — not in the closed set by design", () => {
    expect(validateScheduleEstimateInput(base({ crew: "Jackson" })).success).toBe(false);
    expect(validateScheduleEstimateInput(base({ crew: "Other" })).success).toBe(false);
  });

  it("rejects a crew value that differs from a valid option only in case", () => {
    const result = validateScheduleEstimateInput(base({ crew: "crew 1" }));
    expect(result.success).toBe(false);
  });

  it("rejects a fifth/out-of-range crew number", () => {
    const result = validateScheduleEstimateInput(base({ crew: "Crew 5" }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID estimateId", () => {
    const result = validateScheduleEstimateInput(base({ estimateId: "not-a-uuid" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith("estimateId:"))).toBe(true);
    }
  });

  it("rejects a missing estimateId", () => {
    const input: Record<string, unknown> = base();
    delete input.estimateId;
    const result = validateScheduleEstimateInput(input);
    expect(result.success).toBe(false);
  });

  it("rejects entirely malformed input (not an object)", () => {
    const result = validateScheduleEstimateInput("nope");
    expect(result.success).toBe(false);
  });

  it("rejects a non-string crew", () => {
    const result = validateScheduleEstimateInput(base({ crew: 123 }));
    expect(result.success).toBe(false);
  });
});
