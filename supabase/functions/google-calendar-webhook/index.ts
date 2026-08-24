// ============================================================
// Lost Boys Demolition — Google Calendar inbound webhook
// Supabase Edge Function: google-calendar-webhook
// v2 Task 5B Step 2 — REAL implementation (Step-1 watch-channel spike
// PASSED 2026-08-20; this replaces that scaffold).
//
// ⚠️ DEPLOY WITH --no-verify-jwt, and read `verify_jwt` back afterwards.
// Google's push notifications carry no Supabase JWT — a bare
// `supabase functions deploy` silently flips verify_jwt to true and every
// notification 401s. This function joins ghl-job-webhook and
// integration-dispatcher in that deploy invariant.
//
// Two disjoint request paths, with DIFFERENT auth by necessity:
//   1. Google's notification — identified by X-Goog-Channel-ID. Google
//      sends no x-webhook-secret, so its auth is the channel token
//      (verified against the persisted token_hash inside
//      processNotification). ALWAYS answered 200 — a non-2xx makes Google
//      retry with backoff and then kill the channel.
//   2. Admin actions (ping/maintain/register/stop) — gated on
//      x-webhook-secret, the same shared secret the dispatcher cron uses.
//      `maintain` is what pg_cron calls on its schedule (see
//      supabase/migrations/20260824152000_schedule_calendar_maintenance.sql,
//      Lane S); register/stop remain manual operator tools, now writing/
//      updating the registry instead of only echoing the token back.
//
// Pure logic + deps-injected orchestration lives in ./handlers.ts so it can
// be unit tested without hitting the network — see handlers_test.ts.
// Handlers never read Deno.env; this file is the only env surface.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isGoogleNotification,
  processNotification,
  registerWatchChannel,
  runMaintenance,
  sha256Hex,
  stopWatchChannel,
  type InboundDeps,
  type WatchDeps,
} from "./handlers.ts";
import { getCalendarEvent, getGoogleAccessToken } from "../_shared/google.ts";

const GHL_WEBHOOK_SECRET = Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GOOGLE_SERVICE_ACCOUNT_KEY = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY") ?? "";
const GOOGLE_CALENDAR_MAIN = Deno.env.get("GOOGLE_CALENDAR_MAIN") ?? "";
const GOOGLE_CALENDAR_CREW1 = Deno.env.get("GOOGLE_CALENDAR_CREW1") ?? "";
const GOOGLE_CALENDAR_CREW2 = Deno.env.get("GOOGLE_CALENDAR_CREW2") ?? "";
const GOOGLE_CALENDAR_CREW3 = Deno.env.get("GOOGLE_CALENDAR_CREW3") ?? "";
const GOOGLE_CALENDAR_CREW4 = Deno.env.get("GOOGLE_CALENDAR_CREW4") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const webhookAddress = `${SUPABASE_URL}/functions/v1/google-calendar-webhook`;

const watchDeps: WatchDeps = {
  getAccessToken: () => getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY),
  fetchImpl: fetch,
};

const calendarIds: InboundDeps["calendarIds"] = {
  main: GOOGLE_CALENDAR_MAIN,
  crew1: GOOGLE_CALENDAR_CREW1,
  crew2: GOOGLE_CALENDAR_CREW2,
  crew3: GOOGLE_CALENDAR_CREW3,
  crew4: GOOGLE_CALENDAR_CREW4,
};

const deps: InboundDeps = {
  supabase,
  now: () => new Date(),
  getAccessToken: () => getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY),
  getCalendarEvent: (calendarId, eventId, accessToken) => getCalendarEvent(calendarId, eventId, accessToken),
  // registerWatch/stopWatch keep the spike's registerWatchChannel/
  // stopWatchChannel HTTP shapes (WatchDeps: getAccessToken + fetchImpl) —
  // this just adapts InboundDeps' simpler per-call signature onto them, so
  // maintainChannels never has to know about WatchDeps or `now: Date.now()`.
  registerWatch: (calendarId, channelId, address, token, ttlSeconds) =>
    registerWatchChannel(watchDeps, { calendarId, channelId, address, token, ttlSeconds, now: Date.now() }),
  stopWatch: (channelId, resourceId) => stopWatchChannel(watchDeps, { channelId, resourceId }),
  calendarIds,
  webhookAddress,
};

Deno.serve(async (req) => {
  // ── Path 1: Google push notification — ALWAYS 200 ──────────────────────
  if (isGoogleNotification(req.headers)) {
    try {
      await processNotification(deps, req.headers);
    } catch (err) {
      // Defense in depth: processNotification already catches internally
      // and never rejects. If it somehow does, a non-2xx here would still
      // make Google retry then kill the channel — so this must never
      // surface as anything but a 200.
      console.error(
        "[google-calendar-webhook] unexpected notification error:",
        (err as any)?.message ?? String(err),
      );
    }
    return json(200, { received: true });
  }

  // ── Path 2: admin actions ───────────────────────────────────────────────
  if (req.headers.get("x-webhook-secret") !== GHL_WEBHOOK_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  let payload: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) payload = JSON.parse(text);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const action = String(payload.action ?? "ping");

  try {
    if (action === "ping") {
      return json(200, {
        ok: true,
        action,
        serviceAccountConfigured: GOOGLE_SERVICE_ACCOUNT_KEY.length > 0,
        calendarsConfigured: {
          main: GOOGLE_CALENDAR_MAIN.length > 0,
          crew1: GOOGLE_CALENDAR_CREW1.length > 0,
          crew2: GOOGLE_CALENDAR_CREW2.length > 0,
          crew3: GOOGLE_CALENDAR_CREW3.length > 0,
          crew4: GOOGLE_CALENDAR_CREW4.length > 0,
        },
        webhookAddress,
      });
    }

    if (action === "maintain") {
      const summary = await runMaintenance(deps);
      return json(200, { ok: true, action, ...summary });
    }

    if (action === "register") {
      const calendarKey = String(payload.calendarKey ?? "main") as keyof typeof calendarIds;
      const calendarId = calendarIds[calendarKey];
      if (!calendarId) return json(400, { error: `no calendar configured for "${calendarKey}"` });

      const channelId = String(payload.channelId ?? `lbd-${calendarKey}-${crypto.randomUUID()}`);
      const token = String(payload.token ?? crypto.randomUUID());
      const ttlSeconds = Number(payload.ttlSeconds ?? 604800);

      const attempt = await registerWatchChannel(watchDeps, {
        calendarId,
        channelId,
        address: webhookAddress,
        token,
        ttlSeconds,
        now: Date.now(),
      });

      console.log(
        "[google-calendar-webhook] manual WATCH ATTEMPT " +
          JSON.stringify({ ok: attempt.ok, httpStatus: attempt.httpStatus, calendarKey, calendarId }),
      );

      if (attempt.ok) {
        const tokenHash = await sha256Hex(token);
        const resourceId = (attempt.body as any)?.resourceId ?? "";
        const expiration = (attempt.body as any)?.expiration
          ? new Date(Number((attempt.body as any).expiration)).toISOString()
          : new Date(Date.now() + ttlSeconds * 1000).toISOString();

        // Manual registration follows the same registry invariant as
        // maintainChannels: at most one ACTIVE row per calendar. Supersede
        // any existing active row first so the DB's partial unique index
        // doesn't reject the insert below.
        await supabase
          .from("calendar_watch_channels")
          .update({ status: "superseded" })
          .eq("calendar_id", calendarId)
          .eq("status", "active");
        await supabase.from("calendar_watch_channels").insert({
          channel_id: channelId,
          resource_id: resourceId,
          calendar_id: calendarId,
          token_hash: tokenHash,
          expires_at: expiration,
          status: "active",
        });
      }

      // Token itself is intentionally NOT echoed back (unlike the Step-1
      // spike) — only its hash is ever persisted, and there is no longer a
      // legitimate reason for an operator response to carry the raw value.
      return json(200, { ok: attempt.ok, httpStatus: attempt.httpStatus, channelId, calendarKey, calendarId });
    }

    if (action === "stop") {
      const channelId = String(payload.channelId ?? "");
      const resourceId = String(payload.resourceId ?? "");
      if (!channelId || !resourceId) return json(400, { error: "channelId and resourceId are required" });
      const result = await stopWatchChannel(watchDeps, { channelId, resourceId });
      await supabase.from("calendar_watch_channels").update({ status: "expired" }).eq("channel_id", channelId);
      return json(200, result);
    }

    return json(400, { error: `unknown action: ${action}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[google-calendar-webhook]", msg);
    return json(500, { error: msg });
  }
});
