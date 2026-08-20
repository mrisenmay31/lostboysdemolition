import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// repo.test.ts / @/lib/estimates/__tests__/commercialLifecycle.test.ts.
vi.mock("server-only", () => ({}));

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(() => ({ rpc: rpcMock })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import {
  cancelScheduledJob,
  CancelScheduledJobError,
  classifyCancelError,
  type CancelScheduledJobInput,
} from "../scheduleActions";

beforeEach(() => {
  rpcMock.mockReset();
  createAdminClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_INPUT: CancelScheduledJobInput = {
  jobNumber: "JOB-1104",
  resolution: "postponed",
  reason: "Client asked to push a week",
  actorName: "Dane",
};

describe("classifyCancelError", () => {
  // Byte-pinned raise texts from task5-sql-brief.md's cancel_scheduled_job
  // (a sibling SQL lane's RPC) — table-driven per the brief's classification
  // table.
  const cases: Array<[string, string]> = [
    ["actor name is required", "invalid_input"],
    ["invalid resolution: bogus", "invalid_input"],
    ["cancellation reason is required", "invalid_input"],
    ["no job found for JOB-9999", "not_found"],
    ["job JOB-1104 cannot be cancelled from status accepted", "not_cancellable"],
  ];

  it.each(cases)("classifies %j as %s", (message, code) => {
    expect(classifyCancelError(message)).toBe(code);
  });

  it("is case-insensitive", () => {
    expect(classifyCancelError("NO JOB FOUND FOR JOB-9999")).toBe("not_found");
  });

  it("falls back to other for an unrecognized message", () => {
    expect(classifyCancelError("connection reset by peer")).toBe("other");
  });
});

describe("cancelScheduledJob — validation (no RPC call)", () => {
  it("rejects a malformed job number", async () => {
    await expect(
      cancelScheduledJob({ ...VALID_INPUT, jobNumber: "1104" }),
    ).rejects.toMatchObject({ name: "CancelScheduledJobError", code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a job number missing the JOB- prefix's digits", async () => {
    await expect(
      cancelScheduledJob({ ...VALID_INPUT, jobNumber: "JOB-" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank reason", async () => {
    await expect(
      cancelScheduledJob({ ...VALID_INPUT, reason: "   " }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank actor name", async () => {
    await expect(
      cancelScheduledJob({ ...VALID_INPUT, actorName: "" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid resolution", async () => {
    await expect(
      cancelScheduledJob({
        ...VALID_INPUT,
        // @ts-expect-error — deliberately invalid for the test
        resolution: "declined",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("cancelScheduledJob — happy path", () => {
  it("calls the RPC with the exact p_* args for postponed (p_actor null) and normalizes the row", async () => {
    rpcMock.mockResolvedValue({
      data: {
        job_number: "JOB-1104",
        status_v2: "cancelled",
        cancelled_at: "2026-08-20T12:00:00Z",
        cancellation_reason: "Client asked to push a week",
        crew: "Crew 1",
        start_date: "2026-09-01",
        end_date: "2026-09-03",
      },
      error: null,
    });

    const job = await cancelScheduledJob(VALID_INPUT);

    expect(rpcMock).toHaveBeenCalledWith("cancel_scheduled_job", {
      p_job_number: "JOB-1104",
      p_resolution: "postponed",
      p_reason: "Client asked to push a week",
      p_actor: null,
      p_actor_name: "Dane",
    });
    expect(job.job_number).toBe("JOB-1104");
    expect(job.status_v2).toBe("cancelled");
    expect(job.cancellation_reason).toBe("Client asked to push a week");
  });

  it("calls the RPC with resolution closed_lost", async () => {
    rpcMock.mockResolvedValue({
      data: {
        job_number: "JOB-1104",
        status_v2: "cancelled",
        cancelled_at: "2026-08-20T12:00:00Z",
        cancellation_reason: "Customer went with another contractor",
        crew: "Crew 2",
        start_date: "2026-09-01",
        end_date: "2026-09-03",
      },
      error: null,
    });

    const job = await cancelScheduledJob({
      ...VALID_INPUT,
      resolution: "closed_lost",
      reason: "Customer went with another contractor",
    });

    expect(rpcMock).toHaveBeenCalledWith("cancel_scheduled_job", {
      p_job_number: "JOB-1104",
      p_resolution: "closed_lost",
      p_reason: "Customer went with another contractor",
      p_actor: null,
      p_actor_name: "Dane",
    });
    expect(job.cancellation_reason).toBe("Customer went with another contractor");
  });

  it("trims reason and actorName before sending", async () => {
    rpcMock.mockResolvedValue({
      data: {
        job_number: "JOB-1104",
        status_v2: "cancelled",
        cancelled_at: "2026-08-20T12:00:00Z",
        cancellation_reason: "trimmed reason",
        crew: null,
        start_date: null,
        end_date: null,
      },
      error: null,
    });

    await cancelScheduledJob({
      ...VALID_INPUT,
      reason: "  trimmed reason  ",
      actorName: "  Dane  ",
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "cancel_scheduled_job",
      expect.objectContaining({ p_reason: "trimmed reason", p_actor_name: "Dane" }),
    );
  });
});

describe("cancelScheduledJob — RPC-level failures", () => {
  it("throws not_found when the RPC raises no-job-found", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "no job found for JOB-9999" },
    });

    await expect(
      cancelScheduledJob({ ...VALID_INPUT, jobNumber: "JOB-9999" }),
    ).rejects.toMatchObject({ name: "CancelScheduledJobError", code: "not_found" });
  });

  it("throws not_cancellable when the RPC raises wrong-status", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "job JOB-1104 cannot be cancelled from status accepted" },
    });

    await expect(cancelScheduledJob(VALID_INPUT)).rejects.toMatchObject({
      code: "not_cancellable",
    });
  });

  it("throws other for an unrecognized RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset by peer" } });

    await expect(cancelScheduledJob(VALID_INPUT)).rejects.toMatchObject({
      name: "CancelScheduledJobError",
      code: "other",
    });
  });

  it("throws other when the RPC returns no row and no error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(cancelScheduledJob(VALID_INPUT)).rejects.toBeInstanceOf(
      CancelScheduledJobError,
    );
    await expect(cancelScheduledJob(VALID_INPUT)).rejects.toMatchObject({ code: "other" });
  });
});
