// ============================================================
// Lost Boys Demolition — Night-before crew digest
// Supabase Edge Function: crew-night-before
//
// Replaces the hand-typed night-before Slack message (the one Zapier used to
// send unreliably, per CLAUDE.md's Zapier note). Invoked twice a day by
// pg_cron (22:30 and 23:30 UTC — see the accompanying migration) so that one
// fire always lands on 16:00 America/Denver local time regardless of DST;
// the other is a no-op via the isInSendWindow gate in handlers.ts.
//
// Body contract: {} normally (cron); {force: true} bypasses the send-window
// gate for manual/manual-live-verify invocation at any hour.
//
// Pure logic + deps-injected orchestration lives in ./handlers.ts (imported
// below) so it can be unit tested without triggering the network calls this
// file makes. See handlers_test.ts for the RED/GREEN TDD suite.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeSyncLog } from "../_shared/log.ts";
import {
  parseRequestBody,
  runNightBeforeDigest,
  type JobRow,
  type NightBeforeDeps,
} from "./handlers.ts";

const GHL_WEBHOOK_SECRET   = Deno.env.get("GHL_WEBHOOK_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_BOT_TOKEN      = Deno.env.get("SLACK_BOT_TOKEN") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Side-effecting deps (not unit tested directly; exercised via
//    runNightBeforeDigest's injected deps in handlers_test.ts) ────────────────

async function fetchScheduledJobs(tomorrow: string): Promise<JobRow[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, job_number, job_name, job_address, client_name, start_date, crew")
    .eq("status_v2", "scheduled")
    .eq("start_date", tomorrow)
    .or(`night_before_sent_on.is.null,night_before_sent_on.neq.${tomorrow}`);

  if (error) throw new Error(`fetchScheduledJobs failed: ${error.message ?? String(error)}`);
  return (data ?? []) as JobRow[];
}

function getChannelEnv(envVarName: string): string | undefined {
  return Deno.env.get(envVarName) || undefined;
}

async function postSlackMessage(channel: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json();
  console.log("[slack] post message response:", JSON.stringify(data));
  return { ok: data.ok === true, error: data.error };
}

async function updateSentOn(jobIds: string[], sentOn: string): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from("jobs")
    .update({ night_before_sent_on: sentOn })
    .in("id", jobIds);
  return { error };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const incomingSecret = req.headers.get("x-webhook-secret");
  if (incomingSecret !== GHL_WEBHOOK_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const { force } = parseRequestBody(raw);

  const deps: NightBeforeDeps = {
    fetchScheduledJobs,
    getChannelEnv,
    postSlackMessage,
    updateSentOn,
    writeLog: (entry) => writeSyncLog(supabase, entry),
    now: new Date(),
    force,
  };

  try {
    const result = await runNightBeforeDigest(deps);
    return json(result.status, result.body);
  } catch (err: any) {
    const msg = err.message ?? String(err);
    console.error("[error] crew-night-before:", msg);
    await writeSyncLog(supabase, {
      direction: "supabase_to_slack",
      trigger_event: "night_before_digest",
      action_taken: "error",
      status: "error",
      error_message: msg,
      payload_in: raw,
    });
    return json(500, { success: false, error: msg });
  }
});
