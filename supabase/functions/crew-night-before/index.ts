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
import { postSlackMessage as sharedPostSlackMessage } from "../_shared/slack.ts";
import {
  parseRequestBody,
  runNightBeforeDigest,
  type JobRow,
  type NightBeforeDeps,
  type SyncLogEntry,
} from "./handlers.ts";

const GHL_WEBHOOK_SECRET   = Deno.env.get("GHL_WEBHOOK_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_BOT_TOKEN      = Deno.env.get("SLACK_BOT_TOKEN") ?? "";

// Test-only channel override: when set, ALL crew digests redirect to this one
// channel instead of the real SLACK_CREWn_CHANNEL secrets. Mirrors the
// BILL_API_TOKEN gating pattern — absent in every normal environment. This is
// how the BL-4 live E2E is routed to a scratch channel instead of a real crew.
//
// L2 fix (BL-4 adversarial review): .trim() — without it a whitespace-only
// value (e.g. " ") stayed truthy under `|| ""` and became a bogus channel ID,
// silently failing every post with channel_not_found instead of behaving as
// "unset".
const SLACK_TEST_CHANNEL_OVERRIDE = (Deno.env.get("SLACK_TEST_CHANNEL_OVERRIDE") ?? "").trim();

// M2 fix (BL-4 adversarial review), part (a): startup warning, parity with
// ghl-job-webhook/index.ts's identical override — the only signal previously
// was a per-call console.warn inside getChannelEnv, easy to miss in cold-start
// logs. Also the single source of truth for whether this run is redirected;
// threaded into NightBeforeDeps.testChannelOverride (H1 fix) and into every
// sync_log payload_in via wrapWriteLogForOverride below (M2 part b).
const testChannelOverride = SLACK_TEST_CHANNEL_OVERRIDE.length > 0;
if (testChannelOverride) {
  console.warn(
    `[startup] SLACK_TEST_CHANNEL_OVERRIDE is set (${SLACK_TEST_CHANNEL_OVERRIDE}) — ALL crew Slack ` +
      "digests will be redirected to this one channel and night_before_sent_on will NOT be stamped. " +
      "This must NOT be set in normal operation.",
  );
}

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
    .select(
      "id, job_number, job_name, job_address, client_name, start_date, crew, client_contact_name, business_name, client_phone, start_time, scope_summary",
    )
    .eq("status_v2", "scheduled")
    .eq("start_date", tomorrow)
    .or(`night_before_sent_on.is.null,night_before_sent_on.neq.${tomorrow}`)
    // Accepted minor (a), fix round 1: deterministic digest order.
    .order("job_number", { ascending: true });

  if (error) throw new Error(`fetchScheduledJobs failed: ${error.message ?? String(error)}`);
  return (data ?? []) as JobRow[];
}

function getChannelEnv(envVarName: string): string | undefined {
  if (testChannelOverride) {
    console.warn(
      `[crew-night-before] SLACK_TEST_CHANNEL_OVERRIDE is set — crew Slack for "${envVarName}" ` +
        `is redirected to a test channel. This must NOT be set in normal operation.`,
    );
    return SLACK_TEST_CHANNEL_OVERRIDE;
  }
  return Deno.env.get(envVarName) || undefined;
}

async function postSlackMessage(channel: string, text: string): Promise<{ ok: boolean; error?: string }> {
  return await sharedPostSlackMessage(SLACK_BOT_TOKEN, channel, text);
}

// M2 fix (BL-4 adversarial review), part (b): tag every sync_log row written
// during a redirected run with `test_channel_override: true` in payload_in,
// so a redirected send is distinguishable from a real one after the fact —
// without touching any of the six writeLog call sites inside
// runNightBeforeDigest (out of scope for this fix; see H1's own payload_in
// addition on the created/stamp-suppressed row for the one call site that
// IS in scope). Merges rather than overwrites in case payload_in is already
// an object (e.g. H1's stamped:false/skip_reason on the override path);
// non-object/absent payload_in is replaced with a fresh object carrying just
// the tag, never dropped.
function wrapWriteLogForOverride(
  writeLog: (entry: SyncLogEntry) => Promise<void>,
): (entry: SyncLogEntry) => Promise<void> {
  if (!testChannelOverride) return writeLog;
  return (entry: SyncLogEntry) => {
    const basePayload =
      typeof entry.payload_in === "object" && entry.payload_in !== null
        ? (entry.payload_in as Record<string, unknown>)
        : {};
    return writeLog({
      ...entry,
      payload_in: { ...basePayload, test_channel_override: true },
    });
  };
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
    writeLog: wrapWriteLogForOverride((entry) => writeSyncLog(supabase, entry)),
    now: new Date(),
    force,
    testChannelOverride,
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
