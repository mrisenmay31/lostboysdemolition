// ============================================================
// Lost Boys Demolition — GHL Workflow Webhook → Supabase Jobs (keystone)
// Supabase Edge Function: ghl-job-webhook
//
// Body contract: {event: 'quote_accepted' | 'job_scheduled', opportunityId: string}
// This function owns its own contract rather than GHL's — the GHL workflow's
// custom-data config (Task 6) maps GHL's native payload into this shape.
//
// Pure logic + deps-injected orchestration lives in ./handlers.ts (imported
// below) so it can be unit tested without triggering the network calls this
// file makes at cold start.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  findStageId,
  handleJobScheduled,
  handleQuoteAccepted,
  parseWebhookBody,
  type JobScheduledDeps,
  type QuoteAcceptedDeps,
} from "./handlers.ts";
import { createCalendarEvent, getGoogleAccessToken } from "../_shared/google.ts";
import { writeSyncLog } from "../_shared/log.ts";

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

// Empty string is treated the same as "unset" — a blank secret should gate
// the BILL leg off ('skipped'), not attempt calls with an empty apiToken.
const BILL_API_TOKEN = Deno.env.get("BILL_API_TOKEN") || null;

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_AUTH = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: "2021-07-28",
};

// ── Cold start: resolve "Job Pipeline" and its Quote Accepted / Job Scheduled
//    stage IDs. `PIPELINE` is set as soon as "Job Pipeline" itself is found —
//    fix round 1 (I5, controller ruling): a missing individual stage ID is
//    NOT fatal here. The create path (quote_accepted) uses neither stage ID
//    at all; only the future job_scheduled path (Task 4) will require
//    jobScheduledStageId, and it will enforce that itself when built. Both
//    stage names are still resolved and logged now for visibility. ─────────

interface PipelineCache {
  pipelineId:           string;
  quoteAcceptedStageId: string | null;
  jobScheduledStageId:  string | null;
}

let PIPELINE: PipelineCache | null = null;
let STARTUP_ERROR: string | null = null;

try {
  const pipelineRes  = await fetch(
    `${GHL_BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`,
    { headers: GHL_AUTH },
  );
  const pipelineData = await pipelineRes.json();
  console.log("[startup] GHL pipelines response:", JSON.stringify(pipelineData));

  const list     = pipelineData.pipelines ?? (Array.isArray(pipelineData) ? pipelineData : []);
  const pipeline = list.find((p: any) => p.name === "Job Pipeline");

  if (!pipeline) {
    STARTUP_ERROR = `Pipeline "Job Pipeline" not found. Available: ${list.map((p: any) => p.name).join(", ") || "none"}`;
    console.error("[startup]", STARTUP_ERROR);
  } else {
    const stages = pipeline.stages ?? [];
    console.log(
      "[startup] Job Pipeline stages:",
      JSON.stringify(stages.map((s: any) => ({ id: s.id, name: s.name }))),
    );

    const quoteAcceptedStageId = findStageId(stages, "quote accepted");
    const jobScheduledStageId  = findStageId(stages, "job scheduled");

    console.log(`[startup] Matched "Quote Accepted" substring -> ${quoteAcceptedStageId ?? "NOT FOUND"}`);
    console.log(`[startup] Matched "Job Scheduled" substring -> ${jobScheduledStageId ?? "NOT FOUND"}`);
    if (!quoteAcceptedStageId) {
      console.warn('[startup] "Quote Accepted" stage not matched — non-fatal, the create path uses neither stage ID.');
    }
    if (!jobScheduledStageId) {
      console.warn('[startup] "Job Scheduled" stage not matched — non-fatal for now; Task 4\'s schedule path will need it.');
    }

    // Pipeline itself resolved — set the cache regardless of stage-match outcome.
    PIPELINE = { pipelineId: pipeline.id, quoteAcceptedStageId, jobScheduledStageId };
    console.log("[startup] Resolved pipeline:", JSON.stringify(PIPELINE));
  }
} catch (err: any) {
  STARTUP_ERROR = `Pipeline resolution failed: ${err.message ?? String(err)}`;
  console.error("[startup]", STARTUP_ERROR);
}

// ── GHL HTTP helpers (side-effecting — not unit tested directly; exercised
//    via handleQuoteAccepted's injected deps in handlers_test.ts) ─────────────

async function fetchGhlOpportunity(id: string) {
  const res  = await fetch(`${GHL_BASE}/opportunities/${id}`, { headers: GHL_AUTH });
  const data = await res.json();
  console.log("[ghl] opportunity fetch:", JSON.stringify(data));
  if (!res.ok) throw new Error(`GHL opportunity fetch failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function fetchGhlContact(id: string) {
  const res  = await fetch(`${GHL_BASE}/contacts/${id}`, { headers: GHL_AUTH });
  const data = await res.json();
  console.log("[ghl] contact fetch:", JSON.stringify(data));
  if (!res.ok) throw new Error(`GHL contact fetch failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function updateGhlOpportunity(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${GHL_BASE}/opportunities/${id}`, {
    method:  "PUT",
    headers: { ...GHL_AUTH, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  console.log("[ghl] opportunity update response:", JSON.stringify(data));
  if (!res.ok) throw new Error(`GHL opportunity update failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Job Scheduled integrations (side-effecting — not unit tested directly;
//    exercised via handleJobScheduled's injected deps in handlers_test.ts) ────

async function getAccessTokenReal(): Promise<string> {
  return getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY);
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

// ── BILL Spend & Expense v3 — job-code custom field (gated on BILL_API_TOKEN) ──
// Endpoint set per INTEGRATION_DESIGN.md / controller ruling: list-first via
// GET /v3/spend/custom-fields, create via POST if the "Lost Boys Job ID"
// selector doesn't exist yet, then add the job name as a value on it.
// ASSUMPTION FLAGGED FOR LIVE-VERIFY: the "add a value to a CUSTOM_SELECTOR"
// endpoint/shape (POST /v3/spend/custom-fields/{id}/values) is not documented
// anywhere in this repo — BILL v3's public docs weren't available to consult
// here. This is a best-effort shape; confirm against developer.bill.com
// before relying on it, and expect to adjust the path/body once BILL creds
// exist (today BILL_API_TOKEN is unset in every environment, so this leg has
// never actually run against BILL).
const BILL_BASE = "https://gateway.prod.bill.com/connect";
const BILL_JOB_ID_FIELD_NAME = "Lost Boys Job ID";

async function billApiFetch(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${BILL_BASE}${path}`, {
    ...init,
    headers: {
      apiToken: BILL_API_TOKEN ?? "",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  console.log(`[bill] ${init.method ?? "GET"} ${path} ->`, res.status, JSON.stringify(data));
  return { ok: res.ok, status: res.status, data };
}

async function ensureBillJobCodeReal(jobName: string): Promise<{ status: "success" | "error"; error?: string }> {
  try {
    const listRes = await billApiFetch("/v3/spend/custom-fields", { method: "GET" });
    if (!listRes.ok) {
      throw new Error(`BILL list custom fields failed (${listRes.status}): ${JSON.stringify(listRes.data)}`);
    }
    const fields = Array.isArray(listRes.data) ? listRes.data : (listRes.data?.results ?? []);
    let field = fields.find((f: any) => f?.name === BILL_JOB_ID_FIELD_NAME);

    if (!field) {
      const createRes = await billApiFetch("/v3/spend/custom-fields", {
        method: "POST",
        body: JSON.stringify({ name: BILL_JOB_ID_FIELD_NAME, type: "CUSTOM_SELECTOR", allowCustomValues: true }),
      });
      if (!createRes.ok) {
        throw new Error(`BILL create custom field failed (${createRes.status}): ${JSON.stringify(createRes.data)}`);
      }
      field = createRes.data;
    }

    const fieldId = field?.id ?? field?.uuid;
    if (!fieldId) throw new Error("BILL custom field response had no id/uuid");

    const valueRes = await billApiFetch(`/v3/spend/custom-fields/${fieldId}/values`, {
      method: "POST",
      body: JSON.stringify({ value: jobName }),
    });
    if (!valueRes.ok) {
      throw new Error(`BILL add custom field value failed (${valueRes.status}): ${JSON.stringify(valueRes.data)}`);
    }

    return { status: "success" };
  } catch (err: any) {
    const msg = err.message ?? String(err);
    console.error("[bill] ensureBillJobCode failed (non-fatal):", msg);
    return { status: "error", error: msg };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const incomingSecret = req.headers.get("x-webhook-secret");
  if (incomingSecret !== GHL_WEBHOOK_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  // I4: created before the STARTUP_ERROR gate so a startup failure can still
  // be written to sync_log instead of leaving no DB trace at all.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Cleanup (controller ruling, fix round 2, I8a): the outer catch below used
  // to hardcode trigger_event:'quote_accepted' and omit payload_in, which was
  // wrong for any failure on the job_scheduled path (or one that occurred
  // before parseWebhookBody ran at all). Both are hoisted here so the catch
  // can log the real event (falling back to 'unknown' pre-parse) and the raw
  // payload whenever it was successfully read.
  let raw: unknown;
  let parsedEvent = "unknown";

  try {
    try {
      raw = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const parsed = parseWebhookBody(raw);
    if ("error" in parsed) {
      return json(400, { error: parsed.error });
    }
    parsedEvent = parsed.event;

    // I5 (controller ruling): gate is per-event in spirit — PIPELINE is only
    // ever null when "Job Pipeline" itself failed to resolve (a hard startup
    // failure), which blocks every event. A missing individual stage ID does
    // NOT null out PIPELINE (see cold-start block above), so quote_accepted
    // proceeds even when only one of the two stage names matched.
    if (!PIPELINE) {
      const msg = STARTUP_ERROR ?? "Pipeline not resolved — check startup logs";
      console.error("[handler] Aborting: pipeline not ready.", msg);
      await writeSyncLog(supabase, {
        direction:      "ghl_to_supabase",
        trigger_event:  parsed.event,
        action_taken:   "error",
        status:         "error",
        error_message:  msg,
        payload_in:     raw,
      });
      return json(500, { success: false, error: msg });
    }

    if (parsed.event === "job_scheduled") {
      // Task 4 controller ruling: this gate belongs to the schedule path only
      // — quote_accepted proceeds even when jobScheduledStageId didn't
      // resolve (see the PIPELINE check above), but job_scheduled itself
      // requires it and must 500 with a sync_log write if it's still null.
      if (!PIPELINE.jobScheduledStageId) {
        const msg = 'GHL stage "Job Scheduled" not resolved — check startup logs';
        console.error("[handler] Aborting job_scheduled:", msg);
        await writeSyncLog(supabase, {
          direction:     "ghl_to_supabase",
          trigger_event: "job_scheduled",
          action_taken:  "error",
          status:        "error",
          error_message: msg,
          payload_in:    raw,
        });
        return json(500, { success: false, error: msg });
      }

      const scheduledDeps: JobScheduledDeps = {
        supabase,
        fetchOpportunity: fetchGhlOpportunity,
        getAccessToken:   getAccessTokenReal,
        createCalendarEvent,
        calendarIds: {
          main:  GOOGLE_CALENDAR_MAIN,
          crew1: GOOGLE_CALENDAR_CREW1,
          crew2: GOOGLE_CALENDAR_CREW2,
          crew3: GOOGLE_CALENDAR_CREW3,
          crew4: GOOGLE_CALENDAR_CREW4,
        },
        postSlackMessage,
        slackChannels: {
          crew1: SLACK_CREW1_CHANNEL,
          crew2: SLACK_CREW2_CHANNEL,
          crew3: SLACK_CREW3_CHANNEL,
          crew4: SLACK_CREW4_CHANNEL,
        },
        billApiToken:     BILL_API_TOKEN,
        ensureBillJobCode: ensureBillJobCodeReal,
        payloadIn:        raw,
      };

      const result = await handleJobScheduled(scheduledDeps, parsed.opportunityId);
      return json(result.status, result.body);
    }

    const deps: QuoteAcceptedDeps = {
      supabase,
      fetchOpportunity: fetchGhlOpportunity,
      fetchContact:     fetchGhlContact,
      updateOpportunity: updateGhlOpportunity,
      payloadIn:        raw,
    };

    const result = await handleQuoteAccepted(deps, parsed.opportunityId);
    return json(result.status, result.body);
  } catch (err: any) {
    // I1: outer safety net for the request handler itself. handleQuoteAccepted
    // and handleJobScheduled each have their own outer catch, so this only
    // fires for failures outside them (req.json/parseWebhookBody edge cases,
    // deps construction, etc).
    const msg = `Unexpected error in ghl-job-webhook: ${err.message ?? String(err)}`;
    console.error("[handler]", msg);
    await writeSyncLog(supabase, {
      direction:     "ghl_to_supabase",
      trigger_event: parsedEvent,
      action_taken:  "error",
      status:        "error",
      error_message: msg,
      payload_in:    raw,
    });
    return json(500, { success: false, error: msg });
  }
});
