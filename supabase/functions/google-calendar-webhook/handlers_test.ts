// Tests for the v2 Task 5B Step 2 REAL implementation. Replaces the Step-1
// spike's test file wholesale (per the spike file's own header — Step 2
// replaces it). DI style mirrors integration-dispatcher/handlers_test.ts: a
// fake supabase client, fake getCalendarEvent/registerWatch/stopWatch,
// injected `now`.
//
// Covers the task-2 brief's 14 numbered cases plus direct unit coverage of
// classifyManagedEvent (the pure comparator, "exported for tests" per the
// brief's Interfaces block) and the retained transport-shape helpers
// (isGoogleNotification/extractNotification/buildWatchBody) that Step 2
// keeps unchanged from the spike.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildWatchBody,
  classifyManagedEvent,
  extractNotification,
  isGoogleNotification,
  maintainChannels,
  processNotification,
  reconcileCalendar,
  registerWatchChannel,
  runMaintenance,
  sha256Hex,
  stopWatchChannel,
  type InboundDeps,
} from "./handlers.ts";

const FIXED_NOW = new Date("2026-08-24T12:00:00.000Z");

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

function makeDeps(overrides: Partial<InboundDeps> & { supabase: any }): InboundDeps {
  return {
    now: () => FIXED_NOW,
    getAccessToken: () => Promise.resolve("test-access-token"),
    getCalendarEvent: () => Promise.reject(new Error("getCalendarEvent should not be called")),
    registerWatch: () => Promise.reject(new Error("registerWatch should not be called")),
    stopWatch: () => Promise.reject(new Error("stopWatch should not be called")),
    calendarIds: { main: "cal-main", crew1: "cal-crew1", crew2: "cal-crew2", crew3: "cal-crew3", crew4: "cal-crew4" },
    webhookAddress: "https://example.supabase.co/functions/v1/google-calendar-webhook",
    ...overrides,
  };
}

function makeJobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    job_number: "JOB-9001",
    status_v2: "scheduled",
    start_date: "2026-09-01",
    end_date: "2026-09-02",
    calendar_sync_revision: 2,
    gcal_main_event_id: "evt-1",
    gcal_crew_event_id: null,
    crew: null,
    ...overrides,
  };
}

function managedEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    status: "confirmed",
    updated: "2026-08-24T09:00:00.000Z",
    start: { date: "2026-09-01" },
    end: { date: "2026-09-03" }, // exclusive -> inclusive end 2026-09-02
    extendedProperties: {
      private: { managedBy: "lostboys-estimator", jobNumber: "JOB-9001", scheduleRevision: "2" },
    },
    ...overrides,
  };
}

// ── Generic fake supabase — table-scoped, records every call. ──────────────
// Simple, direct simulation of the real query shapes this module issues
// (see handlers.ts): no generic query engine, each table gets its own
// bespoke chain, mirroring integration-dispatcher/handlers_test.ts's
// createMockSupabase style.

interface FakeConfig {
  channelByChannelId?: Record<string, any | null>;
  activeChannelByCalendarId?: Record<string, any | null>;
  jobs?: any[];
  markConflictKeys?: Set<string>; // "calendarId|eventId|eventUpdated"
  jobAlertError?: { code?: string; message?: string } | null;
  rpcData?: Record<string, any>;
  rpcError?: Record<string, { message: string }>;
  marksDeleteCount?: number;
}

function createFakeSupabase(config: FakeConfig = {}) {
  const calls = {
    rpc: [] as Array<{ fn: string; args: any }>,
    channelUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    channelInserts: [] as Array<Record<string, unknown>>,
    markInserts: [] as Array<Record<string, unknown>>,
    marksDelete: [] as Array<{ col: string; val: string }>,
    jobAlertInserts: [] as Array<Record<string, unknown>>,
    syncLogInserts: [] as Array<Record<string, unknown>>,
  };
  const markConflictKeys = config.markConflictKeys ?? new Set<string>();

  return {
    _calls: calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      if (config.rpcError?.[fn]) return Promise.resolve({ data: null, error: config.rpcError[fn] });
      return Promise.resolve({ data: config.rpcData?.[fn] ?? {}, error: null });
    },
    from(table: string) {
      if (table === "calendar_watch_channels") {
        return {
          select(_cols: string) {
            return {
              eq(col: string, val: string) {
                if (col === "channel_id") {
                  return {
                    maybeSingle: () => Promise.resolve({ data: config.channelByChannelId?.[val] ?? null, error: null }),
                  };
                }
                // col === "calendar_id" -> chained with .eq("status","active")
                return {
                  eq(_col2: string, _val2: string) {
                    return {
                      maybeSingle: () =>
                        Promise.resolve({ data: config.activeChannelByCalendarId?.[val] ?? null, error: null }),
                    };
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(_col: string, val: string) {
                calls.channelUpdates.push({ id: val, patch });
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(row: Record<string, unknown>) {
            calls.channelInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "jobs") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: string) {
                return Promise.resolve({ data: config.jobs ?? [], error: null });
              },
            };
          },
        };
      }
      if (table === "calendar_inbound_marks") {
        return {
          insert(row: Record<string, unknown>) {
            calls.markInserts.push(row);
            const key = `${row.calendar_id}|${row.event_id}|${row.event_updated}`;
            if (markConflictKeys.has(key)) {
              return Promise.resolve({ error: { code: "23505", message: "duplicate key value" } });
            }
            markConflictKeys.add(key);
            return Promise.resolve({ error: null });
          },
          delete(_opts: { count: string }) {
            return {
              lt(col: string, val: string) {
                calls.marksDelete.push({ col, val });
                return Promise.resolve({ error: null, count: config.marksDeleteCount ?? 0 });
              },
            };
          },
        };
      }
      if (table === "job_alerts") {
        return {
          insert(row: Record<string, unknown>) {
            calls.jobAlertInserts.push(row);
            return Promise.resolve({ error: config.jobAlertError ?? null });
          },
        };
      }
      if (table === "sync_log") {
        return {
          insert(row: Record<string, unknown>) {
            calls.syncLogInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`createFakeSupabase: unexpected table "${table}"`);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// classifyManagedEvent — pure comparator, direct unit coverage
// ═══════════════════════════════════════════════════════════════════════

const job = { start_date: "2026-09-01", end_date: "2026-09-02", calendar_sync_revision: 2 };

Deno.test("classifyManagedEvent: no managedBy -> unmanaged", () => {
  const event = managedEvent({ extendedProperties: undefined });
  assertEquals(classifyManagedEvent(event, job), "unmanaged");
});

Deno.test("classifyManagedEvent: wrong managedBy value -> unmanaged", () => {
  const event = managedEvent({ extendedProperties: { private: { managedBy: "someone-else" } } });
  assertEquals(classifyManagedEvent(event, job), "unmanaged");
});

Deno.test("classifyManagedEvent: status cancelled -> deleted", () => {
  const event = managedEvent({ status: "cancelled" });
  assertEquals(classifyManagedEvent(event, job), "deleted");
});

Deno.test("classifyManagedEvent: matching dates -> dates_unchanged", () => {
  const event = managedEvent({ start: { date: "2026-09-01" }, end: { date: "2026-09-03" } }); // inclusive end 09-02
  assertEquals(classifyManagedEvent(event, job), "dates_unchanged");
});

Deno.test("classifyManagedEvent: event revision below job's -> stale_revision", () => {
  const event = managedEvent({
    start: { date: "2026-09-05" },
    end: { date: "2026-09-06" },
    extendedProperties: { private: { managedBy: "lostboys-estimator", scheduleRevision: "1" } },
  });
  assertEquals(classifyManagedEvent(event, job), "stale_revision");
});

Deno.test("classifyManagedEvent: event revision above job's -> revision_anomaly", () => {
  const event = managedEvent({
    start: { date: "2026-09-05" },
    end: { date: "2026-09-06" },
    extendedProperties: { private: { managedBy: "lostboys-estimator", scheduleRevision: "3" } },
  });
  assertEquals(classifyManagedEvent(event, job), "revision_anomaly");
});

Deno.test("classifyManagedEvent: matching revision + different dates -> apply", () => {
  const event = managedEvent({ start: { date: "2026-09-05" }, end: { date: "2026-09-06" } });
  assertEquals(classifyManagedEvent(event, job), "apply");
});

Deno.test("classifyManagedEvent: non-all-day event (no start.date) -> revision_anomaly-class skip", () => {
  const event = managedEvent({ start: { dateTime: "2026-09-01T10:00:00Z" } });
  assertEquals(classifyManagedEvent(event, job), "revision_anomaly");
});

// ═══════════════════════════════════════════════════════════════════════
// Retained transport-shape helpers (unchanged from the Step-1 spike)
// ═══════════════════════════════════════════════════════════════════════

Deno.test("isGoogleNotification is true only when X-Goog-Channel-ID is present", () => {
  assertEquals(isGoogleNotification(headers({ "X-Goog-Channel-ID": "abc" })), true);
  assertEquals(isGoogleNotification(headers({ "x-webhook-secret": "s" })), false);
  assertEquals(isGoogleNotification(headers({})), false);
});

Deno.test("extractNotification pulls every documented X-Goog header", () => {
  const n = extractNotification(
    headers({
      "X-Goog-Channel-ID": "chan-1",
      "X-Goog-Channel-Token": "tok-1",
      "X-Goog-Resource-State": "exists",
    }),
  );
  assertEquals(n.channelId, "chan-1");
  assertEquals(n.channelToken, "tok-1");
  assertEquals(n.resourceState, "exists");
});

Deno.test("buildWatchBody produces the exact events.watch shape with ms expiration", () => {
  const body = buildWatchBody({
    channelId: "chan-1",
    address: "https://example.supabase.co/functions/v1/google-calendar-webhook",
    token: "tok-1",
    ttlSeconds: 604800,
    now: FIXED_NOW.getTime(),
  });
  assertEquals(body, {
    id: "chan-1",
    type: "web_hook",
    address: "https://example.supabase.co/functions/v1/google-calendar-webhook",
    token: "tok-1",
    expiration: String(FIXED_NOW.getTime() + 604800 * 1000),
  });
});

Deno.test("buildWatchBody rejects a non-HTTPS address", () => {
  assertThrows(
    () => buildWatchBody({ channelId: "c", address: "http://x.com", token: "t", ttlSeconds: 60, now: 0 }),
    Error,
    "must be HTTPS",
  );
});

Deno.test("registerWatchChannel POSTs to the calendar's events/watch endpoint", async () => {
  let capturedUrl = "";
  const result = await registerWatchChannel(
    {
      getAccessToken: () => Promise.resolve("access-token"),
      fetchImpl: ((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response(JSON.stringify({ resourceId: "res-1" }), { status: 200 }));
      }) as unknown as typeof fetch,
    },
    { calendarId: "cal@x.com", channelId: "chan-1", address: "https://x.co/hook", token: "t", ttlSeconds: 60, now: 0 },
  );
  assertEquals(capturedUrl, "https://www.googleapis.com/calendar/v3/calendars/cal%40x.com/events/watch");
  assertEquals(result.ok, true);
});

Deno.test("stopWatchChannel treats 204 No Content as success", async () => {
  const result = await stopWatchChannel(
    {
      getAccessToken: () => Promise.resolve("access-token"),
      fetchImpl: (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch,
    },
    { channelId: "chan-1", resourceId: "res-1" },
  );
  assertEquals(result.ok, true);
  assertEquals(result.body, null);
});

Deno.test("sha256Hex is deterministic, 64 lowercase hex chars, and distinguishes different inputs", async () => {
  const a = await sha256Hex("tok-1");
  const aAgain = await sha256Hex("tok-1");
  const b = await sha256Hex("tok-2");
  assertEquals(a, aAgain);
  assert(a !== b);
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]{64}$/.test(a));
});

// ═══════════════════════════════════════════════════════════════════════
// Case 1 — "exists" notification transport pin
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 1: 'exists' notification with a registered channel's token triggers scoped reconciliation", async () => {
  const tokenHash = await sha256Hex("tok-good");
  const channel = { id: "row-1", channel_id: "chan-1", calendar_id: "cal-main", status: "active", token_hash: tokenHash };
  const jobRow = makeJobRow();
  const supabase = createFakeSupabase({
    channelByChannelId: { "chan-1": channel },
    jobs: [jobRow],
  });
  let getCalendarEventCalls: Array<[string, string, string]> = [];
  const deps = makeDeps({
    supabase,
    getCalendarEvent: (calendarId, eventId, accessToken) => {
      getCalendarEventCalls.push([calendarId, eventId, accessToken]);
      return Promise.resolve({ status: 200, event: managedEvent({ extendedProperties: undefined }) }); // unmanaged -> quick skip
    },
  });

  await processNotification(
    deps,
    headers({ "X-Goog-Channel-ID": "chan-1", "X-Goog-Channel-Token": "tok-good", "X-Goog-Resource-State": "exists" }),
  );

  assertEquals(getCalendarEventCalls.length, 1);
  assertEquals(getCalendarEventCalls[0], ["cal-main", "evt-1", "test-access-token"]);
});

// ═══════════════════════════════════════════════════════════════════════
// Case 2 — "sync" notification: 200, stamped, no event fetches
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 2: 'sync' notification stamps last_notification_at and fetches no events", async () => {
  const tokenHash = await sha256Hex("tok-good");
  const channel = { id: "row-1", channel_id: "chan-1", calendar_id: "cal-main", status: "active", token_hash: tokenHash };
  const supabase = createFakeSupabase({ channelByChannelId: { "chan-1": channel }, jobs: [] });
  const deps = makeDeps({ supabase }); // getCalendarEvent rejects if called

  await processNotification(
    deps,
    headers({ "X-Goog-Channel-ID": "chan-1", "X-Goog-Channel-Token": "tok-good", "X-Goog-Resource-State": "sync" }),
  );

  assertEquals(supabase._calls.channelUpdates.length, 1);
  assertEquals(supabase._calls.channelUpdates[0].id, "row-1");
  assertEquals(supabase._calls.channelUpdates[0].patch.last_notification_at, FIXED_NOW.toISOString());
});

// ═══════════════════════════════════════════════════════════════════════
// Case 3 — unknown channel_id / token mismatch: logged, no processing
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 3a: unknown channel_id is logged and never processed", async () => {
  const supabase = createFakeSupabase({ channelByChannelId: {} });
  const deps = makeDeps({ supabase }); // getCalendarEvent rejects if called

  await processNotification(
    deps,
    headers({ "X-Goog-Channel-ID": "chan-unknown", "X-Goog-Resource-State": "exists" }),
  );

  assertEquals(supabase._calls.syncLogInserts.length, 1);
  assertEquals(supabase._calls.syncLogInserts[0].direction, "google_to_supabase");
  assertEquals(supabase._calls.syncLogInserts[0].action_taken, "skipped");
  assertEquals(supabase._calls.channelUpdates.length, 0);
});

Deno.test("case 3b: token-hash mismatch is logged and never processed", async () => {
  const channel = {
    id: "row-1",
    channel_id: "chan-1",
    calendar_id: "cal-main",
    status: "active",
    token_hash: "not-the-real-hash",
  };
  const supabase = createFakeSupabase({ channelByChannelId: { "chan-1": channel } });
  const deps = makeDeps({ supabase });

  await processNotification(
    deps,
    headers({ "X-Goog-Channel-ID": "chan-1", "X-Goog-Channel-Token": "wrong-token", "X-Goog-Resource-State": "exists" }),
  );

  assertEquals(supabase._calls.syncLogInserts.length, 1);
  assertEquals(supabase._calls.syncLogInserts[0].action_taken, "skipped");
  assertEquals(supabase._calls.channelUpdates.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// Case 4 — internal throw during processing: caught, never rejects
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 4: an internal throw during processing is caught, logged, and never rejects", async () => {
  const tokenHash = await sha256Hex("tok-good");
  const channel = { id: "row-1", channel_id: "chan-1", calendar_id: "cal-main", status: "active", token_hash: tokenHash };
  // jobs lookup itself throws — simulates an unanticipated bug deep in the
  // reconciliation chain, not a designed error path. Channel lookup and
  // sync_log still work normally via the same underlying fake.
  const base = createFakeSupabase({ channelByChannelId: { "chan-1": channel } });
  const originalFrom = base.from.bind(base);
  base.from = ((table: string) => {
    if (table === "jobs") return { select: () => ({ eq: () => Promise.reject(new Error("simulated internal bug")) }) };
    return originalFrom(table);
  }) as any;

  const deps = makeDeps({ supabase: base });

  // Must not throw / reject.
  await processNotification(
    deps,
    headers({ "X-Goog-Channel-ID": "chan-1", "X-Goog-Channel-Token": "tok-good", "X-Goog-Resource-State": "exists" }),
  );

  assertEquals(base._calls.syncLogInserts.length, 1);
  assertEquals(base._calls.syncLogInserts[0].action_taken, "error");
  assertEquals(base._calls.syncLogInserts[0].status, "error");
  assert((base._calls.syncLogInserts[0].error_message as string).includes("simulated internal bug"));
});

// ═══════════════════════════════════════════════════════════════════════
// Case 5 — apply: revision matches, dates differ -> exactly one RPC call
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 5: matching revision + changed dates calls apply_calendar_date_change exactly once", async () => {
  const jobRow = makeJobRow({ calendar_sync_revision: 2 });
  const supabase = createFakeSupabase({ jobs: [jobRow] });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () =>
      Promise.resolve({
        status: 200,
        event: managedEvent({
          start: { date: "2026-09-10" },
          end: { date: "2026-09-12" }, // exclusive -> inclusive 2026-09-11
          extendedProperties: { private: { managedBy: "lostboys-estimator", scheduleRevision: "2" } },
        }),
      }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(summary.applied, 1);
  assertEquals(supabase._calls.rpc.length, 1);
  assertEquals(supabase._calls.rpc[0].fn, "apply_calendar_date_change");
  assertEquals(supabase._calls.rpc[0].args, {
    p_job_number: "JOB-9001",
    p_start_date: "2026-09-10",
    p_end_date: "2026-09-11",
    p_expected_revision: 2,
    p_event_id: "evt-1",
    p_event_updated: "2026-08-24T09:00:00.000Z",
    p_source: "main",
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Case 6 — stale revision cannot overwrite a newer app edit
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 6: event revision below job's revision skips with no RPC call", async () => {
  const jobRow = makeJobRow({ calendar_sync_revision: 5 });
  const supabase = createFakeSupabase({ jobs: [jobRow] });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () =>
      Promise.resolve({
        status: 200,
        event: managedEvent({
          start: { date: "2026-09-10" },
          end: { date: "2026-09-12" },
          extendedProperties: { private: { managedBy: "lostboys-estimator", scheduleRevision: "1" } },
        }),
      }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(summary.applied, 0);
  assertEquals(summary.skipped, 1);
  assertEquals(supabase._calls.rpc.length, 0);
  assertEquals(supabase._calls.markInserts[0].outcome, "stale_revision");
});

// ═══════════════════════════════════════════════════════════════════════
// Case 7 — echo termination: dates equal -> dates_unchanged, no RPC call
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 7: event dates equal canonical dates skips with no RPC call", async () => {
  const jobRow = makeJobRow({ start_date: "2026-09-01", end_date: "2026-09-02" });
  const supabase = createFakeSupabase({ jobs: [jobRow] });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () =>
      Promise.resolve({ status: 200, event: managedEvent({ start: { date: "2026-09-01" }, end: { date: "2026-09-03" } }) }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(summary.applied, 0);
  assertEquals(summary.skipped, 1);
  assertEquals(supabase._calls.rpc.length, 0);
  assertEquals(supabase._calls.markInserts[0].outcome, "dates_unchanged");
});

// ═══════════════════════════════════════════════════════════════════════
// Case 8 — unmanaged event is ignored
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 8: unmanaged event (no lostboys-estimator managedBy) is ignored, no RPC call", async () => {
  const jobRow = makeJobRow();
  const supabase = createFakeSupabase({ jobs: [jobRow] });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () => Promise.resolve({ status: 200, event: managedEvent({ extendedProperties: undefined }) }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(summary.skipped, 1);
  assertEquals(supabase._calls.rpc.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// Case 9 — deletion opens the exception, never touches the job directly
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 9: getCalendarEvent 404 opens a calendar deletion exception", async () => {
  const jobRow = makeJobRow();
  const supabase = createFakeSupabase({ jobs: [jobRow] });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () => Promise.resolve({ status: 404, event: null }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(summary.deleted, 1);
  assertEquals(supabase._calls.rpc.length, 1);
  assertEquals(supabase._calls.rpc[0].fn, "open_calendar_deletion_exception");
  assertEquals(supabase._calls.rpc[0].args.p_job_number, "JOB-9001");
  assertEquals(supabase._calls.rpc[0].args.p_external_event_id, "evt-1");
  // The handler itself never writes jobs.status_v2 or the gcal ids — the
  // RPC owns that; there is no jobs.update call anywhere in this module.
});

Deno.test("case 9b: event fetched with status 'cancelled' also opens a deletion exception", async () => {
  const jobRow = makeJobRow();
  const supabase = createFakeSupabase({ jobs: [jobRow] });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () => Promise.resolve({ status: 200, event: managedEvent({ status: "cancelled" }) }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(summary.deleted, 1);
  assertEquals(supabase._calls.rpc[0].fn, "open_calendar_deletion_exception");
});

// ═══════════════════════════════════════════════════════════════════════
// Case 10 (M7) — deletion for an already-cancelled job is a benign skip
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 10 (M7): deletion RPC still called for a cancelled job; {opened:false} is a benign skip", async () => {
  // A cancelled job row is injected directly (bypassing the normal
  // status_v2='scheduled' query filter, which is a real Postgres WHERE
  // clause in production) to exercise the RPC's own defense-in-depth guard.
  const jobRow = makeJobRow({ status_v2: "cancelled" });
  const supabase = createFakeSupabase({
    jobs: [jobRow],
    rpcData: { open_calendar_deletion_exception: { opened: false, reason: "not_scheduled" } },
  });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () => Promise.resolve({ status: 404, event: null }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(supabase._calls.rpc.length, 1);
  assertEquals(supabase._calls.rpc[0].fn, "open_calendar_deletion_exception");
  assertEquals(summary.errored, 0); // benign skip — never surfaced as an error/retry
});

// ═══════════════════════════════════════════════════════════════════════
// Case 11 — dedup: mark-insert conflict skips, no RPC call
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 11: a mark-insert conflict (23505) skips the event with no RPC call", async () => {
  const jobRow = makeJobRow();
  const supabase = createFakeSupabase({
    jobs: [jobRow],
    markConflictKeys: new Set(["cal-main|evt-1|2026-08-24T09:00:00.000Z"]),
  });
  const deps = makeDeps({
    supabase,
    getCalendarEvent: () =>
      Promise.resolve({
        status: 200,
        event: managedEvent({ start: { date: "2026-09-10" }, end: { date: "2026-09-12" } }),
      }),
  });

  const summary = await reconcileCalendar(deps, "cal-main");

  assertEquals(summary.skipped, 1);
  assertEquals(summary.applied, 0);
  assertEquals(supabase._calls.rpc.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// Case 12 — renewal before expiry + overlapping channels dedup
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 12: watch channel renewed before expiry; overlapping-channel notifications dedupe to one processed outcome", async () => {
  const order: string[] = [];
  const channels: Record<string, any> = {
    "row-old": {
      id: "row-old",
      channel_id: "old-chan",
      resource_id: "res-old",
      calendar_id: "cal-main",
      status: "active",
      expires_at: "2026-08-25T00:00:00.000Z", // 12h from FIXED_NOW — inside the 24h window
      token_hash: "", // set below once we know the old token
    },
  };
  const byChannelId: Record<string, string> = { "old-chan": "row-old" };
  const marks = new Set<string>();
  const jobRow = makeJobRow({ job_number: "JOB-9001", gcal_main_event_id: "evt-shared", calendar_sync_revision: 2 });

  const oldToken = "old-token-value";
  channels["row-old"].token_hash = await sha256Hex(oldToken);

  let capturedNewToken = "";

  const supabase = {
    _calls: { rpc: [] as Array<{ fn: string; args: any }> },
    rpc(fn: string, args: any) {
      order.push(`rpc:${fn}`);
      this._calls.rpc.push({ fn, args });
      return Promise.resolve({ data: { applied: true }, error: null });
    },
    from(table: string) {
      if (table === "calendar_watch_channels") {
        return {
          select() {
            return {
              eq(col: string, val: string) {
                if (col === "channel_id") {
                  const rowId = byChannelId[val];
                  return { maybeSingle: () => Promise.resolve({ data: rowId ? channels[rowId] : null, error: null }) };
                }
                return {
                  eq(_c2: string, _v2: string) {
                    return {
                      maybeSingle: () => {
                        const active = Object.values(channels).find((c: any) => c.calendar_id === val && c.status === "active");
                        return Promise.resolve({ data: active ?? null, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
          update(patch: any) {
            return {
              eq(col: string, val: string) {
                if (col === "id" && channels[val]) Object.assign(channels[val], patch);
                order.push(`update:${JSON.stringify(patch)}`);
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(row: any) {
            const id = `row-${row.channel_id}`;
            channels[id] = { id, ...row };
            byChannelId[row.channel_id] = id;
            order.push(`insert:${row.channel_id}`);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "jobs") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [jobRow], error: null }) }) };
      }
      if (table === "calendar_inbound_marks") {
        return {
          insert(row: any) {
            const key = `${row.calendar_id}|${row.event_id}|${row.event_updated}`;
            if (marks.has(key)) return Promise.resolve({ error: { code: "23505", message: "dup" } });
            marks.add(key);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "job_alerts" || table === "sync_log") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const deps = makeDeps({
    supabase,
    now: () => FIXED_NOW,
    getCalendarEvent: () => {
      order.push("getCalendarEvent");
      return Promise.resolve({
        status: 200,
        event: managedEvent({
          id: "evt-shared",
          updated: "2026-08-24T09:00:00.000Z",
          start: { date: "2026-09-05" },
          end: { date: "2026-09-07" },
          extendedProperties: { private: { managedBy: "lostboys-estimator", scheduleRevision: "2" } },
        }),
      });
    },
    registerWatch: (_calendarId, _channelId, _address, token) => {
      order.push("registerWatch");
      capturedNewToken = token;
      return Promise.resolve({
        ok: true,
        httpStatus: 200,
        body: { resourceId: "res-new", expiration: String(FIXED_NOW.getTime() + 604800 * 1000) },
      });
    },
    stopWatch: () => {
      order.push("stopWatch");
      return Promise.resolve({ ok: true });
    },
    calendarIds: { main: "cal-main", crew1: "", crew2: "", crew3: "", crew4: "" },
  });

  const maintainSummary = await maintainChannels(deps);
  assertEquals(maintainSummary.renewed, ["main"]);

  // Ordering: register the NEW channel BEFORE the old one is stopped.
  assert(order.indexOf("registerWatch") < order.indexOf("stopWatch"));
  assertEquals(channels["row-old"].status, "superseded");
  const newRow = Object.values(channels).find((c: any) => c.status === "active") as any;
  assert(newRow, "expected a new active channel row");
  assertEquals(newRow.calendar_id, "cal-main");

  // Two notifications, same event generation, arriving on BOTH channels.
  const oldNotificationHeaders = headers({
    "X-Goog-Channel-ID": "old-chan",
    "X-Goog-Channel-Token": oldToken,
    "X-Goog-Resource-State": "exists",
  });
  const newNotificationHeaders = headers({
    "X-Goog-Channel-ID": newRow.channel_id,
    "X-Goog-Channel-Token": capturedNewToken,
    "X-Goog-Resource-State": "exists",
  });

  await processNotification(deps, oldNotificationHeaders);
  await processNotification(deps, newNotificationHeaders);

  const applyRpcCalls = supabase._calls.rpc.filter((c) => c.fn === "apply_calendar_date_change");
  assertEquals(applyRpcCalls.length, 1); // the second notification's mark conflict absorbed it
});

// ═══════════════════════════════════════════════════════════════════════
// Case 13 — renewal failure opens an alert; the fallback poll still detects
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 13: channel renewal failure opens an alert + sync_log error; reconciliation fallback still applies the change", async () => {
  const oldChannel = {
    id: "row-old",
    channel_id: "old-chan",
    resource_id: "res-old",
    calendar_id: "cal-main",
    status: "active",
    expires_at: "2026-08-25T00:00:00.000Z", // inside the 24h renewal window
    token_hash: "irrelevant",
  };
  const jobRow = makeJobRow({ calendar_sync_revision: 2 });
  const supabase = createFakeSupabase({
    activeChannelByCalendarId: { "cal-main": oldChannel },
    jobs: [jobRow],
  });
  const deps = makeDeps({
    supabase,
    calendarIds: { main: "cal-main", crew1: "", crew2: "", crew3: "", crew4: "" },
    registerWatch: () => Promise.resolve({ ok: false, httpStatus: 401, body: { error: { message: "Unauthorized WebHook callback channel" } } }),
    getCalendarEvent: () =>
      Promise.resolve({
        status: 200,
        event: managedEvent({ start: { date: "2026-09-10" }, end: { date: "2026-09-12" } }),
      }),
  });

  const summary = await runMaintenance(deps);

  assertEquals(summary.channelsFailed, ["main"]);
  assertEquals(supabase._calls.channelUpdates[0].patch.status, "renewal_failed");
  assert(typeof supabase._calls.channelUpdates[0].patch.last_error === "string");

  const alert = supabase._calls.jobAlertInserts[0];
  assertEquals(alert.job_number, "JOB-9001");
  assertEquals(alert.fingerprint, "calendar_watch:cal-main");
  assertEquals(alert.severity, "watch");

  const errorLog = supabase._calls.syncLogInserts.find((r) => r.trigger_event === "calendar_watch_renewal");
  assertEquals(errorLog?.status, "error");

  // The reconciliation fallback ran regardless and applied the changed event.
  assertEquals(summary.eventsApplied, 1);
});

// ═══════════════════════════════════════════════════════════════════════
// Case 14 — maintain prunes calendar_inbound_marks older than 30 days
// ═══════════════════════════════════════════════════════════════════════

Deno.test("case 14: runMaintenance prunes calendar_inbound_marks older than 30 days", async () => {
  const supabase = createFakeSupabase({ marksDeleteCount: 7 });
  const deps = makeDeps({
    supabase,
    calendarIds: { main: "", crew1: "", crew2: "", crew3: "", crew4: "" }, // isolate the prune step
  });

  const summary = await runMaintenance(deps);

  assertEquals(summary.marksPruned, 7);
  assertEquals(supabase._calls.marksDelete.length, 1);
  assertEquals(supabase._calls.marksDelete[0].col, "processed_at");
  const expectedCutoff = new Date(FIXED_NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  assertEquals(supabase._calls.marksDelete[0].val, expectedCutoff);
});
