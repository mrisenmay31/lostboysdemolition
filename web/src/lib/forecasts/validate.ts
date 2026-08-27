// ============================================================
// Lost Boys Demolition — web app — forecast override validation
// (Profitability v2 Task 9, Session 14 Lane B)
//
// PURE — no "server-only", no I/O. Same safeParse → discriminated result,
// path-prefixed error-string pattern as @/lib/ledger/validate.ts.
//
// CRITICAL CARRY (Task 6 final review → Session 13 handoff): every
// numeric field is z.number() ONLY — never z.coerce.number(). Empty
// string, numeric string, NaN, and Infinity are all REJECTED. The
// positivity requirements on expectedCrewSize/hoursPerDay are the
// crew-days zero-divisor guard: an override can never inject a 0 into
// the remainingWorkdays × expectedCrewSize × hoursPerDay product that
// calculateJobHealth.ts builds its labor forecast from.
// ============================================================

import { z } from "zod";
import { COST_CATEGORIES, type CostCategory } from "@/lib/profitability/types";
import type { ForecastOverrideInput, ForecastOverrideValidation } from "./types";

const JOB_NUMBER_RE = /^JOB-\d+$/;

const jobNumberSchema = z.string().regex(JOB_NUMBER_RE, "must look like JOB-1234");
const reasonSchema = z
  .string()
  .refine((s) => s.trim() !== "", { message: "reason is required" })
  .transform((s) => s.trim());

const laborSchema = z
  .object({
    kind: z.literal("labor"),
    jobNumber: jobNumberSchema,
    // numeric(5,2) column — cap well inside it. 0 allowed: "no days left".
    remainingWorkdays: z.number().finite().min(0).max(365),
    expectedCrewSize: z.number().int().positive().max(50),
    hoursPerDay: z.number().positive().max(24),
    reason: reasonSchema,
  })
  .strict();

const categorySchema = z
  .object({
    kind: z.literal("category"),
    jobNumber: jobNumberSchema,
    category: z.enum(COST_CATEGORIES as [CostCategory, ...CostCategory[]]),
    // numeric(12,2) column — cap well inside it. 0 allowed: "nothing left".
    expectedRemainingCost: z.number().finite().min(0).max(9_999_999),
    reason: reasonSchema,
  })
  .strict();

const overrideSchema = z.discriminatedUnion("kind", [laborSchema, categorySchema]);

export function validateForecastOverrideInput(input: unknown): ForecastOverrideValidation {
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
    };
  }
  return { ok: true, value: parsed.data as ForecastOverrideInput };
}
