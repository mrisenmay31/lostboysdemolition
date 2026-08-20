import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildScheduleCalendarEventBody,
  findJobPipeline,
  findStageId,
  runDispatch,
  type DispatcherCalendarInput,
  type DispatcherDeps,
  type GhlPipeline,
  type OutboxRow,
} from "./handlers.ts";

// ── Mock supabase — table-scoped, records every call for assertion ─────────

interface MockSupabaseConfig {
  claimRows?: OutboxRow[];
  claimError?: { message?: string } | null;
  jobsByNumber?: Record<string, Record<string, unknown> | null>;
  jobUpdateError?: { message?: string } | null;
  outboxUpdateError?: { message?: string } | null;
  jobAlertInsertError?: { code?: string; message?: string } | null;
}

function createMockSupabase(config: MockSupabaseConfig) {
  const claimRows = { current: config.claimRows ?? [] };
  const calls = {
    rpc: [] as Array<{ fn: string; args: any }>,
    jobsUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    outboxUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    jobAlertInserts: [] as Array<Record<string, unknown>>,
    syncLogInserts: [] as Array<Record<string, unknown>>,
  };

  return {
    _calls: calls,
    _setClaimRows(rows: OutboxRow[]) {
      claimRows.current = rows;
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      if (fn === "claim_integration_events") {
        return Promise.resolve({ data: config.claimError ? null : claimRows.current, error: config.claimError ?? null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    },
    from(table: string) {
      if (table === "jobs") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, val: string) {
                return {
                  maybeSingle: () => {
                    const row = config.jobsByNumber?.[val] ?? null;
                    return Promise.resolve({ data: row, error: null });
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(_col: string, val: string) {
                calls.jobsUpdates.push({ id: val, patch });
                return Promise.resolve({ error: config.jobUpdateError ?? null });
              },
            };
          },
        };
      }
      if (table === "integration_outbox") {
        return {
          update(patch: Record<string, unknown>) {
            return {
              eq(_col: string, val: string) {
                calls.outboxUpdates.push({ id: val, patch });
                return Promise.resolve({ error: config.outboxUpdateError ?? null });
              },
            };
          },
        };
      }
      if (table === "job_alerts") {
        return {
          insert(row: Record<string, unknown>) {
            calls.jobAlertInserts.push(row);
            return Promise.resolve({ error: config.jobAlertInsertError ?? null });
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
      throw new Error(`createMockSupabase: unexpected table "${table}"`);
    },
  };
}

// ── Deps builder — every network dep defaults to "reject if called", so a
//    test that doesn't wire a dep proves that leg was never reached. ────────

function makeDeps(overrides: Partial<DispatcherDeps> & { supabase: any }): DispatcherDeps {
  return {
    now: () => new Date("2026-08-20T12:00:00.000Z"),
    getAccessToken: () => Promise.resolve("test-access-token"),
    createCalendarEvent: () => Promise.reject(new Error("createCalendarEvent should not be called")),
    updateCalendarEvent: () => Promise.reject(new Error("updateCalendarEvent should not be called")),
    deleteCalendarEvent: () => Promise.reject(new Error("deleteCalendarEvent should not be called")),
    calendarIds: { main: "cal-main", crew1: "cal-crew1", crew2: "cal-crew2", crew3: "cal-crew3", crew4: "cal-crew4" },
    postSlackMessage: () => Promise.reject(new Error("postSlackMessage should not be called")),
    slackChannels: { crew1: "C1", crew2: "C2", crew3: "C3", crew4: "C4" },
    fetchPipelines: () => Promise.reject(new Error("fetchPipelines should not be called")),
    fetchOpportunity: () => Promise.reject(new Error("fetchOpportunity should not be called")),
    updateOpportunityStage: () => Promise.reject(new Error("updateOpportunityStage should not be called")),
    ...overrides,
  };
}

// ── Fixture builders ─────────────────────────────────────────────────────

function makeOutboxRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "outbox-1",
    event_type: "job.scheduled",
    aggregate_type: "job",
    aggregate_id: "JOB-2001",
    idempotency_key: "job.scheduled:JOB-2001:1",
    payload: {
      job_number: "JOB-2001",
      crew: "Crew 1",
      start_date: "2026-08-18",
      end_date: "2026-08-19",
      calendar_sync_revision: 1,
    },
    status: "processing",
    attempts: 1,
    available_at: "2026-08-20T00:00:00.000Z",
    locked_at: "2026-08-20T00:00:00.000Z",
    last_error: null,
    created_at: "2026-08-20T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

function makeJobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "job-uuid-1",
    job_number: "JOB-2001",
    client_name: "Sunline Landscape",
    client_contact_name: "Ann Morrison",
    business_name: "Sunline Landscape",
    client_phone: "8015550142",
    job_address: "4285 S 300 W, Murray, UT",
    city: "Murray",
    crew: "Crew 1",
    start_date: "2026-08-10",
    end_date: "2026-08-11",
    estimate_value: 4200,
    gcal_main_event_id: null,
    gcal_crew_event_id: null,
    slack_notified_at: null,
    calendar_sync_revision: 0,
    status_v2: "scheduled",
    start_time: "8:00 AM",
    scope_summary: "Kitchen Demo — full teardown",
    ...overrides,
  };
}

function makePipelines(): GhlPipeline[] {
  return [
    {
      id: "pipeline-job",
      name: "Job Pipeline",
      stages: [
        { id: "stage-quote-accepted", name: "Quote Accepted" },
        { id: "stage-job-scheduled", name: "Job Scheduled" },
        { id: "stage-closed-lost", name: "Closed Lost (Declined)" },
      ],
    },
    {
      // Live fact this dispatcher must not trip on: a second pipeline with
      // its own, differently-id'd "Job Scheduled" stage.
      id: "pipeline-contractor",
      name: "Contractor Pipeline",
      stages: [{ id: "stage-other-scheduled", name: "Job Scheduled" }],
    },
  ];
}

// ── Pure helper: buildScheduleCalendarEventBody ─────────────────────────────

Deno.test("buildScheduleCalendarEventBody: exact shape incl. extendedProperties.private", () => {
  const input: DispatcherCalendarInput = {
    jobNumber: "JOB-3001",
    clientName: "Ann Morrison",
    jobAddress: "123 Main St",
    estimateValue: 1000,
    crew: "Crew 2",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    calendarSyncRevision: 4,
  };
  const body = buildScheduleCalendarEventBody(input, "main");
  assertEquals(body.summary, "JOB-3001 — Ann Morrison — 123 Main St");
  assertEquals(body.start, { date: "2026-09-01" });
  assertEquals(body.end, { date: "2026-09-02" });
  assertEquals(body.extendedProperties, {
    private: { jobNumber: "JOB-3001", scheduleRevision: "4", managedBy: "lostboys-estimator" },
  });
});

Deno.test("buildScheduleCalendarEventBody: inclusive two-day span writes exclusive end on day three", () => {
  const input: DispatcherCalendarInput = {
    jobNumber: "JOB-3002",
    clientName: "Ann",
    jobAddress: "1 Main St",
    estimateValue: null,
    crew: "Crew 1",
    startDate: "2026-08-18",
    endDate: "2026-08-19",
    calendarSyncRevision: 1,
  };
  const body = buildScheduleCalendarEventBody(input, "main");
  assertEquals(body.start, { date: "2026-08-18" });
  assertEquals(body.end, { date: "2026-08-20" });
});

// ── Pure helper: findJobPipeline ─────────────────────────────────────────────

Deno.test("findJobPipeline: matches by case-insensitive substring, ignores the second pipeline", () => {
  const pipeline = findJobPipeline(makePipelines());
  assertEquals(pipeline?.id, "pipeline-job");
});

Deno.test("findStageId: case-insensitive substring match", () => {
  const stages = makePipelines()[0].stages;
  assertEquals(findStageId(stages, "Job Scheduled"), "stage-job-scheduled");
  assertEquals(findStageId(stages, "nonexistent"), null);
});

// ── runDispatch: claim contract ─────────────────────────────────────────────

Deno.test("runDispatch: defaults to limit 20 and calls claim_integration_events", async () => {
  const supabase = createMockSupabase({ claimRows: [] });
  const deps = makeDeps({ supabase });
  const summary = await runDispatch(deps);
  assertEquals(summary.claimed, 0);
  assertEquals(supabase._calls.rpc[0], { fn: "claim_integration_events", args: { p_limit: 20 } });
});

Deno.test("runDispatch: honors an explicit limit", async () => {
  const supabase = createMockSupabase({ claimRows: [] });
  const deps = makeDeps({ supabase });
  await runDispatch(deps, { limit: 5 });
  assertEquals(supabase._calls.rpc[0].args, { p_limit: 5 });
});

// ── job.scheduled ─────────────────────────────────────────────────────────

Deno.test("job.scheduled creates one all-day event per configured calendar projection (main + crew)", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const createCalls: Array<{ calendarId: string; body: any }> = [];
  const deps = makeDeps({
    supabase,
    createCalendarEvent: (calendarId: string, _token: string, body: any) => {
      createCalls.push({ calendarId, body });
      return Promise.resolve({ id: `evt-${createCalls.length}` });
    },
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(summary.failed, 0);
  assertEquals(createCalls.length, 2);
  assertEquals(createCalls[0].calendarId, "cal-main");
  assertEquals(createCalls[1].calendarId, "cal-crew1");
});

Deno.test("job.scheduled: inclusive two-day job writes exclusive calendar end date on day three (via runDispatch)", async () => {
  const row = makeOutboxRow({
    payload: {
      job_number: "JOB-2001",
      crew: "Crew 1",
      start_date: "2026-08-18",
      end_date: "2026-08-19",
      calendar_sync_revision: 1,
    },
  });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const bodies: any[] = [];
  const deps = makeDeps({
    supabase,
    createCalendarEvent: (_cal: string, _tok: string, body: any) => {
      bodies.push(body);
      return Promise.resolve({ id: "evt-x" });
    },
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  await runDispatch(deps);
  assertEquals(bodies[0].start, { date: "2026-08-18" });
  assertEquals(bodies[0].end, { date: "2026-08-20" });
});

Deno.test("job.scheduled: crew calendar omits financial fields; main carries the estimate", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow({ estimate_value: 5000 });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const bodies: Array<{ calendarId: string; body: any }> = [];
  const deps = makeDeps({
    supabase,
    createCalendarEvent: (calendarId: string, _t: string, body: any) => {
      bodies.push({ calendarId, body });
      return Promise.resolve({ id: "evt-x" });
    },
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  await runDispatch(deps);
  const main = bodies.find((b) => b.calendarId === "cal-main")!;
  const crew = bodies.find((b) => b.calendarId === "cal-crew1")!;
  assert(main.body.description.includes("$"));
  assert(main.body.description.includes("Estimate"));
  assert(!crew.body.description.includes("$"));
  assert(!crew.body.description.includes("Estimate"));
});

Deno.test("job.scheduled: existing event ids cause update not create", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow({ gcal_main_event_id: "evt-main-old", gcal_crew_event_id: "evt-crew-old" });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const updateCalls: Array<{ calendarId: string; eventId: string }> = [];
  const deps = makeDeps({
    supabase,
    updateCalendarEvent: (calendarId: string, eventId: string) => {
      updateCalls.push({ calendarId, eventId });
      return Promise.resolve({ id: eventId });
    },
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(updateCalls.length, 2);
  assertEquals(updateCalls[0], { calendarId: "cal-main", eventId: "evt-main-old" });
  assertEquals(updateCalls[1], { calendarId: "cal-crew1", eventId: "evt-crew-old" });
});

Deno.test("job.scheduled: update 404 falls back to create and overwrites the stored id", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow({ gcal_main_event_id: "evt-main-old", gcal_crew_event_id: "evt-crew-old" });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    updateCalendarEvent: () => Promise.reject(new Error('Calendar event update failed (404): {"error":"Not Found"}')),
    createCalendarEvent: () => Promise.resolve({ id: "evt-fresh" }),
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  const mainUpdate = supabase._calls.jobsUpdates.find((u) => "gcal_main_event_id" in u.patch);
  assertEquals(mainUpdate?.patch.gcal_main_event_id, "evt-fresh");
  const crewUpdate = supabase._calls.jobsUpdates.find((u) => "gcal_crew_event_id" in u.patch);
  assertEquals(crewUpdate?.patch.gcal_crew_event_id, "evt-fresh");
});

Deno.test("job.scheduled: stale calendar_sync_revision is a succeeded no-op with no calendar/slack calls", async () => {
  const row = makeOutboxRow({
    payload: {
      job_number: "JOB-2001",
      crew: "Crew 1",
      start_date: "2026-08-18",
      end_date: "2026-08-19",
      calendar_sync_revision: 1,
    },
  });
  const jobRow = makeJobRow({ calendar_sync_revision: 3 });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({ supabase }); // every network dep rejects if called
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(summary.failed, 0);
  assertEquals(supabase._calls.jobsUpdates.length, 0);
  // Review round 1, finding 1: the skip reason must survive into the
  // summary — a stale-revision no-op and a real calendar write used to be
  // indistinguishable.
  assert(summary.results[0].detail?.includes("stale revision"));
});

Deno.test("job.scheduled: cancelled job is a succeeded no-op with no calendar/slack calls", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow({ status_v2: "cancelled" });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({ supabase });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(supabase._calls.jobsUpdates.length, 0);
  assert(summary.results[0].detail?.includes("cancelled"));
});

Deno.test("job.scheduled: one calendar failure leaves the event retryable with backoff", async () => {
  const row = makeOutboxRow({ attempts: 2 });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.reject(new Error("network blip")),
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assertEquals(summary.succeeded, 0);
  const update = supabase._calls.outboxUpdates[0];
  assertEquals(update.patch.status, "failed");
  assertEquals(update.patch.last_error, "network blip");
  // attempts=2 -> backoff min(60, 2^2)=4 minutes from deps.now()
  assertEquals(update.patch.available_at, "2026-08-20T12:04:00.000Z");
});

Deno.test("job.scheduled: five failed attempts mark dead_letter and open a job alert", async () => {
  const row = makeOutboxRow({ id: "outbox-dead-1", attempts: 5 });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.reject(new Error("permanent failure")),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.dead_lettered, 1);
  assertEquals(summary.failed, 0);
  const outboxUpdate = supabase._calls.outboxUpdates[0];
  assertEquals(outboxUpdate.patch.status, "dead_letter");
  assertEquals(outboxUpdate.patch.last_error, "permanent failure");
  const alert = supabase._calls.jobAlertInserts[0];
  assertEquals(alert.fingerprint, "integration:outbox-dead-1");
  assertEquals(alert.job_number, "JOB-2001");
  assertEquals(alert.severity, "at_risk");
  assert(typeof alert.title === "string" && (alert.title as string).includes("job.scheduled"));
});

Deno.test("runDispatch: a succeeded row is marked succeeded exactly once and is not reprocessed on a later empty claim", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.resolve({ id: "evt-x" }),
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  const summary1 = await runDispatch(deps);
  assertEquals(summary1.succeeded, 1);
  assertEquals(supabase._calls.outboxUpdates.filter((u) => u.id === row.id).length, 1);

  // The claim RPC itself is what enforces "never claim a succeeded row
  // again" — this dispatcher's own job is to mark an id succeeded exactly
  // once per claim, which the second (empty) claim below proves it does.
  supabase._setClaimRows([]);
  const summary2 = await runDispatch(deps);
  assertEquals(summary2.claimed, 0);
  assertEquals(supabase._calls.outboxUpdates.filter((u) => u.id === row.id).length, 1);
});

Deno.test("job.scheduled: posts one crew Slack notification without financial fields", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow({ estimate_value: 9999 });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const slackCalls: Array<{ channel: string; text: string }> = [];
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.resolve({ id: "evt-x" }),
    postSlackMessage: (channel: string, text: string) => {
      slackCalls.push({ channel, text });
      return Promise.resolve({ ok: true });
    },
  });
  await runDispatch(deps);
  assertEquals(slackCalls.length, 1);
  assertEquals(slackCalls[0].channel, "C1");
  assert(!slackCalls[0].text.includes("$"));
  assert(!slackCalls[0].text.includes("9999"));
  const jobUpdate = supabase._calls.jobsUpdates.find((u) => "slack_notified_at" in u.patch);
  assertEquals(jobUpdate?.patch.slack_notified_at, "2026-08-20T12:00:00.000Z");
});

Deno.test("job.scheduled: slack skip when already notified after this event's creation", async () => {
  const row = makeOutboxRow({ created_at: "2026-08-20T00:00:00.000Z" });
  const jobRow = makeJobRow({ slack_notified_at: "2026-08-20T05:00:00.000Z" });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.resolve({ id: "evt-x" }),
    // postSlackMessage intentionally unwired — rejects if called
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  const jobUpdate = supabase._calls.jobsUpdates.find((u) => "slack_notified_at" in u.patch);
  assertEquals(jobUpdate, undefined);
});

Deno.test("job.scheduled: slack re-notifies when the event's created_at is newer than the prior notification (reschedule)", async () => {
  const row = makeOutboxRow({ created_at: "2026-08-20T10:00:00.000Z" });
  const jobRow = makeJobRow({ slack_notified_at: "2026-08-19T05:00:00.000Z" });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  let slackCallCount = 0;
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.resolve({ id: "evt-x" }),
    postSlackMessage: () => {
      slackCallCount++;
      return Promise.resolve({ ok: true });
    },
  });
  await runDispatch(deps);
  assertEquals(slackCallCount, 1);
});

// ── job.scheduled: required-leg misconfiguration THROWS (review round 1,
//    finding 2 — orchestrator fix policy). Every leg the payload requires
//    must be delivered or the event fails loudly, matching job.cancelled's
//    existing policy — no more silent "succeeded" while a crew's calendar/
//    Slack channel is unset or the crew string doesn't map to Crew 1-4. ───

Deno.test("job.scheduled: unmappable crew string throws — no calendar/slack calls made", async () => {
  const row = makeOutboxRow({
    payload: {
      job_number: "JOB-2001",
      crew: "Jackson", // not one of Crew 1-4
      start_date: "2026-08-18",
      end_date: "2026-08-19",
      calendar_sync_revision: 1,
    },
  });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({ supabase }); // every network dep rejects if called
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assertEquals(summary.succeeded, 0);
  assert(summary.results[0].detail?.includes("Jackson"));
  assertEquals(supabase._calls.jobsUpdates.length, 0);
});

Deno.test("job.scheduled: unset crew calendar id throws", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    calendarIds: { main: "cal-main", crew1: "", crew2: "cal-crew2", crew3: "cal-crew3", crew4: "cal-crew4" },
    createCalendarEvent: () => Promise.reject(new Error("should not be called — main leg must not run before validation")),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assert(summary.results[0].detail?.includes("no calendar configured"));
});

Deno.test("job.scheduled: unset crew Slack channel throws", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    slackChannels: { crew1: "", crew2: "C2", crew3: "C3", crew4: "C4" },
    createCalendarEvent: () => Promise.reject(new Error("should not be called — validated before any network call")),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assert(summary.results[0].detail?.includes("no Slack channel configured"));
});

Deno.test("job.scheduled: unset main calendar throws", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    calendarIds: { main: "", crew1: "cal-crew1", crew2: "cal-crew2", crew3: "cal-crew3", crew4: "cal-crew4" },
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assert(summary.results[0].detail?.includes("main calendar not configured"));
});

// ── ghl.stage.requested ───────────────────────────────────────────────────

Deno.test("ghl.stage.requested: asserts pipeline membership — wrong pipeline fails, no stage PUT", async () => {
  const row = makeOutboxRow({
    event_type: "ghl.stage.requested",
    payload: { stage: "Job Scheduled", job_number: "JOB-2001", ghl_opportunity_id: "opp-1" },
  });
  const supabase = createMockSupabase({ claimRows: [row] });
  let putCalled = false;
  const deps = makeDeps({
    supabase,
    fetchPipelines: () => Promise.resolve(makePipelines()),
    fetchOpportunity: () => Promise.resolve({ opportunity: { id: "opp-1", pipelineId: "pipeline-contractor" } }),
    updateOpportunityStage: () => {
      putCalled = true;
      return Promise.resolve({});
    },
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assertEquals(summary.succeeded, 0);
  assertEquals(putCalled, false);
});

Deno.test("ghl.stage.requested: puts the resolved stage id and logs app_to_ghl", async () => {
  const row = makeOutboxRow({
    event_type: "ghl.stage.requested",
    payload: { stage: "Job Scheduled", job_number: "JOB-2001", ghl_opportunity_id: "opp-1" },
  });
  const supabase = createMockSupabase({ claimRows: [row] });
  let putArgs: [string, string] | null = null;
  const deps = makeDeps({
    supabase,
    fetchPipelines: () => Promise.resolve(makePipelines()),
    fetchOpportunity: () => Promise.resolve({ opportunity: { id: "opp-1", pipelineId: "pipeline-job" } }),
    updateOpportunityStage: (opportunityId: string, stageId: string) => {
      putArgs = [opportunityId, stageId];
      return Promise.resolve({});
    },
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(putArgs, ["opp-1", "stage-job-scheduled"]);
  const logRow = supabase._calls.syncLogInserts[0];
  assertEquals(logRow.direction, "app_to_ghl");
  assertEquals(logRow.action_taken, "updated");
  assertEquals(logRow.status, "success");
});

Deno.test("ghl.stage.requested: unresolvable stage name fails without fetching the opportunity", async () => {
  const row = makeOutboxRow({
    event_type: "ghl.stage.requested",
    payload: { stage: "Not A Real Stage", job_number: "JOB-2001", ghl_opportunity_id: "opp-1" },
  });
  const supabase = createMockSupabase({ claimRows: [row] });
  let fetchOpportunityCalled = false;
  const deps = makeDeps({
    supabase,
    fetchPipelines: () => Promise.resolve(makePipelines()),
    fetchOpportunity: () => {
      fetchOpportunityCalled = true;
      return Promise.reject(new Error("should not be called"));
    },
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assertEquals(fetchOpportunityCalled, false);
});

Deno.test("ghl.stage.requested: fetchPipelines is called once per batch even with two stage-request events", async () => {
  const row1 = makeOutboxRow({
    id: "outbox-a",
    event_type: "ghl.stage.requested",
    payload: { stage: "Quote Accepted", job_number: "JOB-2001", ghl_opportunity_id: "opp-1" },
  });
  const row2 = makeOutboxRow({
    id: "outbox-b",
    event_type: "ghl.stage.requested",
    payload: { stage: "Job Scheduled", job_number: "JOB-2002", ghl_opportunity_id: "opp-2" },
  });
  const supabase = createMockSupabase({ claimRows: [row1, row2] });
  let fetchPipelinesCalls = 0;
  const deps = makeDeps({
    supabase,
    fetchPipelines: () => {
      fetchPipelinesCalls++;
      return Promise.resolve(makePipelines());
    },
    fetchOpportunity: (id: string) => Promise.resolve({ opportunity: { id, pipelineId: "pipeline-job" } }),
    updateOpportunityStage: () => Promise.resolve({}),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 2);
  assertEquals(fetchPipelinesCalls, 1);
});

// ── ghl.stage.requested: needle stripping + ambiguity/empty-id guards
//    (review round 1, finding 4). Mirrors web/src/lib/ghl/pipeline.ts's
//    resolveStage exactly: strip the parenthetical before matching, and
//    throw (never silently pick) on an ambiguous or id-less match. ────────

Deno.test('ghl.stage.requested: "Closed Lost / Declined"-shaped live rename still matches the literal payload value', async () => {
  const row = makeOutboxRow({
    event_type: "ghl.stage.requested",
    payload: { stage: "Closed Lost (Declined)", job_number: "JOB-2001", ghl_opportunity_id: "opp-1" },
  });
  const supabase = createMockSupabase({ claimRows: [row] });
  let putArgs: [string, string] | null = null;
  const renamedPipelines: GhlPipeline[] = [
    {
      id: "pipeline-job",
      name: "Job Pipeline",
      // Live-renamed wording (CLAUDE.md's own pipeline table), no
      // parenthetical — the raw payload value "Closed Lost (Declined)"
      // would NOT be a substring of this without needle stripping.
      stages: [{ id: "stage-closed-lost", name: "Closed Lost / Declined" }],
    },
  ];
  const deps = makeDeps({
    supabase,
    fetchPipelines: () => Promise.resolve(renamedPipelines),
    fetchOpportunity: () => Promise.resolve({ opportunity: { id: "opp-1", pipelineId: "pipeline-job" } }),
    updateOpportunityStage: (opportunityId: string, stageId: string) => {
      putArgs = [opportunityId, stageId];
      return Promise.resolve({});
    },
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(putArgs, ["opp-1", "stage-closed-lost"]);
});

Deno.test("ghl.stage.requested: ambiguous stage match throws, no PUT", async () => {
  const row = makeOutboxRow({
    event_type: "ghl.stage.requested",
    payload: { stage: "Closed Lost (Declined)", job_number: "JOB-2001", ghl_opportunity_id: "opp-1" },
  });
  const supabase = createMockSupabase({ claimRows: [row] });
  const ambiguousPipelines: GhlPipeline[] = [
    {
      id: "pipeline-job",
      name: "Job Pipeline",
      // Two live stages both contain the cleaned needle "closed lost".
      stages: [
        { id: "stage-closed-lost-a", name: "Closed Lost (Declined)" },
        { id: "stage-closed-lost-b", name: "Closed Lost - Refunded" },
      ],
    },
  ];
  let putCalled = false;
  const deps = makeDeps({
    supabase,
    fetchPipelines: () => Promise.resolve(ambiguousPipelines),
    fetchOpportunity: () => {
      putCalled = true; // proxy: fetchOpportunity must not even be reached
      return Promise.reject(new Error("should not be called"));
    },
    updateOpportunityStage: () => Promise.resolve({}),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assert(summary.results[0].detail?.includes("AMBIGUOUS"));
  assertEquals(putCalled, false);
});

Deno.test("ghl.stage.requested: matched stage with no usable id throws", async () => {
  const row = makeOutboxRow({
    event_type: "ghl.stage.requested",
    payload: { stage: "Job Scheduled", job_number: "JOB-2001", ghl_opportunity_id: "opp-1" },
  });
  const supabase = createMockSupabase({ claimRows: [row] });
  const idlessPipelines: GhlPipeline[] = [
    {
      id: "pipeline-job",
      name: "Job Pipeline",
      stages: [{ id: "", name: "Job Scheduled" }],
    },
  ];
  const deps = makeDeps({
    supabase,
    fetchPipelines: () => Promise.resolve(idlessPipelines),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assert(summary.results[0].detail?.includes("no id"));
});

// ── job.cancelled ─────────────────────────────────────────────────────────

Deno.test("job.cancelled: deletes both managed events, treats 404 as gone (via the deps contract), clears ids", async () => {
  const row = makeOutboxRow({
    event_type: "job.cancelled",
    payload: {
      job_number: "JOB-2001",
      resolution: "postponed",
      gcal_main_event_id: "evt-main-1",
      gcal_crew_event_id: "evt-crew-1",
      crew: "Crew 1",
    },
  });
  const jobRow = makeJobRow({ gcal_main_event_id: "evt-main-1", gcal_crew_event_id: "evt-crew-1" });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deleteCalls: Array<{ calendarId: string; eventId: string }> = [];
  const deps = makeDeps({
    supabase,
    // deleteCalendarEvent's OWN 404/410-swallowing contract lives in
    // _shared/google.ts (see google_test.ts-equivalent coverage there);
    // this mock just resolves cleanly, which is exactly what that contract
    // guarantees callers see even when the real event is already gone.
    deleteCalendarEvent: (calendarId: string, eventId: string) => {
      deleteCalls.push({ calendarId, eventId });
      return Promise.resolve();
    },
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(deleteCalls.length, 2);
  assertEquals(deleteCalls[0], { calendarId: "cal-main", eventId: "evt-main-1" });
  assertEquals(deleteCalls[1], { calendarId: "cal-crew1", eventId: "evt-crew-1" });
  const jobUpdate = supabase._calls.jobsUpdates[0];
  assertEquals(jobUpdate.patch.gcal_main_event_id, null);
  assertEquals(jobUpdate.patch.gcal_crew_event_id, null);
});

Deno.test("job.cancelled: only the payload-present event ids are deleted", async () => {
  const row = makeOutboxRow({
    event_type: "job.cancelled",
    payload: {
      job_number: "JOB-2001",
      resolution: "closed_lost",
      gcal_main_event_id: "evt-main-1",
      gcal_crew_event_id: null,
      crew: null,
    },
  });
  const jobRow = makeJobRow({ gcal_main_event_id: "evt-main-1", gcal_crew_event_id: null });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deleteCalls: Array<{ calendarId: string; eventId: string }> = [];
  const deps = makeDeps({
    supabase,
    deleteCalendarEvent: (calendarId: string, eventId: string) => {
      deleteCalls.push({ calendarId, eventId });
      return Promise.resolve();
    },
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(deleteCalls.length, 1);
  const jobUpdate = supabase._calls.jobsUpdates[0];
  assertEquals(jobUpdate.patch, { gcal_main_event_id: null });
});

Deno.test("job.cancelled: no Slack, no GHL calls", async () => {
  const row = makeOutboxRow({
    event_type: "job.cancelled",
    payload: {
      job_number: "JOB-2001",
      resolution: "postponed",
      gcal_main_event_id: "evt-main-1",
      gcal_crew_event_id: "evt-crew-1",
      crew: "Crew 1",
    },
  });
  const jobRow = makeJobRow({ gcal_main_event_id: "evt-main-1", gcal_crew_event_id: "evt-crew-1" });
  const supabase = createMockSupabase({ claimRows: [row], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    deleteCalendarEvent: () => Promise.resolve(),
    // postSlackMessage, fetchOpportunity, updateOpportunityStage all
    // unwired -> reject if called
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(supabase._calls.syncLogInserts.length, 0);
});

// ── Bookkeeping-write failure visibility (review round 1, finding 3).
//    markSucceeded/markFailed/insertJobAlert used to only console.error on
//    their own write failure while the summary reported a clean outcome —
//    a row stuck in 'processing' silently gets re-claimed and reprocessed
//    on the next run. bookkeepingError must surface it. ────────────────────

Deno.test("bookkeeping failure on the SUCCESS path is surfaced as bookkeepingError, outcome stays succeeded", async () => {
  const row = makeOutboxRow();
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({
    claimRows: [row],
    jobsByNumber: { "JOB-2001": jobRow },
    outboxUpdateError: { message: "connection reset" },
  });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.resolve({ id: "evt-x" }),
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.succeeded, 1);
  assertEquals(summary.results[0].outcome, "succeeded");
  assertEquals(summary.results[0].bookkeepingError, "connection reset");
});

Deno.test("bookkeeping failure on the FAILED (non-dead-letter) path is surfaced as bookkeepingError", async () => {
  const row = makeOutboxRow({ attempts: 1 });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({
    claimRows: [row],
    jobsByNumber: { "JOB-2001": jobRow },
    outboxUpdateError: { message: "write timeout" },
  });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.reject(new Error("network blip")),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assertEquals(summary.results[0].outcome, "failed");
  assertEquals(summary.results[0].bookkeepingError, "write timeout");
});

Deno.test("bookkeeping failure on the DEAD_LETTER path folds outbox-update AND job_alerts-insert errors together", async () => {
  const row = makeOutboxRow({ attempts: 5 });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({
    claimRows: [row],
    jobsByNumber: { "JOB-2001": jobRow },
    outboxUpdateError: { message: "outbox write failed" },
    jobAlertInsertError: { code: "42501", message: "permission denied for table job_alerts" },
  });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.reject(new Error("permanent failure")),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.dead_lettered, 1);
  assertEquals(summary.results[0].outcome, "dead_letter");
  assert(summary.results[0].bookkeepingError?.includes("outbox write failed"));
  assert(summary.results[0].bookkeepingError?.includes("permission denied for table job_alerts"));
});

Deno.test("a benign 23505 job_alerts dedup hit is NOT surfaced as a bookkeeping error", async () => {
  const row = makeOutboxRow({ attempts: 5 });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({
    claimRows: [row],
    jobsByNumber: { "JOB-2001": jobRow },
    jobAlertInsertError: { code: "23505", message: "duplicate key value violates unique constraint" },
  });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.reject(new Error("permanent failure")),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.dead_lettered, 1);
  assertEquals(summary.results[0].bookkeepingError, undefined);
});

// ── Unknown event type / batch isolation ────────────────────────────────────

Deno.test("unknown event_type takes the failure path", async () => {
  const row = makeOutboxRow({ event_type: "mystery.event", payload: {} });
  const supabase = createMockSupabase({ claimRows: [row] });
  const deps = makeDeps({ supabase });
  const summary = await runDispatch(deps);
  assertEquals(summary.failed, 1);
  assertEquals(summary.results[0].outcome, "failed");
  assert(summary.results[0].detail?.includes("mystery.event"));
});

Deno.test("unknown event_type dead-letters at 5 attempts like anything else (R6 — no special-casing)", async () => {
  const row = makeOutboxRow({ event_type: "mystery.event", payload: {}, attempts: 5 });
  const supabase = createMockSupabase({ claimRows: [row] });
  const deps = makeDeps({ supabase });
  const summary = await runDispatch(deps);
  assertEquals(summary.dead_lettered, 1);
  assertEquals(supabase._calls.jobAlertInserts.length, 1);
});

Deno.test("one event's throw does not kill the batch — the second event still processes", async () => {
  const row1 = makeOutboxRow({ id: "outbox-a", event_type: "mystery.event", payload: {} });
  const row2 = makeOutboxRow({ id: "outbox-b" });
  const jobRow = makeJobRow();
  const supabase = createMockSupabase({ claimRows: [row1, row2], jobsByNumber: { "JOB-2001": jobRow } });
  const deps = makeDeps({
    supabase,
    createCalendarEvent: () => Promise.resolve({ id: "evt-x" }),
    postSlackMessage: () => Promise.resolve({ ok: true }),
  });
  const summary = await runDispatch(deps);
  assertEquals(summary.claimed, 2);
  assertEquals(summary.failed, 1);
  assertEquals(summary.succeeded, 1);
});
