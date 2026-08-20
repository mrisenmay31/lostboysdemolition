// ============================================================
// Lost Boys Demolition — Google Calendar inbound webhook
// v2 Task 5B (phase-1 plan Task 6) — STEP 1 SPIKE SCAFFOLD ONLY.
//
// ⚠️ THIS IS A SPIKE. Its only job is to answer one question the phase
// plan flags as unproven: *can a Google Calendar watch channel deliver a
// push notification to a Supabase edge-function URL at all?* Google
// requires the callback domain to be verified (Search Console) and
// registered in the GCP project's Push section; nobody at Lost Boys owns
// `supabase.co`, so registration may be refused outright with
// "Unauthorized WebHook callback channel".
//
// If the spike fails, the phase plan says STOP and degrade 5B to
// reconciliation-polling-only — do NOT build channel machinery on top of
// this file. If it succeeds, Step 2 replaces this scaffold with the real
// implementation (calendar_watch_channels registry, token_hash
// persistence + verification, renewal-before-expiry, overlap dedup,
// revision-guarded date-only inbound writes, job_schedule_exceptions).
//
// Deliberately NOT here, because they are Step 2's contract and building
// them now would prejudge the spike's answer:
//   - any database access whatsoever (the spike is zero-schema by design;
//     notifications are observed through edge-function logs)
//   - channel-token persistence and verification (the token is echoed back
//     in the response at registration time and eyeballed against the
//     logged X-Goog-Channel-Token instead)
//   - any write to jobs / job_schedule_exceptions
//
// Pure logic + DI only, per house style — index.ts is the env surface.
// ============================================================

export interface WatchDeps {
  getAccessToken: () => Promise<string>;
  fetchImpl: typeof fetch;
}

/** Every X-Goog-* header Google attaches to a push notification, per
 *  https://developers.google.com/workspace/calendar/api/guides/push.
 *  `channelExpiration` and `channelToken` are documented as only
 *  sometimes present. */
export interface GoogNotification {
  channelId: string | null;
  channelToken: string | null;
  channelExpiration: string | null;
  messageNumber: string | null;
  resourceId: string | null;
  resourceState: string | null;
  resourceUri: string | null;
}

/** A request is Google's push notification if — and only if — it carries
 *  X-Goog-Channel-ID. Google sends no `x-webhook-secret` (it knows nothing
 *  about ours), so the admin routes and the notification route cannot
 *  share an auth check; the notification route's real auth is the channel
 *  token, which Step 2 will verify against the persisted token_hash. */
export function isGoogleNotification(headers: Headers): boolean {
  return headers.get("x-goog-channel-id") !== null;
}

export function extractNotification(headers: Headers): GoogNotification {
  return {
    channelId: headers.get("x-goog-channel-id"),
    channelToken: headers.get("x-goog-channel-token"),
    channelExpiration: headers.get("x-goog-channel-expiration"),
    messageNumber: headers.get("x-goog-message-number"),
    resourceId: headers.get("x-goog-resource-id"),
    resourceState: headers.get("x-goog-resource-state"),
    resourceUri: headers.get("x-goog-resource-uri"),
  };
}

/** events.watch request body. `id` is capped at 64 chars and `token` at
 *  256 by the API; `expiration` is Unix ms, and Google may shorten it to
 *  its own internal ceiling (Calendar channels top out around 30 days,
 *  which is why Step 2 needs renewal-before-expiry at all). */
export function buildWatchBody(input: {
  channelId: string;
  address: string;
  token: string;
  ttlSeconds: number;
  now: number;
}): Record<string, unknown> {
  if (input.channelId.length > 64) {
    throw new Error(`channel id exceeds Google's 64-character limit (${input.channelId.length})`);
  }
  if (input.token.length > 256) {
    throw new Error(`channel token exceeds Google's 256-character limit (${input.token.length})`);
  }
  if (!input.address.startsWith("https://")) {
    throw new Error(`watch address must be HTTPS, got: ${input.address}`);
  }
  return {
    id: input.channelId,
    type: "web_hook",
    address: input.address,
    token: input.token,
    expiration: String(input.now + input.ttlSeconds * 1000),
  };
}

export interface WatchAttempt {
  ok: boolean;
  httpStatus: number;
  /** Google's raw response, verbatim. The whole point of the spike is to
   *  read this — an "Unauthorized WebHook callback channel" here is the
   *  STOP signal, and paraphrasing it would lose the diagnosis. */
  body: unknown;
  requestBody: Record<string, unknown>;
}

export async function registerWatchChannel(
  deps: WatchDeps,
  input: { calendarId: string; channelId: string; address: string; token: string; ttlSeconds: number; now: number },
): Promise<WatchAttempt> {
  const requestBody = buildWatchBody(input);
  const accessToken = await deps.getAccessToken();
  const res = await deps.fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  );
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, httpStatus: res.status, body, requestBody };
}

/** channels.stop — cleanup so the spike leaves no live channel behind.
 *  204 No Content is the success shape. */
export async function stopWatchChannel(
  deps: WatchDeps,
  input: { channelId: string; resourceId: string },
): Promise<{ ok: boolean; httpStatus: number; body: unknown }> {
  const accessToken = await deps.getAccessToken();
  const res = await deps.fetchImpl("https://www.googleapis.com/calendar/v3/channels/stop", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
  });
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { ok: res.ok, httpStatus: res.status, body };
}
