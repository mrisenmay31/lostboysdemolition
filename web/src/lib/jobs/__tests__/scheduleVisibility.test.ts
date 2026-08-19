import { describe, expect, it } from "vitest";
import { canScheduleThisVersion } from "../scheduleVisibility";
import type { EstimateAcceptanceStateRow } from "@/lib/estimates/types";

const ESTIMATE_ID = "0d5e2b9a-1c3f-4a7e-9b2d-6f8a1c3e5d7b";
const OTHER_ESTIMATE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function acceptedState(overrides: Partial<EstimateAcceptanceStateRow> = {}): EstimateAcceptanceStateRow {
  return {
    estimate_number: 1426,
    current_estimate_id: ESTIMATE_ID,
    accepted: true,
    current_acceptance_event_id: "evt-1",
    accepted_price: 2543.51,
    last_event_id: "evt-1",
    updated_at: "2026-08-19T00:00:00Z",
    ...overrides,
  };
}

describe("canScheduleThisVersion", () => {
  it("is true for the currently accepted version with no job_number", () => {
    expect(canScheduleThisVersion(acceptedState(), ESTIMATE_ID, null)).toBe(true);
  });

  it("is false once job_number is set, even though still accepted", () => {
    expect(canScheduleThisVersion(acceptedState(), ESTIMATE_ID, "JOB-1200")).toBe(false);
  });

  it("is false when there is no acceptance state at all", () => {
    expect(canScheduleThisVersion(null, ESTIMATE_ID, null)).toBe(false);
  });

  it("is false when the acceptance was reversed (accepted: false)", () => {
    expect(canScheduleThisVersion(acceptedState({ accepted: false }), ESTIMATE_ID, null)).toBe(
      false,
    );
  });

  it("is false for a version that isn't the one the acceptance points at", () => {
    expect(canScheduleThisVersion(acceptedState(), OTHER_ESTIMATE_ID, null)).toBe(false);
  });

  // FIX ROUND 1 regression pin (review finding #1, MAJOR/gating): the
  // CANONICAL accept-then-revise flow. Dane accepts v1 (estimate_number
  // 1426, id ESTIMATE_ID) — acceptance state now points at v1. Dane then
  // revises to v2 (a new estimate id, OTHER_ESTIMATE_ID) — acceptance
  // state is untouched by a revise (only record_estimate_acceptance_event
  // moves it), so it still names v1. v1's own `estimates.status` flips to
  // 'superseded' the instant v2 is created, but that column never enters
  // this function's inputs at all.
  it("stays true for the accepted version even after it becomes 'superseded' by a later revise (the bug this file fixes)", () => {
    // v1 (ESTIMATE_ID) is still what acceptance names, regardless of its
    // own `estimates.status` — this function's caller (page.tsx) must not
    // gate the call on `canRevise`/`status`, which is exactly what the
    // fix-round finding was.
    const state = acceptedState({ current_estimate_id: ESTIMATE_ID });
    expect(canScheduleThisVersion(state, ESTIMATE_ID, null)).toBe(true);
    // v2 (the new latest version) is correctly NOT schedulable — the
    // acceptance never moved to it.
    expect(canScheduleThisVersion(state, OTHER_ESTIMATE_ID, null)).toBe(false);
  });
});
