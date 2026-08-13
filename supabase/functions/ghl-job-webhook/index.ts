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
  handleQuoteAccepted,
  parseWebhookBody,
  type QuoteAcceptedDeps,
} from "./handlers.ts";
import { writeSyncLog } from "../_shared/log.ts";

const GHL_API_KEY          = Deno.env.get("GHL_API_KEY")!;
const GHL_LOCATION_ID      = Deno.env.get("GHL_LOCATION_ID")!;
const GHL_WEBHOOK_SECRET   = Deno.env.get("GHL_WEBHOOK_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const incomingSecret = req.headers.get("x-webhook-secret");
  if (incomingSecret !== GHL_WEBHOOK_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  // I4: created before the STARTUP_ERROR gate so a startup failure can still
  // be written to sync_log instead of leaving no DB trace at all.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const parsed = parseWebhookBody(raw);
    if ("error" in parsed) {
      return json(400, { error: parsed.error });
    }

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
      // Task 4 will implement handleJobScheduled — same routing shape as below.
      return json(501, { error: "not implemented yet" });
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
    // has its own outer catch, so this only fires for failures outside it
    // (req.json/parseWebhookBody edge cases, deps construction, etc).
    const msg = `Unexpected error in ghl-job-webhook: ${err.message ?? String(err)}`;
    console.error("[handler]", msg);
    await writeSyncLog(supabase, {
      direction:     "ghl_to_supabase",
      trigger_event: "quote_accepted",
      action_taken:  "error",
      status:        "error",
      error_message: msg,
    });
    return json(500, { success: false, error: msg });
  }
});
