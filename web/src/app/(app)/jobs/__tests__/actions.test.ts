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

// Same fake-typed-error-class pattern as ScheduleEstimateError above,
// but scheduleActions.ts/exceptionActions.ts/alertActions.ts all carry a
// top-level `import "server-only"` (unlike @/lib/jobs/types.ts, which
// does not) — so unlike ScheduleEstimateError, these three modules are
// fully mocked, and the classes actions.ts `instanceof`-checks against
// must come FROM the mock factory (via vi.hoisted) rather than the real
// module, or the instanceof check inside actions.ts would never match a
// rejection constructed in this test file.
const {
  cancelScheduledJobMock,
  CancelScheduledJobErrorMock,
  resolveDeletedCalendarEventMock,
  friendlyResolveErrorMessageMock,
  ResolveExceptionErrorMock,
  resolveJobAlertMock,
} = vi.hoisted(() => {
  class CancelScheduledJobErrorMock extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "CancelScheduledJobError";
      this.code = code;
    }
  }
  class ResolveExceptionErrorMock extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "ResolveExceptionError";
      this.code = code;
    }
  }
  return {
    cancelScheduledJobMock: vi.fn(),
    CancelScheduledJobErrorMock,
    resolveDeletedCalendarEventMock: vi.fn(),
    friendlyResolveErrorMessageMock: vi.fn(
      (code: string | undefined, message: string) => `friendly:${code}:${message}`,
    ),
    ResolveExceptionErrorMock,
    resolveJobAlertMock: vi.fn(),
  };
});
vi.mock("@/lib/jobs/scheduleActions", () => ({
  cancelScheduledJob: cancelScheduledJobMock,
  CancelScheduledJobError: CancelScheduledJobErrorMock,
}));
vi.mock("@/lib/jobs/exceptionActions", () => ({
  resolveDeletedCalendarEvent: resolveDeletedCalendarEventMock,
  friendlyResolveErrorMessage: friendlyResolveErrorMessageMock,
  ResolveExceptionError: ResolveExceptionErrorMock,
}));
vi.mock("@/lib/jobs/alertActions", () => ({
  resolveJobAlert: resolveJobAlertMock,
}));

// @/lib/ledger/repo (Task 3, Lane B) is mocked the same way @/lib/jobs/repo
// is above: the factory below supplies the implementation actions.ts calls,
// but Vitest still resolves the real module specifier even when it's
// mocked — the real repo.ts file must exist on disk for this mock to
// resolve at test time (mocking a module does not remove the requirement
// that it can be found).
const { createCostEntryMock, correctCostEntryMock, createRevenueEntryMock } = vi.hoisted(() => ({
  createCostEntryMock: vi.fn(),
  correctCostEntryMock: vi.fn(),
  createRevenueEntryMock: vi.fn(),
}));
vi.mock("@/lib/ledger/repo", () => ({
  createCostEntry: createCostEntryMock,
  correctCostEntry: correctCostEntryMock,
  createRevenueEntry: createRevenueEntryMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function importActions() {
  return import("../actions");
}

// `next/cache`'s mock factory (unlike the vi.hoisted() mocks above) is
// not re-created by vi.resetModules() — the SAME revalidatePath vi.fn()
// instance, and its accumulated call history, persists across every test
// in this file. Callers that assert on exact call args/count MUST
// `.mockClear()` the returned fn immediately before invoking the action
// under test.
async function importRevalidatePath() {
  const { revalidatePath } = await import("next/cache");
  return revalidatePath as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.resetModules();
  scheduleEstimateMock.mockReset();
  cancelScheduledJobMock.mockReset();
  resolveDeletedCalendarEventMock.mockReset();
  friendlyResolveErrorMessageMock.mockClear();
  resolveJobAlertMock.mockReset();
  createCostEntryMock.mockReset();
  correctCostEntryMock.mockReset();
  createRevenueEntryMock.mockReset();
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

// ============================================================
// cancelScheduledJobAction (v2 Task 6, Lane D)
// ============================================================

const CANCEL_INPUT = {
  jobNumber: "JOB-1105",
  resolution: "postponed" as const,
  reason: "Client asked to push a week",
};

describe("cancelScheduledJobAction — allowlist rejection", () => {
  it.each(INVALID_NAMES)(
    "rejects estimatorName=%j with a friendly error, without calling cancelScheduledJob",
    async (name) => {
      const { cancelScheduledJobAction } = await importActions();

      const result = await cancelScheduledJobAction(CANCEL_INPUT, name);

      expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
      expect(cancelScheduledJobMock).not.toHaveBeenCalled();
    },
  );
});

describe("cancelScheduledJobAction — success path", () => {
  it("forwards {...input, actorName} — actorName from the validated picker argument, never from input — and revalidates /jobs, the job route, and /estimates", async () => {
    const cancelledJob = { job_number: "JOB-1105", status_v2: "cancelled" };
    cancelScheduledJobMock.mockResolvedValue(cancelledJob);
    const { cancelScheduledJobAction } = await importActions();
    const revalidatePath = await importRevalidatePath();
    revalidatePath.mockClear();

    const result = await cancelScheduledJobAction(CANCEL_INPUT, "Dane");

    expect(cancelScheduledJobMock).toHaveBeenCalledWith({
      ...CANCEL_INPUT,
      actorName: "Dane",
    });
    expect(result).toEqual({ ok: true, job: cancelledJob });
    expect(revalidatePath).toHaveBeenCalledWith("/jobs");
    expect(revalidatePath).toHaveBeenCalledWith(`/jobs/${CANCEL_INPUT.jobNumber}`);
    expect(revalidatePath).toHaveBeenCalledWith("/estimates");
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });
});

describe("cancelScheduledJobAction — RPC error mapping", () => {
  it("surfaces a CancelScheduledJobError with its code and message", async () => {
    cancelScheduledJobMock.mockRejectedValue(
      new CancelScheduledJobErrorMock(
        "job JOB-1105 cannot be cancelled from status cancelled",
        "not_cancellable",
      ),
    );
    const { cancelScheduledJobAction } = await importActions();

    const result = await cancelScheduledJobAction(CANCEL_INPUT, "Dane");

    expect(result).toEqual({
      ok: false,
      error: "job JOB-1105 cannot be cancelled from status cancelled",
      code: "not_cancellable",
    });
  });

  it("surfaces a non-CancelScheduledJobError as a generic error message", async () => {
    cancelScheduledJobMock.mockRejectedValue(new Error("boom"));
    const { cancelScheduledJobAction } = await importActions();

    const result = await cancelScheduledJobAction(CANCEL_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

// ============================================================
// resolveExceptionAction (v2 Task 6, Lane D — folded in from the former
// exceptions/page.tsx inline action; same behavior, new location)
// ============================================================

const RESOLVE_EXCEPTION_INPUT = {
  exceptionId: "11111111-1111-1111-1111-111111111111",
  resolution: "dismiss" as const,
  reason: "False alarm — event still exists in another calendar view",
};

describe("resolveExceptionAction — allowlist rejection", () => {
  it.each(INVALID_NAMES)(
    "rejects estimatorName=%j with a friendly error, without calling resolveDeletedCalendarEvent",
    async (name) => {
      const { resolveExceptionAction } = await importActions();

      const result = await resolveExceptionAction(RESOLVE_EXCEPTION_INPUT, name);

      expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
      expect(resolveDeletedCalendarEventMock).not.toHaveBeenCalled();
    },
  );
});

describe("resolveExceptionAction — success path", () => {
  it("forwards {...input, actorName} and revalidates /jobs/exceptions", async () => {
    const resolved = {
      resolution: "dismiss",
      job_number: "JOB-1104",
      exception_id: RESOLVE_EXCEPTION_INPUT.exceptionId,
    };
    resolveDeletedCalendarEventMock.mockResolvedValue(resolved);
    const { resolveExceptionAction } = await importActions();
    const revalidatePath = await importRevalidatePath();
    revalidatePath.mockClear();

    const result = await resolveExceptionAction(RESOLVE_EXCEPTION_INPUT, "Jackson");

    expect(resolveDeletedCalendarEventMock).toHaveBeenCalledWith({
      ...RESOLVE_EXCEPTION_INPUT,
      actorName: "Jackson",
    });
    expect(result).toEqual({ ok: true, result: resolved });
    expect(revalidatePath).toHaveBeenCalledWith("/jobs/exceptions");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });
});

describe("resolveExceptionAction — RPC error mapping", () => {
  it("maps a ResolveExceptionError through friendlyResolveErrorMessage, not the raw message", async () => {
    resolveDeletedCalendarEventMock.mockRejectedValue(
      new ResolveExceptionErrorMock(
        "resolve_schedule_exception: exception X is not open (status dismissed)",
        "not_open",
      ),
    );
    const { resolveExceptionAction } = await importActions();

    const result = await resolveExceptionAction(RESOLVE_EXCEPTION_INPUT, "Dane");

    expect(friendlyResolveErrorMessageMock).toHaveBeenCalledWith(
      "not_open",
      "resolve_schedule_exception: exception X is not open (status dismissed)",
    );
    expect(result).toEqual({
      ok: false,
      error:
        "friendly:not_open:resolve_schedule_exception: exception X is not open (status dismissed)",
      code: "not_open",
    });
  });

  it("surfaces a non-ResolveExceptionError as a generic error message", async () => {
    resolveDeletedCalendarEventMock.mockRejectedValue(new Error("boom"));
    const { resolveExceptionAction } = await importActions();

    const result = await resolveExceptionAction(RESOLVE_EXCEPTION_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "boom" });
    expect(friendlyResolveErrorMessageMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// resolveJobAlertAction (v2 Task 6, Lane D)
// ============================================================

const ALERT_INPUT = {
  alertId: "22222222-2222-2222-2222-222222222222",
  note: "Invited the Slack bot to the crew channels",
};

describe("resolveJobAlertAction — allowlist rejection", () => {
  it.each(INVALID_NAMES)(
    "rejects estimatorName=%j with a friendly error, without calling resolveJobAlert",
    async (name) => {
      const { resolveJobAlertAction } = await importActions();

      const result = await resolveJobAlertAction(ALERT_INPUT, name);

      expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
      expect(resolveJobAlertMock).not.toHaveBeenCalled();
    },
  );
});

describe("resolveJobAlertAction — success path", () => {
  it("forwards { alertId, note, actorName: estimatorName } and revalidates /jobs only", async () => {
    resolveJobAlertMock.mockResolvedValue(undefined);
    const { resolveJobAlertAction } = await importActions();
    const revalidatePath = await importRevalidatePath();
    revalidatePath.mockClear();

    const result = await resolveJobAlertAction(ALERT_INPUT, "Matt");

    expect(resolveJobAlertMock).toHaveBeenCalledWith({
      alertId: ALERT_INPUT.alertId,
      note: ALERT_INPUT.note,
      actorName: "Matt",
    });
    expect(result).toEqual({ ok: true });
    // "revalidates /jobs ONLY" — an alertId carries no job number, so
    // there is no job-detail route to target (unlike
    // cancelScheduledJobAction's `/jobs/${jobNumber}` leg above).
    expect(revalidatePath).toHaveBeenCalledWith("/jobs");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });
});

describe("resolveJobAlertAction — error mapping", () => {
  it("surfaces a thrown Error's message with no code field", async () => {
    resolveJobAlertMock.mockRejectedValue(new Error("alert not found or already resolved"));
    const { resolveJobAlertAction } = await importActions();

    const result = await resolveJobAlertAction(ALERT_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "alert not found or already resolved" });
  });
});

// ============================================================
// createCostEntryAction / correctCostEntryAction / createRevenueEntryAction
// (v2 Task 7, Lane C)
// ============================================================

const COST_ENTRY_INPUT = {
  jobNumber: "JOB-1105",
  category: "dump" as const,
  state: "provisional" as const,
  amount: 450,
  quantity: 1,
  unitCost: 450,
  employeeName: null,
  vendorName: "ABC Disposal",
  incurredOn: "2026-08-20",
  note: "Load 1",
};

const COST_CORRECTION_INPUT = {
  entryId: "33333333-3333-3333-3333-333333333333",
  reason: "Fixed amount typo",
  patch: { amount: 475 },
};

const REVENUE_ENTRY_INPUT = {
  jobNumber: "JOB-1105",
  entryType: "invoice" as const,
  amount: 2000,
  occurredOn: "2026-08-20",
  note: "Invoice #123",
};

describe("createCostEntryAction — allowlist rejection", () => {
  it.each(INVALID_NAMES)(
    "rejects estimatorName=%j with a friendly error, without calling createCostEntry",
    async (name) => {
      const { createCostEntryAction } = await importActions();

      const result = await createCostEntryAction(COST_ENTRY_INPUT, name);

      expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
      expect(createCostEntryMock).not.toHaveBeenCalled();
    },
  );
});

describe("createCostEntryAction — input validation", () => {
  it("rejects a non-numeric amount before calling createCostEntry", async () => {
    const { createCostEntryAction } = await importActions();

    const result = await createCostEntryAction(
      { ...COST_ENTRY_INPUT, amount: "" },
      "Dane",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.length).toBeGreaterThan(0);
    }
    expect(createCostEntryMock).not.toHaveBeenCalled();
  });
});

describe("createCostEntryAction — success path", () => {
  it("forwards (validatedInput, actorName) and revalidates /jobs, the job route, and the costs sub-route", async () => {
    const row = { id: "cost-1", job_number: "JOB-1105", amount: 450 };
    createCostEntryMock.mockResolvedValue(row);
    const { createCostEntryAction } = await importActions();
    const revalidatePath = await importRevalidatePath();
    revalidatePath.mockClear();

    const result = await createCostEntryAction(COST_ENTRY_INPUT, "Dane");

    expect(createCostEntryMock).toHaveBeenCalledWith(COST_ENTRY_INPUT, "Dane");
    expect(result).toEqual({ ok: true, entry: row });
    expect(revalidatePath).toHaveBeenCalledWith("/jobs");
    expect(revalidatePath).toHaveBeenCalledWith("/jobs/JOB-1105");
    expect(revalidatePath).toHaveBeenCalledWith("/jobs/JOB-1105/costs");
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });
});

describe("createCostEntryAction — error mapping", () => {
  it("surfaces a LedgerError with its code and message", async () => {
    const { LedgerError } = await import("@/lib/ledger/types");
    createCostEntryMock.mockRejectedValue(new LedgerError("job JOB-1105 not found", "not_found"));
    const { createCostEntryAction } = await importActions();

    const result = await createCostEntryAction(COST_ENTRY_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "job JOB-1105 not found", code: "not_found" });
  });

  it("surfaces a non-LedgerError as a generic error message without a code", async () => {
    createCostEntryMock.mockRejectedValue(new Error("boom"));
    const { createCostEntryAction } = await importActions();

    const result = await createCostEntryAction(COST_ENTRY_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

describe("correctCostEntryAction — allowlist rejection", () => {
  it.each(INVALID_NAMES)(
    "rejects estimatorName=%j with a friendly error, without calling correctCostEntry",
    async (name) => {
      const { correctCostEntryAction } = await importActions();

      const result = await correctCostEntryAction(COST_CORRECTION_INPUT, name);

      expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
      expect(correctCostEntryMock).not.toHaveBeenCalled();
    },
  );
});

describe("correctCostEntryAction — input validation", () => {
  it("rejects an empty patch before calling correctCostEntry", async () => {
    const { correctCostEntryAction } = await importActions();

    const result = await correctCostEntryAction(
      { ...COST_CORRECTION_INPUT, patch: {} },
      "Dane",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.length).toBeGreaterThan(0);
    }
    expect(correctCostEntryMock).not.toHaveBeenCalled();
  });
});

describe("correctCostEntryAction — success path", () => {
  it("forwards (validatedInput, actorName) and revalidates using the RETURNED row's job_number, not any job number in the input", async () => {
    const row = { id: "cost-1", job_number: "JOB-1106", amount: 475 };
    correctCostEntryMock.mockResolvedValue(row);
    const { correctCostEntryAction } = await importActions();
    const revalidatePath = await importRevalidatePath();
    revalidatePath.mockClear();

    const result = await correctCostEntryAction(COST_CORRECTION_INPUT, "Dane");

    expect(correctCostEntryMock).toHaveBeenCalledWith(COST_CORRECTION_INPUT, "Dane");
    expect(result).toEqual({ ok: true, entry: row });
    expect(revalidatePath).toHaveBeenCalledWith("/jobs");
    expect(revalidatePath).toHaveBeenCalledWith("/jobs/JOB-1106");
    expect(revalidatePath).toHaveBeenCalledWith("/jobs/JOB-1106/costs");
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });
});

describe("correctCostEntryAction — error mapping", () => {
  it("surfaces a LedgerError with its code and message", async () => {
    const { LedgerError } = await import("@/lib/ledger/types");
    correctCostEntryMock.mockRejectedValue(
      new LedgerError(
        "correct_job_cost_entry: only manual entries can be corrected (entry cost-1 came from bill)",
        "not_correctable",
      ),
    );
    const { correctCostEntryAction } = await importActions();

    const result = await correctCostEntryAction(COST_CORRECTION_INPUT, "Dane");

    expect(result).toEqual({
      ok: false,
      error: "correct_job_cost_entry: only manual entries can be corrected (entry cost-1 came from bill)",
      code: "not_correctable",
    });
  });

  it("surfaces a non-LedgerError as a generic error message without a code", async () => {
    correctCostEntryMock.mockRejectedValue(new Error("boom"));
    const { correctCostEntryAction } = await importActions();

    const result = await correctCostEntryAction(COST_CORRECTION_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

describe("createRevenueEntryAction — allowlist rejection", () => {
  it.each(INVALID_NAMES)(
    "rejects estimatorName=%j with a friendly error, without calling createRevenueEntry",
    async (name) => {
      const { createRevenueEntryAction } = await importActions();

      const result = await createRevenueEntryAction(REVENUE_ENTRY_INPUT, name);

      expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
      expect(createRevenueEntryMock).not.toHaveBeenCalled();
    },
  );
});

describe("createRevenueEntryAction — input validation", () => {
  it("rejects a blank note before calling createRevenueEntry", async () => {
    const { createRevenueEntryAction } = await importActions();

    const result = await createRevenueEntryAction(
      { ...REVENUE_ENTRY_INPUT, note: "" },
      "Dane",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.length).toBeGreaterThan(0);
    }
    expect(createRevenueEntryMock).not.toHaveBeenCalled();
  });
});

describe("createRevenueEntryAction — success path", () => {
  it("forwards (validatedInput, actorName) and revalidates /jobs, the job route, and the revenue sub-route", async () => {
    const row = { id: "rev-1", job_number: "JOB-1105", amount: 2000 };
    createRevenueEntryMock.mockResolvedValue(row);
    const { createRevenueEntryAction } = await importActions();
    const revalidatePath = await importRevalidatePath();
    revalidatePath.mockClear();

    const result = await createRevenueEntryAction(REVENUE_ENTRY_INPUT, "Dane");

    expect(createRevenueEntryMock).toHaveBeenCalledWith(REVENUE_ENTRY_INPUT, "Dane");
    expect(result).toEqual({ ok: true, entry: row });
    expect(revalidatePath).toHaveBeenCalledWith("/jobs");
    expect(revalidatePath).toHaveBeenCalledWith("/jobs/JOB-1105");
    expect(revalidatePath).toHaveBeenCalledWith("/jobs/JOB-1105/revenue");
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });
});

describe("createRevenueEntryAction — error mapping", () => {
  it("surfaces a LedgerError with its code and message", async () => {
    const { LedgerError } = await import("@/lib/ledger/types");
    createRevenueEntryMock.mockRejectedValue(
      new LedgerError("job JOB-1105 not found", "not_found"),
    );
    const { createRevenueEntryAction } = await importActions();

    const result = await createRevenueEntryAction(REVENUE_ENTRY_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "job JOB-1105 not found", code: "not_found" });
  });

  it("surfaces a non-LedgerError as a generic error message without a code", async () => {
    createRevenueEntryMock.mockRejectedValue(new Error("boom"));
    const { createRevenueEntryAction } = await importActions();

    const result = await createRevenueEntryAction(REVENUE_ENTRY_INPUT, "Dane");

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});
