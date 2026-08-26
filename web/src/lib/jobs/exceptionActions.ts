import "server-only";

// ============================================================
// Lost Boys Demolition — web app — schedule-exception resolution actions
// (Phase 1, v2 Task 5B Step 2 / profitability v2, Lane W)
//
// The resolution surface for calendar-deletion schedule exceptions.
// Mirrors scheduleActions.ts's structure exactly (inline Zod, typed
// error class with a code union, exported lowercased-substring
// classifier documented against a byte-pinned raise-text table,
// createAdminClient() RPC call with p_actor: null under the no-login
// model) but targets a DIFFERENT RPC — `resolve_schedule_exception` —
// owned by a sibling SQL lane (Task 1,
// supabase/migrations/20260824151000_calendar_inbound_rpcs.sql — NOT
// this file's concern; see task-1-brief.md for its full spec). This
// file wires against the FIXED signature that brief specifies verbatim:
//
//   resolve_schedule_exception(p_exception_id uuid, p_resolution text,
//     p_reason text, p_start_date date, p_end_date date, p_actor uuid,
//     p_actor_name text) returns jsonb
//
// Also exports `listOpenScheduleExceptions()`, a plain read (via
// `.from("job_schedule_exceptions")`, not an RPC) used by the
// `/jobs/exceptions` queue page to list the rows this action resolves.
//
// ⚠️ Deviation from the v2 spec's exact input keys (recorded, not
// silent): the spec names the input `jobNumber`; this module keys on
// `exceptionId` instead. A job can hold two open exceptions
// simultaneously (main and crew calendar events can each be deleted
// independently — the partial unique index backing
// `job_schedule_exceptions_one_open` is per `(job_number,
// external_event_id)`, not per job), so `jobNumber` alone would be
// ambiguous about which open exception to resolve. `actorName` is also
// not in the spec's input shape — it is required here because every
// mutation RPC in this app takes an actor for its audit trail (same
// house pattern as `cancelScheduledJob`/`scheduleEstimate`).
//
// Validation is enforced HERE, client-side of the RPC call, via an
// inline Zod schema — bad input never reaches the database. New
// types/schemas for this action live inside this file rather than a
// shared validate.ts, matching scheduleActions.ts's precedent (Task 5A
// review: "new types/schemas for Task 5A live inside this file rather
// than being added to that one").
// ============================================================

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

export type ResolveExceptionResolution =
  | "reschedule"
  | "postponed"
  | "closed_lost"
  | "dismiss";

export interface ResolveDeletedCalendarEventInput {
  exceptionId: string; // uuid
  resolution: ResolveExceptionResolution;
  reason: string; // nonblank
  actorName: string; // nonblank — the estimator-picker name, trimmed before send
  startDate?: string; // required iff resolution === "reschedule"
  endDate?: string;
}

export type ResolveExceptionErrorCode =
  | "not_found"
  | "not_open"
  | "not_resolvable"
  | "invalid_input"
  | "other";

export class ResolveExceptionError extends Error {
  readonly code: ResolveExceptionErrorCode;

  constructor(message: string, code: ResolveExceptionErrorCode) {
    super(message);
    this.name = "ResolveExceptionError";
    this.code = code;
  }
}

/**
 * The `previous_schedule` jsonb snapshot `open_calendar_deletion_exception`
 * (Task 1) writes at exception-open time — crew + both dates + both gcal
 * event ids as they stood immediately before the deletion. Deliberately
 * carries NO pricing (CLAUDE.md's no-pricing-to-crew-surfaces rule) —
 * this shape only ever holds scheduling facts.
 */
export interface PreviousSchedule {
  crew: string | null;
  start_date: string | null;
  end_date: string | null;
  gcal_main_event_id?: string | null;
  gcal_crew_event_id?: string | null;
}

/**
 * One open row from `job_schedule_exceptions`, as listed for the
 * `/jobs/exceptions` queue page. Narrower than the full table row — this
 * read only needs what the card renders plus the identity fields the
 * resolve form submits.
 */
export interface OpenScheduleException {
  id: string;
  job_number: string;
  external_event_id: string | null;
  kind: string;
  previous_schedule: PreviousSchedule;
  opened_at: string;
}

/** Normalized `resolve_schedule_exception` jsonb return shape. */
export interface ResolvedException {
  resolution: ResolveExceptionResolution;
  job_number: string;
  exception_id: string;
}

// ------------------------------------------------------------
// Validation (inline Zod — house style per validate.ts/scheduleActions.ts,
// kept local to this file).
// ------------------------------------------------------------

// Same UUID shape check as validate.ts's UUID_RE / estimates/ids.ts's
// isValidEstimateId — duplicated rather than imported so this module
// stays self-contained, matching that precedent.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Same real-calendar-date check as validate.ts's isRealCalendarDate —
 * duplicated rather than imported for the same self-containment reason
 * as UUID_RE above.
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

const resolveDeletedCalendarEventInputSchema = z
  .object({
    exceptionId: z
      .string({ error: () => "exceptionId must be a string" })
      .regex(UUID_RE, "exceptionId must be a UUID"),
    resolution: z.enum(["reschedule", "postponed", "closed_lost", "dismiss"], {
      error: () =>
        "resolution must be one of: reschedule, postponed, closed_lost, dismiss",
    }),
    reason: z
      .string({ error: () => "reason must be a string" })
      .trim()
      .min(1, "reason must not be blank"),
    actorName: z
      .string({ error: () => "actorName must be a string" })
      .trim()
      .min(1, "actorName must not be blank"),
    startDate: z
      .string({ error: () => "startDate must be a string" })
      .refine(isRealCalendarDate, "startDate must be a valid YYYY-MM-DD calendar date")
      .optional(),
    endDate: z
      .string({ error: () => "endDate must be a string" })
      .refine(isRealCalendarDate, "endDate must be a valid YYYY-MM-DD calendar date")
      .optional(),
  })
  .superRefine((val, ctx) => {
    // Other resolutions: dates optional/ignored — no requirement here.
    if (val.resolution !== "reschedule") return;
    if (!val.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "startDate is required for reschedule",
        path: ["startDate"],
      });
    }
    if (!val.endDate) {
      ctx.addIssue({
        code: "custom",
        message: "endDate is required for reschedule",
        path: ["endDate"],
      });
    }
    if (val.startDate && val.endDate && val.endDate < val.startDate) {
      ctx.addIssue({
        code: "custom",
        message: `endDate (${val.endDate}) must be on or after startDate (${val.startDate})`,
        path: ["endDate"],
      });
    }
  });

// ------------------------------------------------------------
// Error classification
// ------------------------------------------------------------

/**
 * Exported for direct unit testing of the classification rules — same
 * pattern as scheduleActions.ts's classifyCancelError, but against
 * `resolve_schedule_exception`'s byte-pinned raise-text table
 * (task-1-brief.md's Interfaces block, the cross-lane API this
 * classifier is contracted against verbatim):
 *
 *   1. "exception % not found"                              -> not_found
 *   2. "exception % is not open (status %)"                 -> not_open
 *   3. "invalid resolution %"                                -> invalid_input
 *   4. "resolution reason is required"                       -> invalid_input
 *   5. "reschedule requires startDate and endDate"            -> invalid_input
 *   6. "endDate (%) must be on or after startDate (%)"        -> invalid_input
 *   7. "actor name is required"                               -> invalid_input
 *   8. "job % is no longer scheduled (status %)"              -> not_resolvable
 *
 * Plus ONE raise text that is not `resolve_schedule_exception`'s own:
 * `resolve_schedule_exception`'s `postponed`/`closed_lost` branches call
 * the existing `cancel_scheduled_job` RPC internally (task-1-brief.md
 * Step 4), so a wrong-status rejection from THAT call ("job % cannot be
 * cancelled from status %", scheduleActions.ts's classifyCancelError
 * table) can also surface here — routed to `not_resolvable`, the same
 * "this exception can't be actioned right now" bucket as raise text 8.
 *
 * Order matters only where two needles could otherwise both match; by
 * construction none of the needles below overlap (e.g. "not found" is
 * not a substring of "is not open", and vice versa), so simple
 * first-match order is safe.
 */
export function classifyResolveError(message: string): ResolveExceptionErrorCode {
  const m = message.toLowerCase();
  if (m.includes("not found")) return "not_found";
  if (m.includes("is not open")) return "not_open";
  if (
    m.includes("invalid resolution") ||
    m.includes("reason is required") ||
    m.includes("requires startdate") ||
    m.includes("must be on or after") ||
    m.includes("actor name")
  ) {
    return "invalid_input";
  }
  if (m.includes("no longer scheduled")) return "not_resolvable";
  if (m.includes("cannot be cancelled")) return "not_resolvable";
  return "other";
}

// ------------------------------------------------------------
// UI-facing message mapping (fix round 1, review finding #1)
// ------------------------------------------------------------

/**
 * Human-readable messages for the four "expected" error codes — everything
 * EXCEPT `other`, which deliberately falls through to the raw RPC message
 * (see `friendlyResolveErrorMessage` below). Without this mapping, the
 * queue UI was rendering the raw Postgres raise text verbatim (e.g.
 * `"resolve_schedule_exception: exception 8f3a... is not open (status
 * dismissed)"`) straight to Dane/Jackson/Matt.
 *
 * `not_open` is the operationally important case: it means someone else
 * already resolved this exact row between the page load and this submit
 * — the on-screen list is stale, not the user's input. The caller
 * (ResolveExceptionForm.tsx) additionally calls `router.refresh()` for
 * this code; the message here is written to match that follow-up action.
 */
const FRIENDLY_RESOLVE_ERROR_MESSAGES: Partial<
  Record<ResolveExceptionErrorCode, string>
> = {
  not_found: "This exception could not be found — it may already be resolved.",
  not_open: "Someone already resolved this — refreshing the list.",
  not_resolvable:
    "This job's status has changed, so this exception can no longer be resolved this way.",
  invalid_input: "That submission wasn't valid — check the reason and dates and try again.",
};

/**
 * Maps a classified `ResolveExceptionErrorCode` to the message the queue
 * UI should display. Falls back to `rawMessage` (the RPC's own error
 * text) only when `code` is `"other"` or absent — an unclassified error
 * is more useful shown verbatim than hidden behind a generic string.
 *
 * Pure, no I/O — kept in this module (rather than inline in
 * ResolveExceptionForm.tsx) so the mapping is unit-testable from
 * exceptionActions.test.ts without needing a React/DOM test harness.
 */
export function friendlyResolveErrorMessage(
  code: ResolveExceptionErrorCode | undefined,
  rawMessage: string,
): string {
  if (code && code in FRIENDLY_RESOLVE_ERROR_MESSAGES) {
    return FRIENDLY_RESOLVE_ERROR_MESSAGES[code] as string;
  }
  return rawMessage;
}

// ------------------------------------------------------------
// RPC / query calls
// ------------------------------------------------------------

function normalizePreviousSchedule(raw: unknown): PreviousSchedule {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    crew: (r.crew as string | null) ?? null,
    start_date: (r.start_date as string | null) ?? null,
    end_date: (r.end_date as string | null) ?? null,
    gcal_main_event_id: (r.gcal_main_event_id as string | null) ?? null,
    gcal_crew_event_id: (r.gcal_crew_event_id as string | null) ?? null,
  };
}

function normalizeOpenScheduleException(
  raw: Record<string, unknown>,
): OpenScheduleException {
  return {
    id: raw.id as string,
    job_number: raw.job_number as string,
    external_event_id: (raw.external_event_id as string | null) ?? null,
    kind: raw.kind as string,
    previous_schedule: normalizePreviousSchedule(raw.previous_schedule),
    opened_at: raw.opened_at as string,
  };
}

function normalizeResolvedException(raw: Record<string, unknown>): ResolvedException {
  return {
    resolution: raw.resolution as ResolveExceptionResolution,
    job_number: raw.job_number as string,
    exception_id: raw.exception_id as string,
  };
}

/**
 * Calls `resolve_schedule_exception` — the explicit resolution action for
 * an open calendar-deletion schedule exception. Validates `input` with
 * Zod FIRST; a validation failure throws `ResolveExceptionError` with
 * code `invalid_input` and never reaches the RPC. `p_actor` is always
 * `null` under the no-login model (see @/lib/estimator.ts / CLAUDE.md
 * "No-login estimate tool") — this module hardcodes that rather than
 * taking an actorId parameter; `p_actor_name` carries the picker-declared
 * name from `input.actorName`.
 *
 * Throws `ResolveExceptionError` (never a bare Error) on any RPC-level
 * rejection — see `classifyResolveError`'s doc comment for the exact
 * raise-text mapping. An RPC success with no returned row also throws,
 * classified `other` (the RPC's contract is "returns jsonb"; a
 * null/undefined data with no error is an unexpected shape, not a
 * documented outcome — same convention as scheduleActions.ts's
 * cancelScheduledJob).
 */
export async function resolveDeletedCalendarEvent(
  input: ResolveDeletedCalendarEventInput,
): Promise<ResolvedException> {
  const parsed = resolveDeletedCalendarEventInputSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new ResolveExceptionError(
      `resolveDeletedCalendarEvent: invalid input — ${detail}`,
      "invalid_input",
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("resolve_schedule_exception", {
    p_exception_id: parsed.data.exceptionId,
    p_resolution: parsed.data.resolution,
    p_reason: parsed.data.reason,
    p_start_date: parsed.data.startDate ?? null,
    p_end_date: parsed.data.endDate ?? null,
    p_actor: null,
    p_actor_name: parsed.data.actorName,
  });

  if (error) {
    const code = classifyResolveError(error.message);
    throw new ResolveExceptionError(error.message, code);
  }
  if (!data) {
    throw new ResolveExceptionError(
      "resolve_schedule_exception returned no row",
      "other",
    );
  }

  return normalizeResolvedException(data as Record<string, unknown>);
}

/**
 * Lists every currently-open `job_schedule_exceptions` row, newest
 * first — backs the `/jobs/exceptions` queue page. A plain
 * service-role read via `createAdminClient()`, not an RPC (this table
 * has RLS enabled with no policies, same posture as every other Phase 1
 * operational table — see CLAUDE.md's Supabase Tables section — so only
 * the service-role client can read it).
 */
export async function listOpenScheduleExceptions(): Promise<OpenScheduleException[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("job_schedule_exceptions")
    .select("id, job_number, external_event_id, kind, previous_schedule, opened_at")
    .eq("status", "open")
    // resolve_schedule_exception (Task 1) pairs alerts only under
    // calendar_deleted: fingerprints (Session 10 deferral ledger) — the
    // other two `kind` values ('calendar_conflict', 'sync_failed') have
    // no writer today, so this queue must not offer them a resolution
    // form it can't actually back.
    .eq("kind", "calendar_deleted")
    .order("opened_at", { ascending: false });

  if (error) {
    throw new ResolveExceptionError(error.message, "other");
  }

  return ((data as Record<string, unknown>[] | null) ?? []).map(
    normalizeOpenScheduleException,
  );
}
