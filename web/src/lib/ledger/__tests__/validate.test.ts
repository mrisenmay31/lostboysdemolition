// ============================================================
// Lost Boys Demolition — web app — manual ledger validation tests
// (Profitability v2 Task 7, Lane A)
// ============================================================

import { describe, expect, it } from "vitest";
import {
  validateCostCorrectionInput,
  validateCostEntryInput,
  validateRevenueEntryInput,
} from "../validate";

const VALID_ENTRY_ID = "0d5e2b9a-1c3f-4a7e-9b2d-6f8a1c3e5d7b";

const validCost = {
  jobNumber: "JOB-1107",
  category: "direct_labor",
  state: "approved",
  amount: 460,
  quantity: 20,
  unitCost: 23,
  employeeName: "Nick",
  vendorName: null,
  incurredOn: "2026-08-20",
  note: "week 1 crew hours",
};

function costOverrides(overrides: Partial<Record<string, unknown>> = {}) {
  return { ...validCost, ...overrides };
}

describe("validateCostEntryInput", () => {
  it("accepts a well-formed input", () => {
    const result = validateCostEntryInput(costOverrides());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validCost);
    }
  });

  it("trims jobNumber", () => {
    const result = validateCostEntryInput(costOverrides({ jobNumber: " JOB-1107 " }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobNumber).toBe("JOB-1107");
    }
  });

  it("converts blank-after-trim employeeName/vendorName/note to null", () => {
    const result = validateCostEntryInput(
      costOverrides({ employeeName: "  ", vendorName: "   ", note: "  " }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.employeeName).toBeNull();
      expect(result.data.vendorName).toBeNull();
      expect(result.data.note).toBeNull();
    }
  });

  it("rejects amount as an empty string (no coercion)", () => {
    const result = validateCostEntryInput(costOverrides({ amount: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount");
    }
  });

  it("rejects amount as a numeric string (no coercion)", () => {
    const result = validateCostEntryInput(costOverrides({ amount: "460" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount");
    }
  });

  it("rejects amount as NaN", () => {
    const result = validateCostEntryInput(costOverrides({ amount: NaN }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount");
    }
  });

  it("rejects amount as Infinity", () => {
    const result = validateCostEntryInput(costOverrides({ amount: Infinity }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount");
    }
  });

  it("rejects amount 0 (must be positive)", () => {
    const result = validateCostEntryInput(costOverrides({ amount: 0 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount must be a positive number");
    }
  });

  it("rejects a negative amount", () => {
    const result = validateCostEntryInput(costOverrides({ amount: -5 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount must be a positive number");
    }
  });

  it("rejects quantity 0", () => {
    const result = validateCostEntryInput(costOverrides({ quantity: 0 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("quantity");
    }
  });

  it("accepts quantity null", () => {
    const result = validateCostEntryInput(costOverrides({ quantity: null }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBeNull();
    }
  });

  it("rejects unitCost -1", () => {
    const result = validateCostEntryInput(costOverrides({ unitCost: -1 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("unitCost");
    }
  });

  it("accepts unitCost 0", () => {
    const result = validateCostEntryInput(costOverrides({ unitCost: 0 }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitCost).toBe(0);
    }
  });

  it("rejects state 'void' on create (closed enum excludes it)", () => {
    const result = validateCostEntryInput(costOverrides({ state: "void" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("state");
    }
  });

  it("rejects a category that is not a cost_category", () => {
    const result = validateCostEntryInput(costOverrides({ category: "overhead" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("category");
    }
  });

  it("rejects jobNumber '1107' (missing JOB- prefix)", () => {
    const result = validateCostEntryInput(costOverrides({ jobNumber: "1107" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("jobNumber");
    }
  });

  it("rejects jobNumber 'JOB-' (missing digits)", () => {
    const result = validateCostEntryInput(costOverrides({ jobNumber: "JOB-" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("jobNumber");
    }
  });

  it("rejects incurredOn '2026-02-30' (not a real calendar date)", () => {
    const result = validateCostEntryInput(costOverrides({ incurredOn: "2026-02-30" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("incurredOn");
    }
  });

  it("rejects incurredOn '08/20/2026' (wrong shape)", () => {
    const result = validateCostEntryInput(costOverrides({ incurredOn: "08/20/2026" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("incurredOn");
    }
  });
});

describe("validateCostCorrectionInput", () => {
  function correction(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      entryId: VALID_ENTRY_ID,
      reason: "corrected hours after foreman review",
      patch: { amount: 500 },
      ...overrides,
    };
  }

  it("accepts a well-formed correction", () => {
    const result = validateCostCorrectionInput(correction());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        entryId: VALID_ENTRY_ID,
        reason: "corrected hours after foreman review",
        patch: { amount: 500 },
      });
    }
  });

  it("rejects an empty patch (at least one field required)", () => {
    const result = validateCostCorrectionInput(correction({ patch: {} }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("at least one field");
    }
  });

  it("rejects a blank reason", () => {
    const result = validateCostCorrectionInput(correction({ reason: "  " }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("reason");
    }
  });

  it("rejects a non-uuid entryId", () => {
    const result = validateCostCorrectionInput(correction({ entryId: "abc" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("entryId");
    }
  });

  it("accepts patch { state: 'void' } (void IS reachable via correction)", () => {
    const result = validateCostCorrectionInput(correction({ patch: { state: "void" } }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.patch).toEqual({ state: "void" });
    }
  });

  it("rejects patch { amount: '' } (the empty-string-numeric carry, again)", () => {
    const result = validateCostCorrectionInput(correction({ patch: { amount: "" } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount");
    }
  });

  it("rejects an unknown patch key", () => {
    const result = validateCostCorrectionInput(
      correction({ patch: { amount: 500, bogusKey: "nope" } }),
    );
    expect(result.success).toBe(false);
  });
});

describe("validateRevenueEntryInput", () => {
  function revenue(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      jobNumber: "JOB-1107",
      entryType: "invoice",
      amount: 1200,
      occurredOn: "2026-08-20",
      note: "invoice #1042 sent",
      ...overrides,
    };
  }

  it("accepts a well-formed invoice entry", () => {
    const result = validateRevenueEntryInput(revenue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        jobNumber: "JOB-1107",
        entryType: "invoice",
        amount: 1200,
        occurredOn: "2026-08-20",
        note: "invoice #1042 sent",
      });
    }
  });

  it("rejects an empty note (required source note)", () => {
    const result = validateRevenueEntryInput(revenue({ note: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("note");
    }
  });

  it("rejects an entryType outside the closed set", () => {
    const result = validateRevenueEntryInput(revenue({ entryType: "deposit" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("entryType");
    }
  });

  it("rejects a negative amount (forms always send positive; sign is the repo's job)", () => {
    const result = validateRevenueEntryInput(revenue({ amount: -100 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("amount");
    }
  });

  it("rejects a bad occurredOn date", () => {
    const result = validateRevenueEntryInput(revenue({ occurredOn: "2026-02-30" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toContain("occurredOn");
    }
  });
});
