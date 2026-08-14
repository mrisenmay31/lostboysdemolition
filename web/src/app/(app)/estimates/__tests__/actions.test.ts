import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// actions.test.ts — review finding I-2(b): the allowlist trust boundary
// (resolveActor inside actions.ts) has no rejection tests. These prove
// that a mutating server action refuses an invalid estimatorName BEFORE
// ever calling into the data layer — i.e. the repo functions below are
// never invoked for "dane" (wrong case), "" (empty), or "Bob" (not on the
// roster).
//
// The whole @/lib/estimates/repo module is mocked (same vi.hoisted +
// vi.mock pattern rates.test.ts uses for @/lib/supabase/admin), so the
// real repo.ts — and its `import "server-only"` — never loads under test.
// BUT actions.ts (Task 11b) also has a static top-level
// `import { pushEstimateToGhl } from "@/lib/ghl/push"`, and push.ts's own
// first line is `import "server-only"` — that one IS unmocked here (this
// file never touches pushEstimateAction), so importing "../actions" at
// all still pulls in the real server-only package. vitest runs in a
// plain Node environment (no "react-server" export condition), so the
// real package throws on import outside a Server Component — same
// condition client.test.ts/log.test.ts/rates.test.ts/estimateDoc.test.ts
// stub for. Match that precedent.
vi.mock("server-only", () => ({}));

const {
  createEstimateMock,
  createNewVersionMock,
  updateStatusMock,
  updateQuoteMock,
} = vi.hoisted(() => ({
  createEstimateMock: vi.fn(),
  createNewVersionMock: vi.fn(),
  updateStatusMock: vi.fn(),
  updateQuoteMock: vi.fn(),
}));

class FakeEstimateValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.name = "EstimateValidationError";
    this.errors = errors;
  }
}

vi.mock("@/lib/estimates/repo", () => ({
  EstimateValidationError: FakeEstimateValidationError,
  createEstimate: createEstimateMock,
  createNewVersion: createNewVersionMock,
  updateStatus: updateStatusMock,
  updateQuote: updateQuoteMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function importActions() {
  return import("../actions");
}

beforeEach(() => {
  vi.resetModules();
  createEstimateMock.mockReset();
  createNewVersionMock.mockReset();
  updateStatusMock.mockReset();
  updateQuoteMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const INVALID_NAMES = ["dane", "", "Bob"];

describe("createEstimateAction — allowlist rejection (review finding I-2b)", () => {
  it.each(INVALID_NAMES)("rejects estimatorName=%j with a friendly error, without calling the repo", async (name) => {
    const { createEstimateAction } = await importActions();

    const result = await createEstimateAction({ some: "draft" }, name);

    expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
    expect(createEstimateMock).not.toHaveBeenCalled();
  });

  it("does call the repo for a valid estimator (control case, proves the mock wiring works)", async () => {
    createEstimateMock.mockResolvedValue({ id: "est-1" });
    const { createEstimateAction } = await importActions();

    const result = await createEstimateAction({ some: "draft" }, "Dane");

    expect(result.ok).toBe(true);
    expect(createEstimateMock).toHaveBeenCalledTimes(1);
    expect(createEstimateMock).toHaveBeenCalledWith({ some: "draft" }, { id: null, name: "Dane" });
  });
});

describe("newVersionAction — allowlist rejection (review finding I-2b)", () => {
  it.each(INVALID_NAMES)("rejects estimatorName=%j without calling the repo", async (name) => {
    const { newVersionAction } = await importActions();

    const result = await newVersionAction("parent-1", { some: "draft" }, name);

    expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
    expect(createNewVersionMock).not.toHaveBeenCalled();
  });
});

describe("updateStatusAction — allowlist rejection (review finding I-2b)", () => {
  it.each(INVALID_NAMES)("rejects estimatorName=%j without calling the repo", async (name) => {
    const { updateStatusAction } = await importActions();

    const result = await updateStatusAction("est-1", "sent", name);

    expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
    expect(updateStatusMock).not.toHaveBeenCalled();
  });
});

describe("updateQuoteAction — allowlist rejection (review finding I-2b)", () => {
  it.each(INVALID_NAMES)("rejects estimatorName=%j without calling the repo", async (name) => {
    const { updateQuoteAction } = await importActions();

    const result = await updateQuoteAction("est-1", 1000, "reason", name);

    expect(result).toEqual({ ok: false, error: "Pick who's estimating first." });
    expect(updateQuoteMock).not.toHaveBeenCalled();
  });
});
