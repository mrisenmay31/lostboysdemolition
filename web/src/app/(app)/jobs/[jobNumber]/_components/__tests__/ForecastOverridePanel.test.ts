import { describe, expect, it, vi } from "vitest";

// Same "server-only" stub every server-action test in this repo uses —
// see @/app/(app)/jobs/__tests__/actions.test.ts's matching comment.
// ForecastOverridePanel.tsx imports createForecastOverrideAction from
// ../../actions, which transitively pulls in server-only-tagged modules
// (@/lib/workforce/profile, @/lib/jobs/healthRepo, etc.) — mocking the
// marker package here means those modules load without throwing, the
// same way the house server-action tests handle it.
vi.mock("server-only", () => ({}));

import {
  buildOverrideSubmission,
  formatProfitDelta,
} from "../ForecastOverridePanel";

describe("buildOverrideSubmission", () => {
  it("builds a labor submission from form strings", () => {
    expect(
      buildOverrideSubmission("labor", "JOB-1108", {
        remainingWorkdays: "3",
        expectedCrewSize: "4",
        hoursPerDay: "8",
        category: "",
        expectedRemainingCost: "",
        reason: "Crew pulled",
      }),
    ).toEqual({
      kind: "labor",
      jobNumber: "JOB-1108",
      remainingWorkdays: 3,
      expectedCrewSize: 4,
      hoursPerDay: 8,
      reason: "Crew pulled",
    });
  });

  it("maps empty numeric strings to undefined, never 0 (empty-string carry)", () => {
    const built = buildOverrideSubmission("labor", "JOB-1108", {
      remainingWorkdays: "",
      expectedCrewSize: "4",
      hoursPerDay: "8",
      category: "",
      expectedRemainingCost: "",
      reason: "x",
    });
    expect((built as Record<string, unknown>).remainingWorkdays).toBeUndefined();
  });

  it("builds a category submission", () => {
    expect(
      buildOverrideSubmission("category", "JOB-1108", {
        remainingWorkdays: "",
        expectedCrewSize: "",
        hoursPerDay: "",
        category: "dump",
        expectedRemainingCost: "130",
        reason: "Two more loads",
      }),
    ).toEqual({
      kind: "category",
      jobNumber: "JOB-1108",
      category: "dump",
      expectedRemainingCost: 130,
      reason: "Two more loads",
    });
  });
});

describe("formatProfitDelta", () => {
  it("formats a signed delta", () => {
    expect(formatProfitDelta(1000, 750)).toBe("-$250.00");
    expect(formatProfitDelta(750, 1000)).toBe("+$250.00");
  });
  it("returns null when either side is unknown", () => {
    expect(formatProfitDelta(null, 750)).toBeNull();
    expect(formatProfitDelta(750, null)).toBeNull();
  });
  it("formats a zero delta without sign", () => {
    expect(formatProfitDelta(500, 500)).toBe("$0.00");
  });
});
