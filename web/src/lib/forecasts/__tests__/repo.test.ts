import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// @/lib/jobs/__tests__/alertActions.test.ts's matching comment.
vi.mock("server-only", () => ({}));

const { insertMock, selectMock, singleMock, fromMock } = vi.hoisted(() => {
  // Chainable fake for `.from("job_forecast_overrides").insert(row).select(columns).single()`
  // — mirrors alertActions.test.ts's per-link vi.fn() style so individual
  // call arguments can be asserted directly by name.
  const singleMock = vi.fn(() => Promise.resolve<{ data: unknown; error: unknown }>({ data: null, error: null }));
  const selectMock = vi.fn((_columns: string) => {
    void _columns;
    return { single: singleMock };
  });
  const insertMock = vi.fn((_row: Record<string, unknown>) => {
    void _row;
    return { select: selectMock };
  });
  const fromMock = vi.fn((_table: string) => {
    void _table;
    return { insert: insertMock };
  });
  return { insertMock, selectMock, singleMock, fromMock };
});
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(() => ({ from: fromMock })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { createForecastOverride } from "../repo";
import type { ForecastOverrideInput } from "../types";

beforeEach(() => {
  insertMock.mockClear();
  selectMock.mockClear();
  singleMock.mockReset();
  fromMock.mockClear();
  createAdminClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ACTOR = { authUserId: "22222222-2222-2222-2222-222222222222", displayName: "Dane" };

const LABOR_INPUT: ForecastOverrideInput = {
  kind: "labor",
  jobNumber: "JOB-1108",
  remainingWorkdays: 3,
  expectedCrewSize: 4,
  hoursPerDay: 8,
  reason: "Crew size dropped to 4 for the rest of the job",
};

const CATEGORY_INPUT: ForecastOverrideInput = {
  kind: "category",
  jobNumber: "JOB-1108",
  category: "dump",
  expectedRemainingCost: 450,
  reason: "One more dump load expected",
};

describe("createForecastOverride", () => {
  it("maps a labor input to category null, the three labor columns set, expected_remaining_cost null, and actor attribution", async () => {
    singleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-3333-3333-333333333333",
        job_number: "JOB-1108",
        category: null,
        remaining_workdays: 3,
        expected_crew_size: 4,
        hours_per_day: 8,
        expected_remaining_cost: null,
        reason: LABOR_INPUT.reason,
        created_by_name: "Dane",
        created_at: "2026-08-27T00:00:00.000Z",
      },
      error: null,
    });

    await createForecastOverride(LABOR_INPUT, ACTOR);

    expect(fromMock).toHaveBeenCalledWith("job_forecast_overrides");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row).toMatchObject({
      job_number: "JOB-1108",
      category: null,
      remaining_workdays: 3,
      expected_crew_size: 4,
      hours_per_day: 8,
      expected_remaining_cost: null,
      reason: LABOR_INPUT.reason,
      created_by: ACTOR.authUserId,
      created_by_name: ACTOR.displayName,
    });
  });

  it("maps a category input to category + expected_remaining_cost set and all three labor columns null", async () => {
    singleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-4444-444444444444",
        job_number: "JOB-1108",
        category: "dump",
        remaining_workdays: null,
        expected_crew_size: null,
        hours_per_day: null,
        expected_remaining_cost: 450,
        reason: CATEGORY_INPUT.reason,
        created_by_name: "Dane",
        created_at: "2026-08-27T00:00:00.000Z",
      },
      error: null,
    });

    await createForecastOverride(CATEGORY_INPUT, ACTOR);

    const row = insertMock.mock.calls[0][0];
    expect(row).toMatchObject({
      job_number: "JOB-1108",
      category: "dump",
      remaining_workdays: null,
      expected_crew_size: null,
      hours_per_day: null,
      expected_remaining_cost: 450,
      reason: CATEGORY_INPUT.reason,
      created_by: ACTOR.authUserId,
      created_by_name: ACTOR.displayName,
    });
  });

  it("surfaces a Postgres 23503 FK error as ForecastOverrideError code unknown_job", async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { code: "23503", message: "insert or update on table \"job_forecast_overrides\" violates foreign key constraint" },
    });

    await expect(createForecastOverride(LABOR_INPUT, ACTOR)).rejects.toMatchObject({
      name: "ForecastOverrideError",
      code: "unknown_job",
    });
  });

  it("surfaces any other insert error as code insert_failed with the Postgres message preserved", async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "new row violates check constraint" },
    });

    await expect(createForecastOverride(LABOR_INPUT, ACTOR)).rejects.toMatchObject({
      name: "ForecastOverrideError",
      code: "insert_failed",
      message: "new row violates check constraint",
    });
  });
});
