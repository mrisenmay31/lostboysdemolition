// ============================================================
// Lost Boys Demolition — web app — schedule-to-job input validation
// (Phase 1, v2 Task 4 / profitability v2 Phase 1 Session 3, lane 4b)
//
// PURE — no imports of repo.ts/admin.ts, no Supabase, no "server-only".
// Same "pure logic lives in its own untagged file" pattern as
// @/lib/estimates/validate.ts, which this file otherwise mirrors closely
// (safeParse -> discriminated ValidationResult, path-prefixed error
// strings).
//
// v2 doc Step 1 (lines 1161-1174): "Zod must enforce UUID estimate ID,
// nonblank crew, ISO dates, and endDate >= startDate. These are inclusive
// service dates; the Google adapter converts them to Calendar's exclusive
// all-day end.date." This file enforces exactly that — nothing here adds
// or subtracts a day from either date; that conversion is Task 5A's
// concern (supabase/functions/integration-dispatcher), not this file's.
//
// FIX ROUND 1 (review finding #2, MINOR/trust boundary): `crew` is now a
// CLOSED set (`z.enum(CREW_OPTIONS)`, from the shared pure
// @/lib/jobs/crews.ts module — see that file's header for why it's
// split out and for why "Jackson"/"Other" are deliberately not added).
// The first pass only enforced "Crew 1".."Crew 4" client-side (the
// <select>'s option list) — this app has no login and ships
// network-open, so "nonblank string" alone let a crafted request mint a
// job with an out-of-vocabulary crew that silently resolves to no Slack
// channel / no crew calendar downstream. `z.preprocess` trims first (so
// a stray space from any future caller doesn't fail a value that would
// otherwise be legitimate) and THEN enforces membership — trimming never
// widens the accepted set, since CREW_OPTIONS itself contains no leading/
// trailing whitespace.
// ============================================================

import { z } from "zod";
import { CREW_OPTIONS } from "./crews";
import type { ScheduleEstimateInput } from "./types";

// Same UUID shape check as @/lib/estimates/ids.ts's isValidEstimateId —
// duplicated rather than imported so this module stays a dependency-free
// pure file (that file has no "server-only" tag either, but keeping the
// jobs/ subtree self-contained avoids any accidental coupling to the
// estimates/ subtree's file layout for something this small).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a STRING that is both `YYYY-MM-DD`-shaped AND names a
 * real calendar date. `new Date(Date.UTC(y, m - 1, d))` silently
 * normalizes an out-of-range day/month (e.g. 2026-02-30 rolls forward to
 * 2026-03-02) rather than throwing, so this reads the constructed date's
 * UTC components back and rejects anything that didn't round-trip
 * exactly — the same technique guards against 2026-13-01 (month 13
 * overflows into the next year) and non-leap Feb 29 (rolls into March 1)
 * without a hand-maintained days-per-month table.
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

export const scheduleEstimateInputSchema = z
  .object({
    estimateId: z
      .string({ error: () => "estimateId must be a string" })
      .regex(UUID_RE, "estimateId must be a UUID"),
    crew: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.enum(CREW_OPTIONS, {
        error: () => `crew must be one of: ${CREW_OPTIONS.join(", ")}`,
      }),
    ),
    startDate: z
      .string({ error: () => "startDate must be a string" })
      .refine(isRealCalendarDate, "startDate must be a valid YYYY-MM-DD calendar date"),
    endDate: z
      .string({ error: () => "endDate must be a string" })
      .refine(isRealCalendarDate, "endDate must be a valid YYYY-MM-DD calendar date"),
  })
  .superRefine((val, ctx) => {
    // Both fields are already confirmed YYYY-MM-DD (zero-padded, 4-digit
    // year) by the per-field .refine above by the time superRefine runs,
    // so plain string comparison is a correct, timezone-free stand-in for
    // date comparison here — no Date object needed for the ordering check
    // itself, only for the calendar-validity check above.
    if (val.endDate < val.startDate) {
      ctx.addIssue({
        code: "custom",
        message: `endDate (${val.endDate}) must be on or after startDate (${val.startDate})`,
        path: ["endDate"],
      });
    }
  });

export type ScheduleValidationResult =
  | { success: true; data: ScheduleEstimateInput }
  | { success: false; errors: string[] };

/**
 * Parses and validates an unknown schedule-form payload — the trust
 * boundary between the client (ScheduleEstimateForm) and the server
 * (jobs/actions.ts's scheduleEstimateAction). Returns a discriminated
 * result rather than throwing, mirroring
 * @/lib/estimates/validate.ts's validateEstimateDraft.
 */
export function validateScheduleEstimateInput(input: unknown): ScheduleValidationResult {
  const result = scheduleEstimateInputSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return { success: false, errors };
}
