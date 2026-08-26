// ============================================================
// Lost Boys Demolition — web app — manual ledger types
// (Profitability v2 Task 7, Lane A)
//
// PURE — no "server-only", no I/O, no Supabase import. Same "pure types
// live in their own untagged file" pattern as @/lib/jobs/types.ts, which
// this file mirrors for the LedgerError class shape. The only import is
// `CostCategory`/`COST_CATEGORIES` from @/lib/profitability/types — the
// existing pure contract for the seven cost-category buckets. Nothing
// else. Tasks 3–5 wire against these exact exported names — do not rename
// or reshape without checking those tasks' briefs first.
// ============================================================

import type { CostCategory } from "@/lib/profitability/types";

/** The four lifecycle states a manual ledger entry can carry. `"void"` is
 *  reachable ONLY through a correction (see `CostCorrectionPatch`) — a
 *  brand-new entry can never be created directly into `"void"`, which is
 *  why `CreatableLedgerState` excludes it below. */
export type LedgerEntryState = "provisional" | "committed" | "approved" | "void";

/** The subset of `LedgerEntryState` a NEW entry may be created in. `void`
 *  is deliberately excluded — an entry is voided by correcting an
 *  existing row, never minted directly into that state. */
export type CreatableLedgerState = Exclude<LedgerEntryState, "void">;

export type RevenueEntryType = "approved_contract" | "invoice" | "credit" | "refund" | "payment";

/** Trust-boundary input for creating one manual cost-ledger entry.
 *  `amount`/`quantity`/`unitCost` are `number` ONLY — never a coerced
 *  string — see the carry-forward note on `validate.ts`. */
export interface CostEntryInput {
  /** `^JOB-\d+$` */
  jobNumber: string;
  category: CostCategory;
  /** `void` is never creatable — see `CreatableLedgerState`. */
  state: CreatableLedgerState;
  /** > 0, finite; cents precision. */
  amount: number;
  /** Hours for `direct_labor`, loads for `dump`; > 0 when set, null when
   *  not applicable to the category. */
  quantity: number | null;
  /** >= 0 when set. */
  unitCost: number | null;
  employeeName: string | null;
  vendorName: string | null;
  /** `YYYY-MM-DD` real calendar date (Denver business date). */
  incurredOn: string;
  note: string | null;
}

/** Partial patch applied by a cost correction. Every key is optional, but
 *  `CostCorrectionInput` requires at least one to be present — an empty
 *  patch is not a correction. Unlike `CostEntryInput.state`, `state` here
 *  IS the full `LedgerEntryState` union: `void` is reachable, because
 *  voiding an entry is exactly what a correction is for. */
export interface CostCorrectionPatch {
  category?: CostCategory;
  state?: LedgerEntryState;
  /** > 0. */
  amount?: number;
  quantity?: number | null;
  unitCost?: number | null;
  employeeName?: string | null;
  vendorName?: string | null;
  incurredOn?: string;
  note?: string | null;
}

/** Trust-boundary input for correcting an existing cost-ledger entry. */
export interface CostCorrectionInput {
  /** uuid */
  entryId: string;
  /** Nonblank — corrections always carry a reason. */
  reason: string;
  patch: CostCorrectionPatch;
}

/** Trust-boundary input for one manual revenue-ledger entry. `amount` is
 *  always entered POSITIVE — sign for `credit`/`refund` is applied by the
 *  repo layer (Task 3+), not by the form or this validator. */
export interface RevenueEntryInput {
  jobNumber: string;
  entryType: RevenueEntryType;
  /** > 0 as entered. */
  amount: number;
  /** `YYYY-MM-DD` real calendar date. */
  occurredOn: string;
  /** Required source note — a revenue entry with no note is rejected. */
  note: string;
}

export type LedgerErrorCode = "not_found" | "invalid_input" | "not_correctable" | "other";

/** Mirrors the `ScheduleEstimateError` shape in @/lib/jobs/types.ts —
 *  callers (Tasks 3–5) must handle each code deliberately rather than
 *  treating every ledger failure the same way. */
export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(message: string, code: LedgerErrorCode) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}
