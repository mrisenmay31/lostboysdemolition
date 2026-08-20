import "server-only";

// ============================================================
// Lost Boys Demolition — web app — explicit schedule-resolution actions
// (Phase 1, v2 Task 5A / profitability v2 Phase 1 Session 4, lane WEB)
//
// Cancel / postpone / closed-lost for an already-scheduled job. Mirrors
// repo.ts's structure (service-role admin.rpc call, numeric
// normalization if needed, a typed error class, and a
// lowercased-substring raise-text classifier) but targets a DIFFERENT
// RPC — `cancel_scheduled_job` — owned by a sibling SQL lane
// (supabase/migrations/*_cancel_scheduled_job.sql — NOT this file's
// concern; see task5-sql-brief.md for its full spec). This file wires
// against the FIXED signature the web brief specifies verbatim:
//
//   cancel_scheduled_job(p_job_number text, p_resolution text,
//     p_reason text, p_actor uuid, p_actor_name text) returns public.jobs
//
// Semantics (v2 decision ledger): a scheduled cancellation preserves the
// job and all facts — nothing is deleted, no estimate row is touched.
// `postponed` -> internal `cancelled`, GHL queued back to
// `Quote Accepted` (reschedulable — a later `schedule_estimate` call
// reactivates the SAME `JOB-XXXX`, see repo.ts's module header).
// `closed_lost` -> internal `cancelled`, GHL queued to
// `Closed Lost (Declined)`. The RPC itself enqueues the outbox events
// (`job.cancelled`, and `ghl.stage.requested` when the job has a GHL
// opportunity) — this module NEVER writes `integration_outbox` directly.
//
// Validation is enforced HERE, client-side of the RPC call, via an
// inline Zod schema — bad input never reaches the database. This is
// deliberately separate from @/lib/jobs/validate.ts's
// scheduleEstimateInputSchema (a different action, a different RPC); per
// the brief, new types/schemas for Task 5A live inside this file rather
// than being added to that one.
// ============================================================

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

export type CancelResolution = "postponed" | "closed_lost";

export interface CancelScheduledJobInput {
  jobNumber: string; // must match /^JOB-\d+$/
  resolution: CancelResolution;
  reason: string; // nonblank, trimmed before send
  actorName: string; // nonblank — the estimator-picker name, trimmed before send
}

export type CancelJobErrorCode =
  | "not_found"
  | "not_cancellable"
  | "invalid_input"
  | "other";

export class CancelScheduledJobError extends Error {
  readonly code: CancelJobErrorCode;

  constructor(message: string, code: CancelJobErrorCode) {
    super(message);
    this.name = "CancelScheduledJobError";
    this.code = code;
  }
}

/**
 * Normalized `jobs` row shape as returned by `cancel_scheduled_job` —
 * only the fields a caller needs to render a cancellation confirmation
 * (job identity, new lifecycle status, the cancellation record itself,
 * and the crew/schedule window being vacated). Deliberately narrower
 * than repo.ts's `ScheduledJobRow` — this action doesn't need the full
 * financial/estimate-linkage column set.
 */
export interface CancelledJob {
  job_number: string;
  status_v2: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  crew: string | null;
  start_date: string | null;
  end_date: string | null;
}

// ------------------------------------------------------------
// Validation (inline Zod — house style per validate.ts, kept local to
// this file per the brief: "New types/schemas live INSIDE
// scheduleActions.ts").
// ------------------------------------------------------------

const JOB_NUMBER_RE = /^JOB-\d+$/;

const cancelScheduledJobInputSchema = z.object({
  jobNumber: z
    .string({ error: () => "jobNumber must be a string" })
    .regex(JOB_NUMBER_RE, "jobNumber must match JOB-XXXX"),
  resolution: z.enum(["postponed", "closed_lost"], {
    error: () => "resolution must be one of: postponed, closed_lost",
  }),
  reason: z
    .string({ error: () => "reason must be a string" })
    .trim()
    .min(1, "reason must not be blank"),
  actorName: z
    .string({ error: () => "actorName must be a string" })
    .trim()
    .min(1, "actorName must not be blank"),
});

// ------------------------------------------------------------
// Error classification
// ------------------------------------------------------------

/**
 * Exported for direct unit testing of the classification rules — same
 * pattern as repo.ts's classifyScheduleError, but a SEPARATE classifier
 * against a SEPARATE RPC's raise text. Order matters where two needles
 * could otherwise both match, though in practice these five raise texts
 * (task5-sql-brief.md's "Migration 2" step 1) are mutually distinctive
 * substrings by construction — the brief's raise texts deliberately
 * avoid the substrings `classifyScheduleError` matches on ("already",
 * "accept", "supersed", "financial", "not presented"), so the two
 * classifiers never collide on the same input in practice.
 *
 * VERIFIED against task5-sql-brief.md's byte-pinned raise-text table
 * (the cross-lane API this classifier is contracted against):
 *   - "actor name is required" -> invalid_input
 *   - "invalid resolution: <value>" -> invalid_input
 *   - "cancellation reason is required" -> invalid_input
 *   - "no job found for <job_number>" -> not_found
 *   - "job <job_number> cannot be cancelled from status <status>" ->
 *     not_cancellable
 */
export function classifyCancelError(message: string): CancelJobErrorCode {
  const m = message.toLowerCase();
  if (m.includes("no job found")) return "not_found";
  if (m.includes("cannot be cancelled")) return "not_cancellable";
  if (
    m.includes("actor name is required") ||
    m.includes("invalid resolution") ||
    m.includes("reason is required")
  ) {
    return "invalid_input";
  }
  return "other";
}

// ------------------------------------------------------------
// RPC call
// ------------------------------------------------------------

function normalizeCancelledJob(raw: Record<string, unknown>): CancelledJob {
  return {
    job_number: raw.job_number as string,
    status_v2: raw.status_v2 as string,
    cancelled_at: (raw.cancelled_at as string | null) ?? null,
    cancellation_reason: (raw.cancellation_reason as string | null) ?? null,
    crew: (raw.crew as string | null) ?? null,
    start_date: (raw.start_date as string | null) ?? null,
    end_date: (raw.end_date as string | null) ?? null,
  };
}

/**
 * Calls `cancel_scheduled_job` — the explicit postponed/closed_lost
 * resolution action for an already-scheduled job. Validates `input`
 * with Zod FIRST; a validation failure throws `CancelScheduledJobError`
 * with code `invalid_input` and never reaches the RPC. `p_actor` is
 * always `null` under the no-login model (see @/lib/estimator.ts /
 * CLAUDE.md "No-login estimate tool") — this module hardcodes that
 * rather than taking an actorId parameter, since the brief's exported
 * signature is `cancelScheduledJob(input): Promise<CancelledJob>` with
 * no actorId argument; `p_actor_name` carries the picker-declared name
 * from `input.actorName`.
 *
 * Throws `CancelScheduledJobError` (never a bare Error) on any
 * RPC-level rejection — see `classifyCancelError`'s doc comment for the
 * exact raise-text mapping. An RPC success with no returned row also
 * throws, classified `other` (the RPC's contract is "returns
 * public.jobs (single row)"; a null/undefined data with no error is an
 * unexpected shape, not a documented outcome).
 */
export async function cancelScheduledJob(
  input: CancelScheduledJobInput,
): Promise<CancelledJob> {
  const parsed = cancelScheduledJobInputSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new CancelScheduledJobError(
      `cancelScheduledJob: invalid input — ${detail}`,
      "invalid_input",
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("cancel_scheduled_job", {
    p_job_number: parsed.data.jobNumber,
    p_resolution: parsed.data.resolution,
    p_reason: parsed.data.reason,
    p_actor: null,
    p_actor_name: parsed.data.actorName,
  });

  if (error) {
    const code = classifyCancelError(error.message);
    throw new CancelScheduledJobError(error.message, code);
  }
  if (!data) {
    throw new CancelScheduledJobError("cancel_scheduled_job returned no row", "other");
  }

  return normalizeCancelledJob(data as Record<string, unknown>);
}
