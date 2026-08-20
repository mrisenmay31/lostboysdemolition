// ============================================================
// Lost Boys Demolition — Integration Outbox Dispatcher
// Supabase Edge Function: integration-dispatcher
//
// ⚠️ DEPLOY WITH --no-verify-jwt. This function is invoked by pg_cron (or
// any other scheduled trigger) with no JWT on the request — mirrors the
// deploy invariant already documented in CLAUDE.md for ghl-job-webhook. A
// bare `supabase functions deploy` silently flips verify_jwt back to true
// and 401s every scheduled call; always read back `verify_jwt` after
// deploying.
//
// Consumes rows from the v2 Task 5 `integration_outbox` table (schema +
// `claim_integration_events` RPC owned by a sibling migrations lane) and
// dispatches each to Google Calendar / Slack / GHL depending on event_type
// (job.scheduled, ghl.stage.requested, job.cancelled). Pure logic +
// deps-injected orchestration lives in ./handlers.ts so it can be unit
// tested without hitting the network — see handlers_test.ts. Handlers never
// read Deno.env; this file is the only env surface.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runDispatch, type DispatcherDeps, type GhlPipeline } from "./handlers.ts";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getGoogleAccessToken,
  updateCalendarEvent,
} from "../_shared/google.ts";
import { postSlackMessage } from "../_shared/slack.ts";

const GHL_API_KEY          = Deno.env.get("GHL_API_KEY")!;
const GHL_LOCATION_ID      = Deno.env.get("GHL_LOCATION_ID")!;
const GHL_WEBHOOK_SECRET   = Deno.env.get("GHL_WEBHOOK_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GOOGLE_SERVICE_ACCOUNT_KEY = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY") ?? "";
const GOOGLE_CALENDAR_MAIN       = Deno.env.get("GOOGLE_CALENDAR_MAIN")        ?? "";
const GOOGLE_CALENDAR_CREW1      = Deno.env.get("GOOGLE_CALENDAR_CREW1")       ?? "";
const GOOGLE_CALENDAR_CREW2      = Deno.env.get("GOOGLE_CALENDAR_CREW2")       ?? "";
const GOOGLE_CALENDAR_CREW3      = Deno.env.get("GOOGLE_CALENDAR_CREW3")       ?? "";
const GOOGLE_CALENDAR_CREW4      = Deno.env.get("GOOGLE_CALENDAR_CREW4")       ?? "";

const SLACK_BOT_TOKEN       = Deno.env.get("SLACK_BOT_TOKEN")        ?? "";
const SLACK_CREW1_CHANNEL   = Deno.env.get("SLACK_CREW1_CHANNEL")    ?? "";
const SLACK_CREW2_CHANNEL   = Deno.env.get("SLACK_CREW2_CHANNEL")    ?? "";
const SLACK_CREW3_CHANNEL   = Deno.env.get("SLACK_CREW3_CHANNEL")    ?? "";
const SLACK_CREW4_CHANNEL   = Deno.env.get("SLACK_CREW4_CHANNEL")    ?? "";

// Test-only escape hatch, gating pattern mirrors ghl-job-webhook /
// crew-night-before's identical override — must never be set in normal
// operation. When set, ALL FOUR crew Slack channels resolve to this one
// channel instead.
const SLACK_TEST_CHANNEL_OVERRIDE = (Deno.env.get("SLACK_TEST_CHANNEL_OVERRIDE") ?? "").trim();
if (SLACK_TEST_CHANNEL_OVERRIDE) {
  console.warn(
    `[startup] SLACK_TEST_CHANNEL_OVERRIDE is set (${SLACK_TEST_CHANNEL_OVERRIDE}) — ALL crew Slack ` +
      "messages will be redirected to this one channel. This must NOT be set in normal operation.",
  );
}

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_AUTH = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: "2021-07-28",
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Side-effecting deps (not unit tested directly; exercised via
//    runDispatch's injected deps in handlers_test.ts) ───────────────────────

async function getAccessTokenReal(): Promise<string> {
  return getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY);
}

async function fetchGhlPipelines(): Promise<GhlPipeline[]> {
  const res = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, {
    headers: GHL_AUTH,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GHL pipelines fetch failed (${res.status}): ${JSON.stringify(data)}`);
  const list = data.pipelines ?? (Array.isArray(data) ? data : []);
  return list.map((p: any) => ({
    id: p.id,
    name: p.name,
    stages: (p.stages ?? []).map((s: any) => ({ id: s.id, name: s.name })),
  }));
}

async function fetchGhlOpportunity(id: string) {
  const res = await fetch(`${GHL_BASE}/opportunities/${id}`, { headers: GHL_AUTH });
  const data = await res.json();
  if (!res.ok) throw new Error(`GHL opportunity fetch failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

// GHL PUT merges customFields (live-verified during Phase B slice-2 / CV-2)
// — this dispatcher only ever needs to move the pipeline stage, so the body
// sends ONLY { pipelineStageId }, never a broader payload that could
// clobber a field another writer owns.
async function updateGhlOpportunityStage(id: string, stageId: string) {
  const res = await fetch(`${GHL_BASE}/opportunities/${id}`, {
    method: "PUT",
    headers: { ...GHL_AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ pipelineStageId: stageId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GHL opportunity stage update failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

// ── Main handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const incomingSecret = req.headers.get("x-webhook-secret");
  if (incomingSecret !== GHL_WEBHOOK_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  // Optional {limit: number} body — omitted/absent means runDispatch's own
  // default (20). Mirrors crew-night-before's tolerant empty-body handling
  // (cron invocations send no body at all).
  let limit: number | undefined;
  try {
    const text = await req.text();
    if (text) {
      const parsed = JSON.parse(text);
      if (typeof parsed?.limit === "number") limit = parsed.limit;
    }
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const deps: DispatcherDeps = {
    supabase,
    now: () => new Date(),
    getAccessToken: getAccessTokenReal,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    calendarIds: {
      main:  GOOGLE_CALENDAR_MAIN,
      crew1: GOOGLE_CALENDAR_CREW1,
      crew2: GOOGLE_CALENDAR_CREW2,
      crew3: GOOGLE_CALENDAR_CREW3,
      crew4: GOOGLE_CALENDAR_CREW4,
    },
    postSlackMessage: (channel: string, text: string) => postSlackMessage(SLACK_BOT_TOKEN, channel, text),
    slackChannels: {
      crew1: SLACK_TEST_CHANNEL_OVERRIDE || SLACK_CREW1_CHANNEL,
      crew2: SLACK_TEST_CHANNEL_OVERRIDE || SLACK_CREW2_CHANNEL,
      crew3: SLACK_TEST_CHANNEL_OVERRIDE || SLACK_CREW3_CHANNEL,
      crew4: SLACK_TEST_CHANNEL_OVERRIDE || SLACK_CREW4_CHANNEL,
    },
    fetchPipelines: fetchGhlPipelines,
    fetchOpportunity: fetchGhlOpportunity,
    updateOpportunityStage: updateGhlOpportunityStage,
  };

  try {
    const summary = await runDispatch(deps, { limit });
    return json(200, summary as unknown as Record<string, unknown>);
  } catch (err: any) {
    const msg = `Unexpected error in integration-dispatcher: ${err?.message ?? String(err)}`;
    console.error("[handler]", msg);
    return json(500, { success: false, error: msg });
  }
});
