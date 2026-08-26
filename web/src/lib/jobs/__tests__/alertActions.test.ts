import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// exceptionActions.test.ts / scheduleActions.test.ts's matching comment.
vi.mock("server-only", () => ({}));

const { updateMock, eqMock, isMock, selectMock, fromMock } = vi.hoisted(() => {
  // Chainable fake for `.from("job_alerts").update(...).eq(...).is(...).select(...)`
  // — mirrors exceptionActions.test.ts's chainableQuery fake, but each
  // link is its own vi.fn() (rather than one shared builder object) so
  // individual call arguments can be asserted directly by name.
  const selectMock = vi.fn((_columns: string) =>
    Promise.resolve<{ data: unknown; error: unknown }>({ data: null, error: null }),
  );
  const isMock = vi.fn((_column: string, _value: unknown) => ({ select: selectMock }));
  const eqMock = vi.fn((_column: string, _value: unknown) => ({ is: isMock }));
  const updateMock = vi.fn((_payload: Record<string, unknown>) => ({ eq: eqMock }));
  const fromMock = vi.fn((_table: string) => ({ update: updateMock }));
  return { updateMock, eqMock, isMock, selectMock, fromMock };
});
const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(() => ({ from: fromMock })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { resolveJobAlert, type ResolveJobAlertInput } from "../alertActions";

beforeEach(() => {
  updateMock.mockClear();
  eqMock.mockClear();
  isMock.mockClear();
  selectMock.mockReset();
  fromMock.mockClear();
  createAdminClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_INPUT: ResolveJobAlertInput = {
  alertId: "11111111-1111-1111-1111-111111111111",
  note: "Invited the Slack bot to the crew channels",
  actorName: "Dane",
};

describe("resolveJobAlert — validation (no DB call)", () => {
  it("rejects a non-uuid alertId", async () => {
    await expect(
      resolveJobAlert({ ...VALID_INPUT, alertId: "not-a-uuid" }),
    ).rejects.toThrow(/invalid input/i);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects a blank note", async () => {
    await expect(resolveJobAlert({ ...VALID_INPUT, note: "   " })).rejects.toThrow(
      /invalid input/i,
    );
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects a blank actorName", async () => {
    await expect(
      resolveJobAlert({ ...VALID_INPUT, actorName: "" }),
    ).rejects.toThrow(/invalid input/i);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("resolveJobAlert — happy path", () => {
  it("updates job_alerts with resolved_at set, resolution_note = '[actorName] note', guarded by .is(resolved_at, null)", async () => {
    selectMock.mockResolvedValue({ data: [{ id: VALID_INPUT.alertId }], error: null });

    await resolveJobAlert(VALID_INPUT);

    expect(fromMock).toHaveBeenCalledWith("job_alerts");
    expect(updateMock).toHaveBeenCalledTimes(1);
    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload.resolution_note).toBe(
      "[Dane] Invited the Slack bot to the crew channels",
    );
    expect(typeof updatePayload.resolved_at).toBe("string");
    expect(Number.isNaN(Date.parse(updatePayload.resolved_at as string))).toBe(false);

    expect(eqMock).toHaveBeenCalledWith("id", VALID_INPUT.alertId);
    expect(isMock).toHaveBeenCalledWith("resolved_at", null);
    expect(selectMock).toHaveBeenCalledWith("id");
  });

  it("trims note and actorName before composing resolution_note", async () => {
    selectMock.mockResolvedValue({ data: [{ id: VALID_INPUT.alertId }], error: null });

    await resolveJobAlert({
      ...VALID_INPUT,
      note: "  false alarm  ",
      actorName: "  Jackson  ",
    });

    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload.resolution_note).toBe("[Jackson] false alarm");
  });

  it("resolves void and never sets resolved_by", async () => {
    selectMock.mockResolvedValue({ data: [{ id: VALID_INPUT.alertId }], error: null });

    const result = await resolveJobAlert(VALID_INPUT);

    expect(result).toBeUndefined();
    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload).not.toHaveProperty("resolved_by");
  });
});

describe("resolveJobAlert — failure paths", () => {
  it("throws 'alert not found or already resolved' when zero rows match", async () => {
    selectMock.mockResolvedValue({ data: [], error: null });

    await expect(resolveJobAlert(VALID_INPUT)).rejects.toThrow(
      "alert not found or already resolved",
    );
  });

  it("throws the same message when data is null", async () => {
    selectMock.mockResolvedValue({ data: null, error: null });

    await expect(resolveJobAlert(VALID_INPUT)).rejects.toThrow(
      "alert not found or already resolved",
    );
  });

  it("propagates a query error", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(resolveJobAlert(VALID_INPUT)).rejects.toThrow("permission denied");
  });
});
