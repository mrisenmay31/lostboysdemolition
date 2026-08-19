import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// @/lib/estimates/__tests__/commercialLifecycle.test.ts's matching comment.
vi.mock("server-only", () => ({}));

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(() => ({ rpc: rpcMock })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { classifyScheduleError, extractJobNumber, scheduleEstimate } from "../repo";
import { ScheduleEstimateError } from "../types";

beforeEach(() => {
  rpcMock.mockReset();
  createAdminClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyScheduleError", () => {
  // Real raise text from lane 4a's landed
  // supabase/migrations/20260819170000_schedule_estimate_rpc.sql — see
  // repo.ts's classifyScheduleError doc comment for the full mapping.
  describe("against the real schedule_estimate RPC's raise text", () => {
    it("classifies the missing-financial-details raise (underscored, not spaced)", () => {
      expect(
        classifyScheduleError(
          "schedule_estimate: estimate 0d5e2b9a-... has no estimate_financial_details row — cannot mint a budget",
        ),
      ).toBe("missing_financial_details");
    });

    it("classifies the already-has-job_number raise", () => {
      expect(
        classifyScheduleError(
          "schedule_estimate: estimate 0d5e2b9a-... already has job_number JOB-1104 set (linked outside schedule_estimate) — refusing to mint a second job",
        ),
      ).toBe("already_scheduled");
    });

    it("classifies the not-currently-accepted raise as not_accepted (covers never-accepted/reversed/superseded alike)", () => {
      expect(
        classifyScheduleError(
          "schedule_estimate: estimate 0d5e2b9a-... is not the currently accepted version of family 1426 — cannot schedule",
        ),
      ).toBe("not_accepted");
    });
  });

  it("classifies a superseded message (forward-compatible, not raised by the current RPC)", () => {
    expect(classifyScheduleError("estimate is superseded")).toBe("superseded");
  });

  it("classifies an already-scheduled family message", () => {
    expect(
      classifyScheduleError("an operational job already belongs to the estimate family"),
    ).toBe("already_scheduled");
  });

  it("classifies a job_number-not-null-style already-scheduled message", () => {
    expect(classifyScheduleError("this estimate is already scheduled as JOB-1234")).toBe(
      "already_scheduled",
    );
  });

  it("classifies a not-accepted message", () => {
    expect(
      classifyScheduleError("estimate is not the presented estimate referenced by the current accepted projection"),
    ).toBe("not_accepted");
  });

  it("classifies a reversed-acceptance message as not_accepted", () => {
    expect(classifyScheduleError("the latest acceptance event has been reversed")).toBe(
      "not_accepted",
    );
  });

  it("falls back to other for an unrecognized message", () => {
    expect(classifyScheduleError("connection reset by peer")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(classifyScheduleError("ESTIMATE IS SUPERSEDED")).toBe("superseded");
  });
});

describe("extractJobNumber", () => {
  it("extracts a JOB-XXXX token", () => {
    expect(extractJobNumber("already linked to JOB-1104")).toBe("JOB-1104");
  });

  it("uppercases a lowercase token", () => {
    expect(extractJobNumber("already linked to job-1104")).toBe("JOB-1104");
  });

  it("returns null when no token is present", () => {
    expect(extractJobNumber("no job number here")).toBeNull();
  });
});

const VALID_INPUT = {
  estimateId: "0d5e2b9a-1c3f-4a7e-9b2d-6f8a1c3e5d7b",
  crew: "Crew 1",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
};

describe("scheduleEstimate", () => {
  it("calls the RPC with the exact fixed signature and normalizes the returned row", async () => {
    rpcMock.mockResolvedValue({
      data: {
        job_number: "JOB-1200",
        status_v2: "scheduled",
        crew: "Crew 1",
        estimate_value: "2543.51",
        current_budget_version: "1",
      },
      error: null,
    });

    const job = await scheduleEstimate(VALID_INPUT, null, "Dane");

    expect(rpcMock).toHaveBeenCalledWith("schedule_estimate", {
      p_estimate_id: VALID_INPUT.estimateId,
      p_schedule: {
        crew: "Crew 1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      },
      p_actor: null,
      p_actor_name: "Dane",
    });
    expect(job.job_number).toBe("JOB-1200");
    expect(job.estimate_value).toBe(2543.51);
    expect(job.current_budget_version).toBe(1);
  });

  it("throws a typed ScheduleEstimateError on RPC failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "estimate is superseded" } });

    await expect(scheduleEstimate(VALID_INPUT, null, "Dane")).rejects.toMatchObject({
      name: "ScheduleEstimateError",
      code: "superseded",
    });
  });

  it("throws ScheduleEstimateError when the RPC returns no row and no error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(scheduleEstimate(VALID_INPUT, null, "Dane")).rejects.toBeInstanceOf(
      ScheduleEstimateError,
    );
  });

  it("carries jobNumber through when the error message names one", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "an operational job already belongs to the estimate family (JOB-1104)" },
    });

    await expect(scheduleEstimate(VALID_INPUT, null, "Dane")).rejects.toMatchObject({
      code: "already_scheduled",
      jobNumber: "JOB-1104",
    });
  });
});
