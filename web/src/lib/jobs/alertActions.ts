import "server-only";

// ============================================================
// Lost Boys Demolition — web app — job alert resolution actions
// (Phase 1, v2 Task 6, Lane D)
//
// A single acknowledgment path for open `job_alerts` rows — today those
// rows (including `calendar_watch:*` renewal-failure alerts, which have
// no other resolution path anywhere in the app) have no way to be marked
// handled short of raw SQL. Mirrors exceptionActions.ts's structure
// (inline Zod, `createAdminClient()`, a plain UPDATE via `.from()` rather
// than an RPC — `job_alerts` carries no dedicated resolution function),
// but this module is deliberately simpler than that one: there is no
// typed error-code union here (see jobs/actions.ts's
// `ResolveAlertActionResult`, which has no `code` field, unlike its
// cancel/resolve-exception siblings) — every failure is a plain `Error`.
//
// `resolved_by` (a `uuid references auth.users(id)` column, same as
// `job_schedule_exceptions.resolved_by`) is left NULL by every call this
// module makes and always will be under the no-login model — there is no
// `auth.users` row to point at (see CLAUDE.md's "No-login estimate
// tool"). The actor is instead recorded as a `[Name] note` prefix baked
// into `resolution_note`, matching this app's existing attribution
// convention (`estimate_mutations_audit`'s `actor_name` under the
// no-login scope change). This is the deliberate, final answer to the
// long-deferred "stamp `resolved_by`" item — not a placeholder pending
// real auth.
//
// The `.is("resolved_at", null)` guard on the UPDATE is the concurrency
// control: two people resolving the same alert at once race on this
// filter, and only one UPDATE actually matches a row. Zero rows updated
// — whether because the alert id doesn't exist or because someone else
// already resolved it — is indistinguishable from here and reported with
// one message.
// ============================================================

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

export interface ResolveJobAlertInput {
  alertId: string; // uuid
  note: string; // nonblank
  actorName: string; // nonblank — the estimator-picker name, trimmed before send
}

// ------------------------------------------------------------
// Validation (inline Zod — house style per exceptionActions.ts /
// scheduleActions.ts, kept local to this file).
// ------------------------------------------------------------

// Same UUID shape check as exceptionActions.ts's UUID_RE / validate.ts's
// UUID_RE — duplicated rather than imported so this module stays
// self-contained, matching that precedent.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resolveJobAlertInputSchema = z.object({
  alertId: z
    .string({ error: () => "alertId must be a string" })
    .regex(UUID_RE, "alertId must be a UUID"),
  note: z
    .string({ error: () => "note must be a string" })
    .trim()
    .min(1, "note must not be blank"),
  actorName: z
    .string({ error: () => "actorName must be a string" })
    .trim()
    .min(1, "actorName must not be blank"),
});

// ------------------------------------------------------------
// Mutation
// ------------------------------------------------------------

/**
 * Resolves one open `job_alerts` row. Validates `input` with Zod FIRST; a
 * validation failure throws a plain `Error` and never reaches the
 * database. Sets `resolved_at = now()` and `resolution_note =
 * "[<actorName>] <note>"`, guarded by `.eq("id", alertId)` AND
 * `.is("resolved_at", null)` — the second leg is what makes this an
 * acknowledge-once operation, not a plain update. `resolved_by` is never
 * set (see module comment).
 *
 * Throws `Error("alert not found or already resolved")` when the UPDATE
 * matches zero rows — either the id doesn't exist or the alert was
 * already resolved (by this same guard, possibly concurrently); the two
 * cases are indistinguishable from a single UPDATE...RETURNING and are
 * reported identically.
 */
export async function resolveJobAlert(input: ResolveJobAlertInput): Promise<void> {
  const parsed = resolveJobAlertInputSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`resolveJobAlert: invalid input — ${detail}`);
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("job_alerts")
    .update({
      resolved_at: new Date().toISOString(),
      resolution_note: `[${parsed.data.actorName}] ${parsed.data.note}`,
    })
    .eq("id", parsed.data.alertId)
    .is("resolved_at", null)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error("alert not found or already resolved");
  }
}
