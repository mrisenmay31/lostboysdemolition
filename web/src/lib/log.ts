import "server-only";

// ============================================================
// Lost Boys Demolition — web app — sync_log / job_events writers
//
// Direct port of supabase/functions/_shared/log.ts's writeSyncLog/
// writeJobEvent for the Next.js app. Same contract: BOTH writers swallow
// their own errors (console.error, never throw) — a logging failure must
// never fail (or partially fail) the estimate push it's describing. The
// caller decides what to log and when; this module only knows how to
// write it safely.
//
// `direction: "app_to_ghl"` is the value every write from this app uses —
// added by migration 20260814220000_phase_b2_ghl_push_state.sql
// specifically for the estimate builder's direct push to GHL (previously
// the sync_log_direction_check constraint only allowed the two
// Airtable-era directions plus Phase A's ghl_to_supabase/
// supabase_to_slack).
//
// Callers pass a plain `SupabaseClient`-shaped object (typed loosely, same
// as the Deno original) rather than importing @supabase/supabase-js's
// type here — keeps this module decoupled from which client flavor
// (admin vs. anon) the caller is using, though in practice push.ts always
// passes the admin client (service-role — the only client with insert
// access under RLS-enabled/no-policies tables).
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export interface SyncLogEntry {
  direction: string;
  trigger_event: string;
  action_taken: "created" | "updated" | "skipped" | "error";
  status: "success" | "error";
  error_message?: string | null;
  payload_in?: unknown;
}

export interface JobEventEntry {
  job_number: string | null;
  stage_from: number | null;
  stage_to: number;
  function_name: string;
  trigger_source: string;
  ghl_opportunity_id?: string | null;
  action_summary: string;
  status: "success" | "error" | "skipped";
  error_message?: string | null;
  payload_in?: unknown;
}

/** Writes one sync_log row. Swallows any insert error or thrown exception —
 *  logs to console.error instead of propagating, mirroring the Deno
 *  original exactly. */
export async function writeSyncLog(supabase: SupabaseLike, entry: SyncLogEntry): Promise<void> {
  try {
    const { error } = await supabase.from("sync_log").insert(entry);
    if (error) console.error("[log] sync_log insert failed:", error);
  } catch (e) {
    console.error("[log] sync_log insert failed:", e);
  }
}

/** Writes one job_events row. Same swallow-own-errors contract as
 *  writeSyncLog. */
export async function writeJobEvent(supabase: SupabaseLike, event: JobEventEntry): Promise<void> {
  try {
    const { error } = await supabase.from("job_events").insert(event);
    if (error) console.error("[log] job_events insert failed:", error);
  } catch (e) {
    console.error("[log] job_events insert failed:", e);
  }
}
