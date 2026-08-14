// ============================================================
// Lost Boys Demolition — web app — estimate draft validation
//
// PURE — no imports of repo.ts/rates.ts/auth.ts, no Supabase, no
// "server-only". Exercised directly by vitest with zero mocking.
//
// Two independent checks live here:
//   1. validateEstimateDraft — structural zod schema + itemized-mode
//      reconciliation (line items must sum to the header totals). This
//      runs BEFORE computeEstimate() in repo.ts's pipeline, so it never
//      sees total_bid.
//   2. validateQuoteOverride — the override-reason rule
//      ("quoted_price differs from total_bid -> reason required"). This
//      needs total_bid, which only exists AFTER computeEstimate() runs
//      (create path) or already lives on the DB row (updateQuote path).
//      It's therefore a separate pure function, called by repo.ts once
//      totalBid is known, rather than folded into the draft schema above.
//      This mirrors the DB CHECK `quote_override_reason_required` and the
//      update_estimate_quote RPC's procedural raise — UI/app enforces it
//      first for a friendly error, the RPC is the backstop.
// ============================================================

import { z } from "zod";
import type { EstimateDraft, QuoteOverrideCheck, ValidationResult } from "./types";

// Reconciliation tolerance — matches the brief's "to 0.01" spec, which
// absorbs float/rounding noise from client-side sums without letting a
// real mismatch (e.g. a forgotten line item) slip through.
const RECONCILE_EPSILON = 0.01;

function nonNegativeNumber(label: string) {
  // z.number() already rejects NaN/Infinity by default (zod v4) — no
  // separate finiteness refine needed. .nonnegative() is the HARD
  // REQUIREMENT from Task 10's review: reject negative labor_hours,
  // dump_count, materials_cost, total_job_hours, days_at_job,
  // num_employees, job_specific_costs, markup_pct on any line or header.
  return z.number({ error: () => `${label} must be a number` }).nonnegative(`${label} must be >= 0`);
}

export const lineItemDraftSchema = z.object({
  scopeLibraryId: z.string().nullish(),
  name: z.string().min(1, "line item name is required"),
  description: z.string().optional().default(""),
  laborHours: nonNegativeNumber("laborHours"),
  dumpCount: nonNegativeNumber("dumpCount"),
  materialsCost: nonNegativeNumber("materialsCost"),
  sortOrder: z.number().int().nonnegative("sortOrder must be >= 0").optional().default(0),
});

const baseEstimateDraftSchema = z.object({
  jobNumber: z.string().nullish(),
  jobName: z.string().nullish(),
  clientName: z.string().nullish(),
  clientType: z.enum(["Contractor", "Homeowner"]).nullish(),
  clientEmail: z.string().nullish(),
  clientPhone: z.string().nullish(),
  jobAddress: z.string().nullish(),
  city: z.string().nullish(),
  jobType: z.enum(["Residential", "Commercial"]).nullish(),
  estimateDate: z.string().nullish(),
  jobDetails: z.string().nullish(),
  laborMethod: z.enum(["total_hours", "days_employees"]),
  totalJobHours: nonNegativeNumber("totalJobHours").nullish(),
  daysAtJob: nonNegativeNumber("daysAtJob").nullish(),
  numEmployees: nonNegativeNumber("numEmployees").nullish(),
  dumpCount: nonNegativeNumber("dumpCount"),
  jobSpecificCosts: nonNegativeNumber("jobSpecificCosts"),
  markupPct: nonNegativeNumber("markupPct"),
  quotedPrice: z.number().nullish(),
  quoteOverrideReason: z.string().nullish(),
  status: z
    .enum(["draft", "sent", "accepted", "declined", "superseded", "historical"])
    .optional(),
  isPathB: z.boolean().optional().default(false),
  lineItems: z.array(lineItemDraftSchema).default([]),
});

/**
 * The draft schema. Cross-field rules that a plain per-key zod check can't
 * express live in `.superRefine`:
 *   - labor method fields required — mirrors the DB's `labor_method_fields`
 *     CHECK constraint, so a bad draft never reaches Postgres to fail there.
 *   - itemized-mode reconciliation — only enforced when lineItems.length>0
 *     (quick mode, with no line items, has nothing to reconcile against):
 *       totalJobHours == Σ line.laborHours (within RECONCILE_EPSILON)
 *       dumpCount     == Σ line.dumpCount  (within RECONCILE_EPSILON)
 *       jobSpecificCosts >= Σ line.materialsCost
 */
export const estimateDraftSchema = baseEstimateDraftSchema.superRefine((draft, ctx) => {
  if (draft.laborMethod === "total_hours") {
    if (draft.totalJobHours === null || draft.totalJobHours === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "totalJobHours is required when laborMethod is total_hours",
        path: ["totalJobHours"],
      });
    }
  } else if (draft.laborMethod === "days_employees") {
    if (draft.daysAtJob === null || draft.daysAtJob === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "daysAtJob is required when laborMethod is days_employees",
        path: ["daysAtJob"],
      });
    }
    if (draft.numEmployees === null || draft.numEmployees === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "numEmployees is required when laborMethod is days_employees",
        path: ["numEmployees"],
      });
    }
  }

  if (draft.lineItems.length > 0) {
    const sumLaborHours = draft.lineItems.reduce((sum, item) => sum + item.laborHours, 0);
    const sumDumpCount = draft.lineItems.reduce((sum, item) => sum + item.dumpCount, 0);
    const sumMaterialsCost = draft.lineItems.reduce((sum, item) => sum + item.materialsCost, 0);

    if (
      draft.totalJobHours === null ||
      draft.totalJobHours === undefined ||
      Math.abs(draft.totalJobHours - sumLaborHours) > RECONCILE_EPSILON
    ) {
      ctx.addIssue({
        code: "custom",
        message: `totalJobHours (${draft.totalJobHours ?? "null"}) must equal the sum of line item laborHours (${sumLaborHours})`,
        path: ["totalJobHours"],
      });
    }

    if (Math.abs(draft.dumpCount - sumDumpCount) > RECONCILE_EPSILON) {
      ctx.addIssue({
        code: "custom",
        message: `dumpCount (${draft.dumpCount}) must equal the sum of line item dumpCount (${sumDumpCount})`,
        path: ["dumpCount"],
      });
    }

    if (draft.jobSpecificCosts + RECONCILE_EPSILON < sumMaterialsCost) {
      ctx.addIssue({
        code: "custom",
        message: `jobSpecificCosts (${draft.jobSpecificCosts}) must be >= the sum of line item materialsCost (${sumMaterialsCost})`,
        path: ["jobSpecificCosts"],
      });
    }
  }
});

/**
 * Parses and validates an unknown draft payload (the trust boundary between
 * the client and the server: actions.ts / repo.ts feed this whatever the
 * browser sent). Returns a discriminated result rather than throwing, so
 * callers decide how to surface field errors.
 */
export function validateEstimateDraft(input: unknown): ValidationResult {
  const result = estimateDraftSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data as EstimateDraft };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return { success: false, errors };
}

/**
 * Pure override-reason rule. `quotedPrice` is compared to `totalBid` to
 * 2dp (matching the numeric(12,2) column and the RPC's own `round(...,2)`
 * normalization) so float noise never forces a spurious reason requirement.
 * A null/undefined quotedPrice always passes — clearing an override never
 * needs a reason, mirroring the RPC fixup (M-2).
 */
export function validateQuoteOverride(
  quotedPrice: number | null | undefined,
  totalBid: number,
  reason: string | null | undefined,
): QuoteOverrideCheck {
  if (quotedPrice === null || quotedPrice === undefined) {
    return { ok: true };
  }

  const roundedQuoted = Math.round(quotedPrice * 100) / 100;
  const roundedTotalBid = Math.round(totalBid * 100) / 100;

  if (roundedQuoted === roundedTotalBid) {
    return { ok: true };
  }

  if (reason === null || reason === undefined || reason.trim().length === 0) {
    return {
      ok: false,
      error: `quote_override_reason is required when quotedPrice (${roundedQuoted}) differs from total_bid (${roundedTotalBid})`,
    };
  }

  return { ok: true };
}
