// ============================================================
// Lost Boys Demolition — web app — manual ledger trust-boundary validation
// (Profitability v2 Task 7, Lane A)
//
// PURE — no "server-only", no I/O, no Supabase import. Same
// safeParse -> discriminated ValidationResult, path-prefixed error string
// pattern as @/lib/jobs/validate.ts, which this file otherwise mirrors
// closely (including duplicating that file's `isRealCalendarDate`
// round-trip technique rather than importing it — @/lib/jobs/validate.ts
// documents that duplication as its own precedent for keeping pure
// modules self-contained, and this file follows the same precedent).
//
// CRITICAL CARRY FROM THE TASK 6 FINAL REVIEW: every numeric field here
// (`amount`, `quantity`, `unitCost`) is built from `z.number()` ONLY —
// never `z.coerce.number()`. An empty string, a numeric string ("460"),
// NaN, and Infinity must all be REJECTED, not silently coerced into a
// number. `z.number()` already rejects all four by construction; this
// file adds no coercion anywhere.
// ============================================================

import { z } from "zod";
import { COST_CATEGORIES, type CostCategory } from "@/lib/profitability/types";
import type { CostCorrectionInput, CostEntryInput, RevenueEntryInput } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JOB_NUMBER_RE = /^JOB-\d+$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a STRING that is both `YYYY-MM-DD`-shaped AND names a
 * real calendar date. `new Date(Date.UTC(y, m - 1, d))` silently
 * normalizes an out-of-range day/month (e.g. 2026-02-30 rolls forward to
 * 2026-03-02) rather than throwing, so this reads the constructed date's
 * UTC components back and rejects anything that didn't round-trip
 * exactly. Duplicated from @/lib/jobs/validate.ts (see that file's
 * header for why it stays duplicated rather than imported).
 */
function isRealCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Trims a string input; passes non-strings through untouched so the
 *  downstream schema step reports the real type error instead of this
 *  preprocessing step masking it. */
function trimIfString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

/** Trims a string, then converts a blank result to `null` — used for the
 *  optional free-text fields (`employeeName`, `vendorName`, `note` on a
 *  cost entry) where "the user left it blank" and "the user never
 *  supplied it" are the same thing. */
function trimToNullableString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const jobNumberSchema = z.preprocess(
  trimIfString,
  z
    .string({ error: () => "jobNumber must be a string" })
    .regex(JOB_NUMBER_RE, "jobNumber must match ^JOB-\\d+$"),
);

const categorySchema = z.enum(COST_CATEGORIES as [CostCategory, ...CostCategory[]], {
  error: () => `category must be one of: ${COST_CATEGORIES.join(", ")}`,
});

const amountSchema = z
  .number({ error: () => "amount must be a number" })
  .finite("amount must be a finite number")
  .positive("amount must be a positive number");

const nonNegativeAmountSchema = z
  .number({ error: () => "unitCost must be a number" })
  .finite("unitCost must be a finite number")
  .nonnegative("unitCost must be zero or a positive number");

const positiveQuantitySchema = z
  .number({ error: () => "quantity must be a number" })
  .finite("quantity must be a finite number")
  .positive("quantity must be a positive number");

const incurredOnSchema = z
  .string({ error: () => "incurredOn must be a string" })
  .refine(isRealCalendarDate, "incurredOn must be a valid YYYY-MM-DD calendar date");

const occurredOnSchema = z
  .string({ error: () => "occurredOn must be a string" })
  .refine(isRealCalendarDate, "occurredOn must be a valid YYYY-MM-DD calendar date");

const nullableTrimmedString = z.preprocess(trimToNullableString, z.string().nullable());

export const costEntryInputSchema = z
  .object({
    jobNumber: jobNumberSchema,
    category: categorySchema,
    // `void` is never creatable — see CreatableLedgerState in ./types.
    state: z.enum(["provisional", "committed", "approved"], {
      error: () => "state must be one of: provisional, committed, approved",
    }),
    amount: amountSchema,
    quantity: positiveQuantitySchema.nullable(),
    unitCost: nonNegativeAmountSchema.nullable(),
    employeeName: nullableTrimmedString,
    vendorName: nullableTrimmedString,
    incurredOn: incurredOnSchema,
    note: nullableTrimmedString,
  })
  .strict();

const costCorrectionPatchSchema = z
  .object({
    category: categorySchema.optional(),
    // Unlike creation, `void` IS reachable here — that's how entries are
    // removed.
    state: z.enum(["provisional", "committed", "approved", "void"], {
      error: () => "state must be one of: provisional, committed, approved, void",
    }).optional(),
    amount: amountSchema.optional(),
    quantity: positiveQuantitySchema.nullable().optional(),
    unitCost: nonNegativeAmountSchema.nullable().optional(),
    employeeName: nullableTrimmedString.optional(),
    vendorName: nullableTrimmedString.optional(),
    incurredOn: incurredOnSchema.optional(),
    note: nullableTrimmedString.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "patch must contain at least one field",
  });

export const costCorrectionInputSchema = z.object({
  entryId: z
    .string({ error: () => "entryId must be a string" })
    .regex(UUID_RE, "entryId must be a UUID"),
  reason: z.preprocess(
    trimIfString,
    z
      .string({ error: () => "reason must be a string" })
      .min(1, "reason must not be blank"),
  ),
  patch: costCorrectionPatchSchema,
});

export const revenueEntryInputSchema = z
  .object({
    jobNumber: jobNumberSchema,
    entryType: z.enum(["approved_contract", "invoice", "credit", "refund", "payment"], {
      error: () =>
        "entryType must be one of: approved_contract, invoice, credit, refund, payment",
    }),
    amount: amountSchema,
    occurredOn: occurredOnSchema,
    note: z.preprocess(
      trimIfString,
      z.string({ error: () => "note must be a string" }).min(1, "note must not be blank"),
    ),
  })
  .strict();

export type ValidationResult<T> = { success: true; data: T } | { success: false; errors: string[] };

function toValidationResult<T>(result: z.ZodSafeParseResult<T>): ValidationResult<T> {
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return { success: false, errors };
}

/**
 * Parses and validates an unknown cost-entry-creation payload — the
 * trust boundary between the client and the server action that will
 * eventually create a manual cost-ledger entry (Task 3+).
 */
export function validateCostEntryInput(input: unknown): ValidationResult<CostEntryInput> {
  return toValidationResult(costEntryInputSchema.safeParse(input));
}

/**
 * Parses and validates an unknown cost-correction payload.
 */
export function validateCostCorrectionInput(
  input: unknown,
): ValidationResult<CostCorrectionInput> {
  return toValidationResult(costCorrectionInputSchema.safeParse(input));
}

/**
 * Parses and validates an unknown revenue-entry payload.
 */
export function validateRevenueEntryInput(input: unknown): ValidationResult<RevenueEntryInput> {
  return toValidationResult(revenueEntryInputSchema.safeParse(input));
}
