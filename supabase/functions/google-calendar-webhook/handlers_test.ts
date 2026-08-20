// Tests for the v2 Task 5B Step-1 spike scaffold. Scope matches the
// scaffold's scope: request classification, X-Goog header extraction, and
// the events.watch/channels.stop request shapes. The inbound sync
// behaviour the v2 doc lists (revision guards, deletion exceptions,
// overlap dedup) is Step 2 work and is deliberately untested here —
// there is no code for it yet, and writing tests against an unproven
// transport would be building on the spike's unanswered question.

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildWatchBody,
  extractNotification,
  isGoogleNotification,
  registerWatchChannel,
  stopWatchChannel,
} from "./handlers.ts";

const FIXED_NOW = Date.parse("2026-08-20T22:00:00.000Z");

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

Deno.test("isGoogleNotification is true only when X-Goog-Channel-ID is present", () => {
  assertEquals(isGoogleNotification(headers({ "X-Goog-Channel-ID": "abc" })), true);
  assertEquals(isGoogleNotification(headers({ "x-goog-channel-id": "abc" })), true);
  assertEquals(isGoogleNotification(headers({ "x-webhook-secret": "s" })), false);
  assertEquals(isGoogleNotification(headers({})), false);
});

Deno.test("isGoogleNotification does not misread other X-Goog headers as a notification", () => {
  // Resource-state alone must not route to the notification path — the
  // admin path would then be unreachable behind a stray header.
  assertEquals(isGoogleNotification(headers({ "X-Goog-Resource-State": "sync" })), false);
});

Deno.test("extractNotification pulls every documented X-Goog header", () => {
  const n = extractNotification(headers({
    "X-Goog-Channel-ID": "chan-1",
    "X-Goog-Channel-Token": "tok-1",
    "X-Goog-Channel-Expiration": "Tue, 25 Aug 2026 00:00:00 GMT",
    "X-Goog-Message-Number": "1",
    "X-Goog-Resource-ID": "res-1",
    "X-Goog-Resource-State": "sync",
    "X-Goog-Resource-URI": "https://www.googleapis.com/calendar/v3/calendars/x/events",
  }));
  assertEquals(n.channelId, "chan-1");
  assertEquals(n.channelToken, "tok-1");
  assertEquals(n.messageNumber, "1");
  assertEquals(n.resourceId, "res-1");
  assertEquals(n.resourceState, "sync");
});

Deno.test("extractNotification returns nulls for the sometimes-absent headers", () => {
  const n = extractNotification(headers({ "X-Goog-Channel-ID": "chan-1" }));
  assertEquals(n.channelToken, null);
  assertEquals(n.channelExpiration, null);
});

Deno.test("buildWatchBody produces the exact events.watch shape with ms expiration", () => {
  const body = buildWatchBody({
    channelId: "chan-1",
    address: "https://example.supabase.co/functions/v1/google-calendar-webhook",
    token: "tok-1",
    ttlSeconds: 3600,
    now: FIXED_NOW,
  });
  assertEquals(body, {
    id: "chan-1",
    type: "web_hook",
    address: "https://example.supabase.co/functions/v1/google-calendar-webhook",
    token: "tok-1",
    expiration: String(FIXED_NOW + 3_600_000),
  });
});

Deno.test("buildWatchBody rejects a non-HTTPS address", () => {
  assertThrows(
    () =>
      buildWatchBody({
        channelId: "c",
        address: "http://example.com/hook",
        token: "t",
        ttlSeconds: 60,
        now: FIXED_NOW,
      }),
    Error,
    "must be HTTPS",
  );
});

Deno.test("buildWatchBody enforces Google's 64-char channel id limit", () => {
  assertThrows(
    () =>
      buildWatchBody({
        channelId: "x".repeat(65),
        address: "https://example.com/hook",
        token: "t",
        ttlSeconds: 60,
        now: FIXED_NOW,
      }),
    Error,
    "64-character limit",
  );
});

Deno.test("buildWatchBody enforces Google's 256-char token limit", () => {
  assertThrows(
    () =>
      buildWatchBody({
        channelId: "c",
        address: "https://example.com/hook",
        token: "t".repeat(257),
        ttlSeconds: 60,
        now: FIXED_NOW,
      }),
    Error,
    "256-character limit",
  );
});

Deno.test("registerWatchChannel POSTs to the calendar's events/watch endpoint and returns Google's body verbatim", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await registerWatchChannel(
    {
      getAccessToken: () => Promise.resolve("access-token"),
      fetchImpl: ((url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return Promise.resolve(
          new Response(JSON.stringify({ kind: "api#channel", id: "chan-1", resourceId: "res-1" }), { status: 200 }),
        );
      }) as unknown as typeof fetch,
    },
    {
      calendarId: "cal@group.calendar.google.com",
      channelId: "chan-1",
      address: "https://example.supabase.co/functions/v1/google-calendar-webhook",
      token: "tok-1",
      ttlSeconds: 3600,
      now: FIXED_NOW,
    },
  );

  assertEquals(
    capturedUrl,
    "https://www.googleapis.com/calendar/v3/calendars/cal%40group.calendar.google.com/events/watch",
  );
  assertEquals((capturedInit?.headers as Record<string, string>).Authorization, "Bearer access-token");
  assertEquals(result.ok, true);
  assertEquals((result.body as Record<string, unknown>).resourceId, "res-1");
});

Deno.test("registerWatchChannel surfaces an unauthorized-callback rejection instead of throwing", async () => {
  // THE spike's expected failure mode. It must come back as data the
  // caller can read, not an exception that loses Google's wording.
  const googleError = {
    error: {
      code: 401,
      message: "Unauthorized WebHook callback channel: https://example.supabase.co/functions/v1/google-calendar-webhook",
    },
  };
  const result = await registerWatchChannel(
    {
      getAccessToken: () => Promise.resolve("access-token"),
      fetchImpl: (() =>
        Promise.resolve(new Response(JSON.stringify(googleError), { status: 401 }))) as unknown as typeof fetch,
    },
    {
      calendarId: "cal",
      channelId: "chan-1",
      address: "https://example.supabase.co/functions/v1/google-calendar-webhook",
      token: "tok-1",
      ttlSeconds: 3600,
      now: FIXED_NOW,
    },
  );
  assertEquals(result.ok, false);
  assertEquals(result.httpStatus, 401);
  assertEquals(result.body, googleError);
});

Deno.test("stopWatchChannel treats 204 No Content as success with a null body", async () => {
  const result = await stopWatchChannel(
    {
      getAccessToken: () => Promise.resolve("access-token"),
      fetchImpl: (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch,
    },
    { channelId: "chan-1", resourceId: "res-1" },
  );
  assertEquals(result.ok, true);
  assertEquals(result.httpStatus, 204);
  assertEquals(result.body, null);
});
