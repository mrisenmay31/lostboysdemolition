import "server-only";

// ============================================================
// Lost Boys Demolition — web app — schedule-to-job promotion data layer
// (Phase 1, v2 Task 4 / profitability v2 Phase 1 Session 3, lane 4b)
//
// Thin RPC wrapper, same shape as @/lib/estimates/repo.ts's
// updateStatus/updateQuote/updateJobNumber: build the args, call
// admin.rpc(...), normalize the numeric-over-the-wire-as-string columns,
// classify any error into a typed ScheduleEstimateError.
//
// `schedule_estimate(p_estimate_id, p_schedule, p_actor, p_actor_name)` is
// owned by lane 4a (supabase/migrations/20260819*_schedule_estimate_rpc.sql
// — NOT this file). This file wires against the FIXED signature the v2
// doc and the Phase 1 plan's concurrency map specify verbatim:
//   p_estimate_id  uuid   — the estimate id being scheduled (must be the
//                           CURRENT accepted presented version)
//   p_schedule     jsonb  — {crew, startDate, endDate} exactly as the
//                           validated ScheduleEstimateInput carries them
//   p_actor        uuid | null — always null under the no-login model
//   p_actor_name   text   — the picker-declared estimator name
// and returns the created/reactivated `jobs` row (v2 doc Step 2.8:
// "Return the created job row").
//
// IDEMPOTENT RE-CALL (v2 doc Step 2, unnumbered paragraph after the
// 8-step list): "A repeated call for the same estimate family must
// return the already linked job and must not mint a second number or
// baseline." That is the RPC's NORMAL SUCCESS PATH, not an error —
// scheduleEstimate() below returns it the same way as a first-time
// mint, with no way (or need) for the caller to distinguish "just
// minted" from "already existed" from the return value alone. Verified
// directly against lane 4a's landed
// supabase/migrations/20260819170000_schedule_estimate_rpc.sql: an
// existing ACTIVE job for the family is returned unchanged (no raise);
// a cancelled job is silently reactivated and returned (also no raise).
// The ScheduleEstimateError `already_scheduled` code below exists for
// the one case the RPC DOES raise on instead: the estimate's own
// `job_number` is already set by a path OTHER than schedule_estimate
// (the coexisting legacy ghl-job-webhook mint, live until the Phase 1
// gate flips ENABLE_GHL_ACCEPTANCE_JOB_CREATION) — see
// classifyScheduleError's comment for the exact verified message.
//
// `classifyScheduleError` below pattern-matches on lowercased SUBSTRINGS
// of the RPC's raised message text — VERIFIED against lane 4a's landed
// migration (not just the v2 doc's English description) once both lanes'
// work was visible in this shared worktree; see each `raise exception`
// call cited in the comments below. The RPC does not distinguish
// "reversed" from "superseded" from "never accepted" in its message text
// (all three fall under one "is not the currently accepted version"
// raise for eligibility 1) — the `superseded` code stays in the type
// union for forward compatibility / a more specific future RPC message,
// but is UNREACHABLE against this RPC's current text; every one of those
// three cases classifies as `not_accepted` today, which is still an
// accurate (if less specific) description.
// ============================================================

import { createAdminClient } from "@/lib/supabase/admin";
import { ScheduleEstimateError } from "./types";
import type { ScheduleEstimateInput, ScheduleEstimateErrorCode, ScheduledJobRow } from "./types";

// Same numeric(*, *)-comes-back-as-a-string gotcha @/lib/estimates/repo.ts
// documents and guards against (see that file's toNum/toNullableNum) —
// `jobs.estimate_value` and `jobs.current_budget_version` are numeric
// columns and cross this same RPC-return boundary.
function toNum(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : toNum(value);
}

function normalizeJobRow(raw: Record<string, unknown>): ScheduledJobRow {
  return {
    ...(raw as unknown as ScheduledJobRow),
    estimate_value: toNullableNum(raw.estimate_value),
    current_budget_version: toNullableNum(raw.current_budget_version),
  };
}

/**
 * Exported for direct unit testing of the classification rules — see the
 * module header comment and the matching pattern in
 * @/lib/estimates/commercialLifecycle.ts's classifyAcceptanceEventError.
 * Order matters: more specific checks are tried before the generic
 * "not accepted" fallback.
 *
 * VERIFIED against every `raise exception` in lane 4a's landed
 * supabase/migrations/20260819170000_schedule_estimate_rpc.sql:
 *   - "estimate % has no estimate_financial_details row — cannot mint a
 *     budget" -> missing_financial_details (note: UNDERSCORED
 *     "estimate_financial_details", not "financial details" — matching
 *     on "financial" + "detail" separately, not a fixed phrase, is what
 *     catches this)
 *   - "estimate % already has job_number % set (linked outside
 *     schedule_estimate) — refusing to mint a second job" ->
 *     already_scheduled (this is the ONLY raise-based already-scheduled
 *     path — the far more common "family already has an ACTIVE job"
 *     case is not an error at all; see the module header)
 *   - "estimate % is not the currently accepted version of family % —
 *     cannot schedule" -> not_accepted (this single message covers
 *     "never accepted", "reversed", AND "superseded-since-accepted" —
 *     the RPC does not distinguish them in text, so `superseded` below
 *     is unreachable against this RPC today; kept for forward
 *     compatibility, per the module header)
 */
export function classifyScheduleError(message: string): ScheduleEstimateErrorCode {
  const m = message.toLowerCase();
  if (m.includes("financial") && m.includes("detail")) return "missing_financial_details";
  if (m.includes("supersed")) return "superseded";
  if (
    (m.includes("already") && (m.includes("job") || m.includes("schedul"))) ||
    m.includes("belongs to the estimate family") ||
    m.includes("belongs to another job")
  ) {
    return "already_scheduled";
  }
  if (
    m.includes("accept") ||
    m.includes("reversed") ||
    m.includes("not the accepted") ||
    m.includes("not presented")
  ) {
    return "not_accepted";
  }
  return "other";
}

/** Best-effort extraction of a `JOB-XXXX` token from an RPC error message
 *  (e.g. a raise that names the already-linked job), so an
 *  `already_scheduled` ScheduleEstimateError can carry `jobNumber` for
 *  the UI to link to directly. Returns null when no such token is
 *  present — never guessed, never fabricated. Exported for direct unit
 *  testing alongside classifyScheduleError. */
export function extractJobNumber(message: string): string | null {
  const match = message.match(/JOB-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Calls `schedule_estimate` — the one action that mints `JOB-XXXX` (v2
 * Phase 1's keystone rule). `actorId` is always `null` under the
 * no-login model (see @/lib/estimator.ts / CLAUDE.md "No-login estimate
 * tool") — passed through explicitly rather than hardcoded here so this
 * function's signature stays honest about what it sends, matching
 * @/lib/estimates/repo.ts's updateStatus/updateQuote pattern of taking
 * an actor rather than assuming one.
 *
 * Throws ScheduleEstimateError (never a bare Error) on any RPC-level
 * rejection — see classifyScheduleError's doc comment for the exact
 * raise-text mapping. Never retries anything itself; the caller
 * (jobs/actions.ts) decides what, if anything, to do with a typed
 * failure.
 */
export async function scheduleEstimate(
  input: ScheduleEstimateInput,
  actorId: string | null,
  actorName: string,
): Promise<ScheduledJobRow> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("schedule_estimate", {
    p_estimate_id: input.estimateId,
    p_schedule: {
      crew: input.crew,
      startDate: input.startDate,
      endDate: input.endDate,
    },
    p_actor: actorId,
    p_actor_name: actorName,
  });

  if (error) {
    const code = classifyScheduleError(error.message);
    throw new ScheduleEstimateError(error.message, code, extractJobNumber(error.message));
  }
  if (!data) {
    throw new ScheduleEstimateError("schedule_estimate returned no row", "other");
  }

  return normalizeJobRow(data as Record<string, unknown>);
}
