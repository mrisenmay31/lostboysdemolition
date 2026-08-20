// ============================================================
// Lost Boys Demolition — Google Calendar inbound webhook
// Supabase Edge Function: google-calendar-webhook
// v2 Task 5B (phase-1 plan Task 6) — STEP 1 SPIKE SCAFFOLD ONLY.
// See handlers.ts for what this is and what it deliberately is not.
//
// ⚠️ DEPLOY WITH --no-verify-jwt, and read `verify_jwt` back afterwards.
// Google's push notifications carry no Supabase JWT — a bare
// `supabase functions deploy` silently flips verify_jwt to true and every
// notification 401s. This function joins ghl-job-webhook and
// integration-dispatcher in that deploy invariant (phase-1 plan
// deviation 6).
//
// Two disjoint request paths, with DIFFERENT auth by necessity:
//   1. Google's notification  — identified by X-Goog-Channel-ID. Google
//      sends no x-webhook-secret, so its auth is the channel token.
//      During the spike the token is only LOGGED and echoed, never
//      enforced — persistence + verification is Step 2's registry work.
//   2. Admin actions (register/stop/ping) — gated on x-webhook-secret,
//      same shared secret the dispatcher cron uses.
// ============================================================

import {
  extractNotification,
  isGoogleNotification,
  registerWatchChannel,
  stopWatchChannel,
  type WatchDeps,
} from "./handlers.ts";
import { getGoogleAccessToken } from "../_shared/google.ts";

const WEBHOOK_SECRET = Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
const GOOGLE_SERVICE_ACCOUNT_KEY = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY") ?? "";
const GOOGLE_CALENDAR_MAIN = Deno.env.get("GOOGLE_CALENDAR_MAIN") ?? "";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const deps: WatchDeps = {
  getAccessToken: () => getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY),
  fetchImpl: fetch,
};

Deno.serve(async (req) => {
  // ── Path 1: Google push notification ────────────────────────────────
  // Answered FIRST and unconditionally 200, because a non-2xx makes Google
  // retry with backoff and then kill the channel — during a spike that
  // would destroy the very signal being measured.
  if (isGoogleNotification(req.headers)) {
    const n = extractNotification(req.headers);
    const rawBody = await req.text().catch(() => "");
    console.log(
      "[google-calendar-webhook][SPIKE] NOTIFICATION RECEIVED " +
        JSON.stringify({
          channelId: n.channelId,
          resourceState: n.resourceState,
          messageNumber: n.messageNumber,
          resourceId: n.resourceId,
          resourceUri: n.resourceUri,
          channelExpiration: n.channelExpiration,
          tokenPresent: n.channelToken !== null,
          token: n.channelToken,
          bodyLength: rawBody.length,
          body: rawBody.slice(0, 500),
        }),
    );
    return json(200, { received: true });
  }

  // ── Path 2: admin actions ───────────────────────────────────────────
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
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
      // Config presence only — never the values.
      return json(200, {
        ok: true,
        action,
        serviceAccountConfigured: GOOGLE_SERVICE_ACCOUNT_KEY.length > 0,
        mainCalendarConfigured: GOOGLE_CALENDAR_MAIN.length > 0,
      });
    }

    if (action === "register") {
      const calendarId = String(payload.calendarId ?? "") || GOOGLE_CALENDAR_MAIN;
      if (!calendarId) return json(400, { error: "no calendarId and GOOGLE_CALENDAR_MAIN unset" });
      const address = String(payload.address ?? "");
      if (!address) return json(400, { error: "address is required" });
      const channelId = String(payload.channelId ?? crypto.randomUUID());
      const token = String(payload.token ?? crypto.randomUUID());
      const ttlSeconds = Number(payload.ttlSeconds ?? 3600);

      const attempt = await registerWatchChannel(deps, {
        calendarId,
        channelId,
        address,
        token,
        ttlSeconds,
        now: Date.now(),
      });
      console.log(
        "[google-calendar-webhook][SPIKE] WATCH ATTEMPT " +
          JSON.stringify({ ok: attempt.ok, httpStatus: attempt.httpStatus, address, calendarId }),
      );
      // Echo the token so the caller can eyeball it against the
      // X-Goog-Channel-Token that arrives on the notification — the spike's
      // stand-in for Step 2's persisted token_hash verification.
      return json(200, { ...attempt, channelId, token, calendarIdUsed: calendarId });
    }

    if (action === "stop") {
      const channelId = String(payload.channelId ?? "");
      const resourceId = String(payload.resourceId ?? "");
      if (!channelId || !resourceId) return json(400, { error: "channelId and resourceId are required" });
      const result = await stopWatchChannel(deps, { channelId, resourceId });
      return json(200, result);
    }

    return json(400, { error: `unknown action: ${action}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[google-calendar-webhook][SPIKE]", msg);
    return json(500, { error: msg });
  }
});
