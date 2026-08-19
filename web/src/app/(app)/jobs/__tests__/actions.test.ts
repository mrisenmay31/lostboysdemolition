import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every server-action test in this repo uses —
// see @/app/(app)/estimates/__tests__/actions.test.ts's matching comment.
// jobs/actions.ts imports @/lib/jobs/repo, which carries a top-level
// `import "server-only"` — mocking the module below means the real
// repo.ts (and its server-only tag) never loads, but keep the stub for
// parity/defense-in-depth with the house pattern.
vi.mock("server-only", () => ({}));

const { scheduleEstimateMock } = vi.hoisted(() => ({
  scheduleEstimateMock: vi.fn(),
}));
vi.mock("@/lib/jobs/repo", () => ({
  scheduleEstimate: scheduleEstimateMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function importActions() {
  return import("../actions");
}

beforeEach(() => {
  vi.resetModules();
  scheduleEstimateMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_INPUT = {
  estimateId: "0d5e2b9a-1c3f-4a7e-9b2d-6f8a1c3e5d7b",
  crew: "Crew 1",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
};

const INVALID_NAMES = ["dane", "", "Bob"];

describe("scheduleEstimateAction — allowlist rejection", () => {
  it.each(INVALID_NAMES)(
    "rejects estimatorName=%j with a friendly error, without calling the repo",
    async (name) => {
      const { scheduleEstimateAction } = await importActions();

      const result = await scheduleEstimateAction(VALID_INPUT, name);

      expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
      expect(scheduleEstimateMock).not.toHaveBeenCalled();
    },
  );
});

describe("scheduleEstimateAction — input validation", () => {
  it("rejects malformed input before calling the repo", async () => {
    const { scheduleEstimateAction } = await importActions();

    const result = await scheduleEstimateAction({ ...VALID_INPUT, crew: "" }, "Dane");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("crew");
      expect(result.fieldErrors?.length).toBeGreaterThan(0);
    }
    expect(scheduleEstimateMock).not.toHaveBeenCalled();
  });

  it("rejects endDate before startDate before calling the repo", async () => {
    const { scheduleEstimateAction } = await importActions();

    const result = await scheduleEstimateAction(
      { ...VALID_INPUT, startDate: "2026-09-05", endDate: "2026-09-01" },
      "Dane",
    );

    expect(result.ok).toBe(false);
    expect(scheduleEstimateMock).not.toHaveBeenCalled();
  });
});

describe("scheduleEstimateAction — success path", () => {
  it("calls the repo with p_actor=null semantics (actor id null, actor name = picker name) and returns the job", async () => {
    const jobRow = { job_number: "JOB-1200", status_v2: "scheduled" };
    scheduleEstimateMock.mockResolvedValue(jobRow);
    const { scheduleEstimateAction } = await importActions();

    const result = await scheduleEstimateAction(VALID_INPUT, "Dane");

    expect(scheduleEstimateMock).toHaveBeenCalledWith(VALID_INPUT, null, "Dane");
    expect(result).toEqual({ ok: true, job: jobRow });
  });

  it("does call the repo for a valid estimator (control case, proves the mock wiring works)", async () => {
    scheduleEstimateMock.mockResolvedValue({ job_number: "JOB-1201" });
    const { scheduleEstimateAction } = await importActions();

    await scheduleEstimateAction(VALID_INPUT, "Jackson");

    expect(scheduleEstimateMock).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleEstimateAction — RPC error mapping", () => {
  // jobs/actions.ts imports the REAL ScheduleEstimateError class from
  // @/lib/jobs/types (a plain, un-mocked module — types.ts has no
  // "server-only" tag and no Supabase import) to `instanceof`-check
  // against. Using the real class here (not a fake) is therefore
  // required for the `instanceof` branch in actions.ts to take effect —
  // unlike repo.ts, which IS mocked above.
  it.each([
    ["not_accepted", "estimate is not the currently accepted version"],
    ["superseded", "estimate is superseded"],
    ["missing_financial_details", "financial details do not exist"],
    ["other", "connection reset by peer"],
  ] as const)("surfaces a %s ScheduleEstimateError with its code and message", async (code, message) => {
    const { ScheduleEstimateError } = await import("@/lib/jobs/types");
    scheduleEstimateMock.mockRejectedValue(new ScheduleEstimateError(message, code));
    const { scheduleEstimateAction } = await importActions();

    const result = await scheduleEstimateAction(VALID_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: message, code, jobNumber: null });
  });

  it("surfaces already_scheduled with the recovered jobNumber", async () => {
    const { ScheduleEstimateError } = await import("@/lib/jobs/types");
    scheduleEstimateMock.mockRejectedValue(
      new ScheduleEstimateError("already linked to JOB-1104", "already_scheduled", "JOB-1104"),
    );
    const { scheduleEstimateAction } = await importActions();

    const result = await scheduleEstimateAction(VALID_INPUT, "Dane");

    expect(result).toEqual({
      ok: false,
      error: "already linked to JOB-1104",
      code: "already_scheduled",
      jobNumber: "JOB-1104",
    });
  });

  it("surfaces a non-ScheduleEstimateError as a generic error message", async () => {
    scheduleEstimateMock.mockRejectedValue(new Error("boom"));
    const { scheduleEstimateAction } = await importActions();

    const result = await scheduleEstimateAction(VALID_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});
