import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// scheduleActions.test.ts / repo.test.ts's matching comment.
vi.mock("server-only", () => ({}));

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(() => ({ rpc: rpcMock, from: fromMock })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import {
  classifyResolveError,
  friendlyResolveErrorMessage,
  listOpenScheduleExceptions,
  resolveDeletedCalendarEvent,
  ResolveExceptionError,
  type ResolveDeletedCalendarEventInput,
} from "../exceptionActions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  createAdminClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Fake query-builder for the .from("job_schedule_exceptions") chain ──
// Mirrors commercialLifecycle.test.ts's "chainable" fake — select/eq
// return the builder itself, order() is the terminal call and resolves
// to the queued result (the real call shape this module uses is exactly
// `.from(x).select(y).eq(z).order(w)`, nothing deeper).
function chainableQuery(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

const VALID_INPUT: ResolveDeletedCalendarEventInput = {
  exceptionId: "11111111-1111-1111-1111-111111111111",
  resolution: "dismiss",
  reason: "False alarm — event still exists in another calendar view",
  actorName: "Dane",
};

describe("classifyResolveError", () => {
  // Byte-pinned raise texts 1-8 from task-1-brief.md's
  // resolve_schedule_exception, plus cancel_scheduled_job's own
  // "cannot be cancelled" raise (reached via resolve_schedule_exception's
  // nested call for postponed/closed_lost).
  const cases: Array<[string, string]> = [
    ["resolve_schedule_exception: exception 11111111-... not found", "not_found"],
    [
      "resolve_schedule_exception: exception 11111111-... is not open (status rescheduled)",
      "not_open",
    ],
    ["resolve_schedule_exception: invalid resolution bogus", "invalid_input"],
    ["resolve_schedule_exception: resolution reason is required", "invalid_input"],
    [
      "resolve_schedule_exception: reschedule requires startDate and endDate",
      "invalid_input",
    ],
    [
      "resolve_schedule_exception: endDate (2026-09-01) must be on or after startDate (2026-09-05)",
      "invalid_input",
    ],
    ["resolve_schedule_exception: actor name is required", "invalid_input"],
    [
      "resolve_schedule_exception: job JOB-1104 is no longer scheduled (status cancelled)",
      "not_resolvable",
    ],
    ["job JOB-1104 cannot be cancelled from status accepted", "not_resolvable"],
  ];

  it.each(cases)("classifies %j as %s", (message, code) => {
    expect(classifyResolveError(message)).toBe(code);
  });

  it("is case-insensitive", () => {
    expect(
      classifyResolveError("RESOLVE_SCHEDULE_EXCEPTION: EXCEPTION X NOT FOUND"),
    ).toBe("not_found");
  });

  it("falls back to other for an unrecognized message", () => {
    expect(classifyResolveError("connection reset by peer")).toBe("other");
  });
});

// Fix round 1, review finding #1: the UI was rendering raw Postgres raise
// text; friendlyResolveErrorMessage maps each classified code to a
// human-readable message, falling back to the raw RPC message ONLY for
// "other"/undefined.
describe("friendlyResolveErrorMessage", () => {
  const RAW = "resolve_schedule_exception: exception 8f3a... is not open (status dismissed)";

  it.each([
    ["not_found" as const],
    ["not_open" as const],
    ["not_resolvable" as const],
    ["invalid_input" as const],
  ])("maps %s to a friendly message, not the raw text", (code) => {
    const message = friendlyResolveErrorMessage(code, RAW);
    expect(message).not.toBe(RAW);
    expect(message.length).toBeGreaterThan(0);
  });

  it("mentions refreshing for not_open — the stale-list case", () => {
    expect(friendlyResolveErrorMessage("not_open", RAW).toLowerCase()).toContain(
      "refreshing",
    );
  });

  it("falls back to the raw message for other", () => {
    expect(friendlyResolveErrorMessage("other", RAW)).toBe(RAW);
  });

  it("falls back to the raw message when code is undefined", () => {
    expect(friendlyResolveErrorMessage(undefined, RAW)).toBe(RAW);
  });
});

describe("resolveDeletedCalendarEvent — validation (no RPC call)", () => {
  it("rejects a non-UUID exceptionId", async () => {
    await expect(
      resolveDeletedCalendarEvent({ ...VALID_INPUT, exceptionId: "not-a-uuid" }),
    ).rejects.toMatchObject({ name: "ResolveExceptionError", code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank reason", async () => {
    await expect(
      resolveDeletedCalendarEvent({ ...VALID_INPUT, reason: "   " }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank actor name", async () => {
    await expect(
      resolveDeletedCalendarEvent({ ...VALID_INPUT, actorName: "" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown resolution", async () => {
    await expect(
      resolveDeletedCalendarEvent({
        ...VALID_INPUT,
        // @ts-expect-error — deliberately invalid for the test
        resolution: "ignore",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects reschedule with no dates at all", async () => {
    await expect(
      resolveDeletedCalendarEvent({
        ...VALID_INPUT,
        resolution: "reschedule",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects reschedule missing only endDate", async () => {
    await expect(
      resolveDeletedCalendarEvent({
        ...VALID_INPUT,
        resolution: "reschedule",
        startDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects reschedule with endDate before startDate", async () => {
    await expect(
      resolveDeletedCalendarEvent({
        ...VALID_INPUT,
        resolution: "reschedule",
        startDate: "2026-09-05",
        endDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not require dates for postponed/closed_lost/dismiss", async () => {
    rpcMock.mockResolvedValue({
      data: { resolution: "dismiss", job_number: "JOB-1104", exception_id: VALID_INPUT.exceptionId },
      error: null,
    });
    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).resolves.toBeDefined();
    expect(rpcMock).toHaveBeenCalled();
  });
});

describe("resolveDeletedCalendarEvent — happy path", () => {
  it("calls the RPC with the exact p_* args for reschedule and normalizes the row", async () => {
    rpcMock.mockResolvedValue({
      data: {
        resolution: "reschedule",
        job_number: "JOB-1104",
        exception_id: VALID_INPUT.exceptionId,
      },
      error: null,
    });

    const result = await resolveDeletedCalendarEvent({
      exceptionId: VALID_INPUT.exceptionId,
      resolution: "reschedule",
      reason: "Client wants a new window",
      actorName: "Jackson",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    });

    expect(rpcMock).toHaveBeenCalledWith("resolve_schedule_exception", {
      p_exception_id: VALID_INPUT.exceptionId,
      p_resolution: "reschedule",
      p_reason: "Client wants a new window",
      p_start_date: "2026-09-01",
      p_end_date: "2026-09-03",
      p_actor: null,
      p_actor_name: "Jackson",
    });
    expect(result).toEqual({
      resolution: "reschedule",
      job_number: "JOB-1104",
      exception_id: VALID_INPUT.exceptionId,
    });
  });

  it("passes null dates for postponed", async () => {
    rpcMock.mockResolvedValue({
      data: { resolution: "postponed", job_number: "JOB-1104", exception_id: VALID_INPUT.exceptionId },
      error: null,
    });

    await resolveDeletedCalendarEvent({
      ...VALID_INPUT,
      resolution: "postponed",
      reason: "Client asked to push it",
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "resolve_schedule_exception",
      expect.objectContaining({ p_start_date: null, p_end_date: null }),
    );
  });

  it("passes null dates for closed_lost", async () => {
    rpcMock.mockResolvedValue({
      data: { resolution: "closed_lost", job_number: "JOB-1104", exception_id: VALID_INPUT.exceptionId },
      error: null,
    });

    await resolveDeletedCalendarEvent({
      ...VALID_INPUT,
      resolution: "closed_lost",
      reason: "Went with another contractor",
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "resolve_schedule_exception",
      expect.objectContaining({ p_start_date: null, p_end_date: null }),
    );
  });

  it("trims reason and actorName before sending", async () => {
    rpcMock.mockResolvedValue({
      data: { resolution: "dismiss", job_number: "JOB-1104", exception_id: VALID_INPUT.exceptionId },
      error: null,
    });

    await resolveDeletedCalendarEvent({
      ...VALID_INPUT,
      reason: "  false alarm  ",
      actorName: "  Dane  ",
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "resolve_schedule_exception",
      expect.objectContaining({ p_reason: "false alarm", p_actor_name: "Dane" }),
    );
  });
});

describe("resolveDeletedCalendarEvent — RPC-level failures", () => {
  it("throws not_found when the RPC raises exception-not-found", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "resolve_schedule_exception: exception X not found" },
    });

    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).rejects.toMatchObject({
      name: "ResolveExceptionError",
      code: "not_found",
    });
  });

  it("throws not_open when the RPC raises exception-not-open", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "resolve_schedule_exception: exception X is not open (status dismissed)",
      },
    });

    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).rejects.toMatchObject({
      code: "not_open",
    });
  });

  it("throws not_resolvable when the job is no longer scheduled", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "resolve_schedule_exception: job JOB-1104 is no longer scheduled (status cancelled)",
      },
    });

    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).rejects.toMatchObject({
      code: "not_resolvable",
    });
  });

  it("throws not_resolvable when the nested cancel_scheduled_job call rejects the status", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "job JOB-1104 cannot be cancelled from status accepted" },
    });

    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).rejects.toMatchObject({
      code: "not_resolvable",
    });
  });

  it("throws other for an unrecognized RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset by peer" } });

    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).rejects.toMatchObject({
      name: "ResolveExceptionError",
      code: "other",
    });
  });

  it("throws other when the RPC returns no row and no error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).rejects.toBeInstanceOf(
      ResolveExceptionError,
    );
    await expect(resolveDeletedCalendarEvent(VALID_INPUT)).rejects.toMatchObject({
      code: "other",
    });
  });
});

describe("listOpenScheduleExceptions", () => {
  it("queries job_schedule_exceptions filtered to status=open, ordered opened_at desc, and normalizes rows", async () => {
    const query = chainableQuery({
      data: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          job_number: "JOB-1104",
          external_event_id: "evt-123",
          kind: "calendar_deleted",
          previous_schedule: {
            crew: "Crew 1",
            start_date: "2026-09-01",
            end_date: "2026-09-03",
            gcal_main_event_id: "main-1",
            gcal_crew_event_id: "crew-1",
          },
          opened_at: "2026-08-24T10:00:00Z",
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(query);

    const rows = await listOpenScheduleExceptions();

    expect(fromMock).toHaveBeenCalledWith("job_schedule_exceptions");
    expect(query.select).toHaveBeenCalledWith(
      "id, job_number, external_event_id, kind, previous_schedule, opened_at",
    );
    expect(query.eq).toHaveBeenCalledWith("status", "open");
    expect(query.order).toHaveBeenCalledWith("opened_at", { ascending: false });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      job_number: "JOB-1104",
      external_event_id: "evt-123",
      kind: "calendar_deleted",
      previous_schedule: {
        crew: "Crew 1",
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        gcal_main_event_id: "main-1",
        gcal_crew_event_id: "crew-1",
      },
      opened_at: "2026-08-24T10:00:00Z",
    });
  });

  it("returns an empty array when there are no open exceptions", async () => {
    fromMock.mockReturnValue(chainableQuery({ data: [], error: null }));
    const rows = await listOpenScheduleExceptions();
    expect(rows).toEqual([]);
  });

  it("returns an empty array when data is null", async () => {
    fromMock.mockReturnValue(chainableQuery({ data: null, error: null }));
    const rows = await listOpenScheduleExceptions();
    expect(rows).toEqual([]);
  });

  it("throws ResolveExceptionError on a query error", async () => {
    fromMock.mockReturnValue(
      chainableQuery({ data: null, error: { message: "permission denied" } }),
    );
    await expect(listOpenScheduleExceptions()).rejects.toBeInstanceOf(ResolveExceptionError);
  });
});
