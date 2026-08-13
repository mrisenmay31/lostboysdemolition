// Both writers swallow their own errors: logging failure must never 500 a handler.
export async function writeSyncLog(supabase: any, entry: {
  direction: string; trigger_event: string;
  action_taken: "created" | "updated" | "skipped" | "error";
  status: "success" | "error"; error_message?: string | null; payload_in?: unknown;
}) {
  try { await supabase.from("sync_log").insert(entry); }
  catch (e) { console.error("[log] sync_log insert failed:", e); }
}

export async function writeJobEvent(supabase: any, event: {
  job_number: string | null; stage_from: number | null; stage_to: number;
  function_name: string; trigger_source: string; ghl_opportunity_id?: string | null;
  action_summary: string; status: "success" | "error" | "skipped";
  error_message?: string | null; payload_in?: unknown;
}) {
  try { await supabase.from("job_events").insert(event); }
  catch (e) { console.error("[log] job_events insert failed:", e); }
}
