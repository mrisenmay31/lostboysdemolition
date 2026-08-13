import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseWebhookBody,
  mapContactToLabelInput,
  getCustomFieldValue,
  normalizeJobAddress,
  resolveClientType,
  buildContactAddress,
  findStageId,
  handleQuoteAccepted,
  JOB_ADDRESS_FIELD_ID,
  JOB_NUMBER_FIELD_ID,
  // ── Task 4: schedule path ──
  CREW_FIELD_ID,
  START_DATE_FIELD_ID,
  END_DATE_FIELD_ID,
  normalizeCrew,
  normalizeScheduleDate,
  extractScheduleFields,
  shouldSkipSchedule,
  resolveCrewEnvKey,
  buildCalendarDescription,
  buildCalendarEventBody,
  buildSlackScheduleMessage,
  handleJobScheduled,
} from "./handlers.ts";

// ── parseWebhookBody ─────────────────────────────────────────────────────────

Deno.test("parseWebhookBody: valid quote_accepted body", () => {
  assertEquals(
    parseWebhookBody({ event: "quote_accepted", opportunityId: "opp123" }),
    { event: "quote_accepted", opportunityId: "opp123" },
  );
});

Deno.test("parseWebhookBody: valid job_scheduled body", () => {
  assertEquals(
    parseWebhookBody({ event: "job_scheduled", opportunityId: "opp456" }),
    { event: "job_scheduled", opportunityId: "opp456" },
  );
});

Deno.test("parseWebhookBody: missing event", () => {
  const result = parseWebhookBody({ opportunityId: "opp123" }) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("parseWebhookBody: unknown event", () => {
  const result = parseWebhookBody({ event: "job_completed", opportunityId: "opp123" }) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("parseWebhookBody: missing opportunityId", () => {
  const result = parseWebhookBody({ event: "quote_accepted" }) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("parseWebhookBody: empty string opportunityId", () => {
  const result = parseWebhookBody({ event: "quote_accepted", opportunityId: "" }) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("parseWebhookBody: non-string opportunityId", () => {
  const result = parseWebhookBody({ event: "quote_accepted", opportunityId: 123 }) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("parseWebhookBody: null body", () => {
  const result = parseWebhookBody(null) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("parseWebhookBody: non-object body", () => {
  const result = parseWebhookBody("not an object") as { error: string };
  assertEquals(typeof result.error, "string");
});

// ── mapContactToLabelInput ────────────────────────────────────────────────────

Deno.test("mapContactToLabelInput: full contact", () => {
  assertEquals(
    mapContactToLabelInput({ companyName: "Sunline Landscape", firstName: "Ann", lastName: "Morrison" }),
    { companyName: "Sunline Landscape", firstName: "Ann", lastName: "Morrison" },
  );
});

Deno.test("mapContactToLabelInput: missing fields become null", () => {
  assertEquals(
    mapContactToLabelInput({ firstName: "Ann" }),
    { companyName: null, firstName: "Ann", lastName: null },
  );
});

Deno.test("mapContactToLabelInput: null/undefined contact", () => {
  assertEquals(mapContactToLabelInput(null), { companyName: null, firstName: null, lastName: null });
  assertEquals(mapContactToLabelInput(undefined), { companyName: null, firstName: null, lastName: null });
});

Deno.test("mapContactToLabelInput: non-string field values are coerced to null, not passed through", () => {
  assertEquals(
    mapContactToLabelInput({ companyName: 42, firstName: { weird: true }, lastName: "Morrison" }),
    { companyName: null, firstName: null, lastName: "Morrison" },
  );
});

// ── getCustomFieldValue ────────────────────────────────────────────────────────

Deno.test("getCustomFieldValue: finds by id, field_value key", () => {
  const fields = [{ id: "abc", field_value: "123 Main St" }];
  assertEquals(getCustomFieldValue(fields, "abc"), "123 Main St");
});

Deno.test("getCustomFieldValue: finds by fieldId key, fieldValue value key", () => {
  const fields = [{ fieldId: "abc", fieldValue: "123 Main St" }];
  assertEquals(getCustomFieldValue(fields, "abc"), "123 Main St");
});

Deno.test("getCustomFieldValue: finds by value key", () => {
  const fields = [{ id: "abc", value: "123 Main St" }];
  assertEquals(getCustomFieldValue(fields, "abc"), "123 Main St");
});

Deno.test("getCustomFieldValue: not found returns undefined", () => {
  const fields = [{ id: "xyz", field_value: "nope" }];
  assertEquals(getCustomFieldValue(fields, "abc"), undefined);
});

Deno.test("getCustomFieldValue: non-array input returns undefined", () => {
  assertEquals(getCustomFieldValue(undefined, "abc"), undefined);
  assertEquals(getCustomFieldValue(null, "abc"), undefined);
  assertEquals(getCustomFieldValue("not an array" as any, "abc"), undefined);
});

// ── normalizeJobAddress (fix round 1: I1 coercion + I6 empty-string) ──────────

Deno.test("normalizeJobAddress: valid string passes through trimmed", () => {
  assertEquals(normalizeJobAddress("  4285 S 300 W, Murray, UT  "), "4285 S 300 W, Murray, UT");
});

Deno.test("normalizeJobAddress: empty string becomes null", () => {
  assertEquals(normalizeJobAddress(""), null);
});

Deno.test("normalizeJobAddress: whitespace-only string becomes null", () => {
  assertEquals(normalizeJobAddress("   "), null);
});

Deno.test("normalizeJobAddress: non-string values become null instead of throwing", () => {
  assertEquals(normalizeJobAddress(undefined), null);
  assertEquals(normalizeJobAddress(null), null);
  assertEquals(normalizeJobAddress(42), null);
  assertEquals(normalizeJobAddress({ weird: "object" }), null);
  assertEquals(normalizeJobAddress(["array"]), null);
});

// ── resolveClientType ────────────────────────────────────────────────────────

Deno.test("resolveClientType: contractor tag", () => {
  assertEquals(resolveClientType(["Contractor"]), "Contractor");
});

Deno.test("resolveClientType: homeowner tag, case-insensitive", () => {
  assertEquals(resolveClientType(["homeowner"]), "Homeowner");
});

Deno.test("resolveClientType: mixed tags picks known one", () => {
  assertEquals(resolveClientType(["VIP", "Contractor"]), "Contractor");
});

Deno.test("resolveClientType: no matching tags returns null", () => {
  assertEquals(resolveClientType(["VIP"]), null);
});

Deno.test("resolveClientType: empty or missing tags returns null", () => {
  assertEquals(resolveClientType([]), null);
  assertEquals(resolveClientType(undefined), null);
  assertEquals(resolveClientType(null), null);
});

// ── buildContactAddress ────────────────────────────────────────────────────────

Deno.test("buildContactAddress: full address", () => {
  assertEquals(
    buildContactAddress({ address1: "4285 S 300 W", city: "Murray", state: "UT", postalCode: "84107" }),
    "4285 S 300 W, Murray, UT, 84107",
  );
});

Deno.test("buildContactAddress: partial fields only join present ones", () => {
  assertEquals(buildContactAddress({ city: "Murray", state: "UT" }), "Murray, UT");
});

Deno.test("buildContactAddress: no address fields returns null", () => {
  assertEquals(buildContactAddress({}), null);
});

Deno.test("buildContactAddress: null contact returns null", () => {
  assertEquals(buildContactAddress(null), null);
});

// ── findStageId ────────────────────────────────────────────────────────────────

const SAMPLE_STAGES = [
  { id: "s1", name: "New Lead" },
  { id: "s2", name: "Quote Sent" },
  { id: "s3", name: "Quote Accepted / Pending Schedule" },
  { id: "s4", name: "Deposit Received/Job Scheduled" },
];

Deno.test("findStageId: matches 'quote accepted' case-insensitively", () => {
  assertEquals(findStageId(SAMPLE_STAGES, "quote accepted"), "s3");
});

Deno.test("findStageId: matches 'job scheduled' via substring in a combined stage name", () => {
  assertEquals(findStageId(SAMPLE_STAGES, "job scheduled"), "s4");
});

Deno.test("findStageId: no match returns null", () => {
  assertEquals(findStageId(SAMPLE_STAGES, "invoice sent"), null);
});

Deno.test("findStageId: empty stage list returns null", () => {
  assertEquals(findStageId([], "quote accepted"), null);
});

// ── field ID constants sanity (sourced from field_mapping.md) ─────────────────

Deno.test("field ID constants are non-empty strings", () => {
  assertEquals(typeof JOB_ADDRESS_FIELD_ID, "string");
  assertEquals(JOB_ADDRESS_FIELD_ID.length > 0, true);
  assertEquals(typeof JOB_NUMBER_FIELD_ID, "string");
  assertEquals(JOB_NUMBER_FIELD_ID.length > 0, true);
});

// ── handleQuoteAccepted (deps-injected orchestration) ──────────────────────────
//
// fakeSupabase is queue-aware for `.from("jobs").select().eq().maybeSingle()`
// calls specifically (fix round 1, I2): handleQuoteAccepted can call this up
// to twice in one invocation — the pre-insert idempotency check, and (on a
// 23505) the post-insert re-read — and the two calls need independently
// controllable results to test the race paths. `selectResults` is consumed
// in call order; once exhausted, further calls resolve to `null`.

interface FakeJobRow {
  id: string;
  job_number: string;
  job_name: string;
}

function fakeSupabase(opts: {
  selectResults?: Array<FakeJobRow | null>;
  insertError?: { code?: string; message?: string; details?: string } | null;
  rpcResult?: { data: any; error: any };
} = {}) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const selectQueue: Array<FakeJobRow | null> = opts.selectResults ? [...opts.selectResults] : [null];

  return {
    _inserted: inserted,
    rpc(fn: string) {
      if (fn === "next_job_number") {
        return Promise.resolve(opts.rpcResult ?? { data: "JOB-1102", error: null });
      }
      return Promise.resolve({ data: null, error: new Error(`unexpected rpc ${fn}`) });
    },
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                maybeSingle: () => {
                  const next = selectQueue.length > 0 ? selectQueue.shift()! : null;
                  return Promise.resolve({ data: next, error: null });
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return {
            select(_cols: string) {
              return {
                single: () =>
                  Promise.resolve(
                    table === "jobs" && opts.insertError
                      ? { data: null, error: opts.insertError }
                      : { data: { id: "uuid-1", job_number: row.job_number }, error: null },
                  ),
              };
            },
          };
        },
      };
    },
  };
}

function happyDeps(overrides: Partial<{
  fetchOpportunity: () => Promise<any>;
  fetchContact: () => Promise<any>;
  updateOpportunity: () => Promise<any>;
}> = {}) {
  return {
    fetchOpportunity:
      overrides.fetchOpportunity ??
      (() =>
        Promise.resolve({
          opportunity: {
            contactId: "contact-1",
            monetaryValue: 4200,
            customFields: [{ id: JOB_ADDRESS_FIELD_ID, field_value: "4285 S 300 W, Murray, UT 84107" }],
          },
        })),
    fetchContact:
      overrides.fetchContact ??
      (() =>
        Promise.resolve({
          contact: { id: "contact-1", firstName: "Ann", lastName: "Morrison", tags: ["Homeowner"] },
        })),
    updateOpportunity: overrides.updateOpportunity ?? (() => Promise.resolve({ success: true })),
  };
}

Deno.test("handleQuoteAccepted: idempotent skip when job already exists, self-heals GHL write-back", async () => {
  const existingJob = { id: "uuid-9", job_number: "JOB-1050", job_name: "JOB-1050 – Smith" };
  const supabase = fakeSupabase({ selectResults: [existingJob] });
  let updateCalledWith: [string, Record<string, unknown>] | null = null;
  const deps = {
    supabase,
    fetchOpportunity: () => Promise.reject(new Error("should not be called")),
    fetchContact: () => Promise.reject(new Error("should not be called")),
    updateOpportunity: (id: string, body: Record<string, unknown>) => {
      updateCalledWith = [id, body];
      return Promise.resolve({ success: true });
    },
    payloadIn: { event: "quote_accepted", opportunityId: "opp-1" },
  };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body, { action: "skipped", job_number: "JOB-1050", ghl_update: "success" });
  // I3: skip path re-attempts the idempotent PUT (name + job-number custom field).
  assertEquals(updateCalledWith, [
    "opp-1",
    { name: "JOB-1050 – Smith", customFields: [{ id: JOB_NUMBER_FIELD_ID, field_value: "JOB-1050" }] },
  ]);
});

Deno.test("handleQuoteAccepted: idempotent skip — GHL write-back retry failure is non-fatal", async () => {
  const existingJob = { id: "uuid-9", job_number: "JOB-1050", job_name: "JOB-1050 – Smith" };
  const supabase = fakeSupabase({ selectResults: [existingJob] });
  const deps = {
    supabase,
    fetchOpportunity: () => Promise.reject(new Error("should not be called")),
    fetchContact: () => Promise.reject(new Error("should not be called")),
    updateOpportunity: () => Promise.reject(new Error("GHL down")),
    payloadIn: { event: "quote_accepted", opportunityId: "opp-1" },
  };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body, { action: "skipped", job_number: "JOB-1050", ghl_update: "failed" });
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites[0].row.status, "error");
});

Deno.test("handleQuoteAccepted: creates job on happy path", async () => {
  const supabase = fakeSupabase();
  const deps = { supabase, ...happyDeps(), payloadIn: { event: "quote_accepted", opportunityId: "opp-1" } };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.action, "created");
  assertEquals(result.body.job_number, "JOB-1102");
  assertEquals(result.body.ghl_update, "success");
  const jobsInserted = supabase._inserted.filter((i: any) => i.table === "jobs");
  assertEquals(jobsInserted.length, 1);
  assertEquals(jobsInserted[0].row.client_name, "Morrison");
  assertEquals(jobsInserted[0].row.client_type, "Homeowner");
  assertEquals(jobsInserted[0].row.city, "Murray");
  assertEquals(jobsInserted[0].row.estimate_value, 4200);
  assertEquals(jobsInserted[0].row.status_v2, "accepted");
  assertEquals(jobsInserted[0].row.ghl_opportunity_id, "opp-1");
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites.length, 1);
  assertEquals(syncLogWrites[0].row.action_taken, "created");
});

Deno.test("handleQuoteAccepted: non-fatal GHL update failure on create still returns 200", async () => {
  const supabase = fakeSupabase();
  const deps = {
    supabase,
    ...happyDeps({ updateOpportunity: () => Promise.reject(new Error("GHL down")) }),
    payloadIn: { event: "quote_accepted", opportunityId: "opp-2" },
  };
  const result = await handleQuoteAccepted(deps as any, "opp-2");
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.ghl_update, "failed");
});

Deno.test("handleQuoteAccepted: empty-string Job Address custom field falls through to contact address fallback (I6)", async () => {
  const supabase = fakeSupabase();
  const deps = {
    supabase,
    ...happyDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            contactId: "contact-1",
            monetaryValue: 500,
            customFields: [{ id: JOB_ADDRESS_FIELD_ID, field_value: "" }],
          },
        }),
      fetchContact: () =>
        Promise.resolve({
          contact: {
            id: "contact-1",
            firstName: "Ann",
            address1: "100 Elm St",
            city: "Sandy",
            state: "UT",
            postalCode: "84070",
          },
        }),
    }),
    payloadIn: {},
  };
  await handleQuoteAccepted(deps as any, "opp-empty-addr");
  const jobsInserted = supabase._inserted.filter((i: any) => i.table === "jobs");
  assertEquals(jobsInserted[0].row.job_address, "100 Elm St, Sandy, UT, 84070");
  assertEquals(jobsInserted[0].row.city, "Sandy");
});

Deno.test("handleQuoteAccepted: non-string Job Address custom field is coerced to null, not thrown (I1)", async () => {
  const supabase = fakeSupabase();
  const deps = {
    supabase,
    ...happyDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            contactId: "contact-1",
            monetaryValue: 500,
            customFields: [{ id: JOB_ADDRESS_FIELD_ID, field_value: { weird: "object" } }],
          },
        }),
      fetchContact: () => Promise.resolve({ contact: { id: "contact-1", firstName: "Ann" } }),
    }),
    payloadIn: {},
  };
  const result = await handleQuoteAccepted(deps as any, "opp-weird-addr");
  assertEquals(result.status, 200);
  const jobsInserted = supabase._inserted.filter((i: any) => i.table === "jobs");
  assertEquals(jobsInserted[0].row.job_address, null);
  assertEquals(jobsInserted[0].row.city, null);
});

Deno.test("handleQuoteAccepted: mint (rpc) failure returns 500, no insert attempted (I2-d)", async () => {
  const supabase = fakeSupabase({ rpcResult: { data: null, error: { message: "db down" } } });
  const deps = { supabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-mint-fail");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
  assertEquals(supabase._inserted.filter((i: any) => i.table === "jobs").length, 0);
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.status, "error");
});

Deno.test("handleQuoteAccepted: GHL opportunity/contact fetch failure returns 500 with error logs (I2-e)", async () => {
  const supabase = fakeSupabase();
  const deps = {
    supabase,
    ...happyDeps({ fetchOpportunity: () => Promise.reject(new Error("GHL unreachable")) }),
    payloadIn: {},
  };
  const result = await handleQuoteAccepted(deps as any, "opp-fetch-fail");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites[0].row.status, "error");
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.status, "error");
});

Deno.test("handleQuoteAccepted: 23505 + re-read finds the row -> 200 skipped with that job_number (I2-a)", async () => {
  const racedJob = { id: "uuid-raced", job_number: "JOB-1050", job_name: "JOB-1050 – Existing" };
  const supabase = fakeSupabase({
    selectResults: [null, racedJob], // pre-check: nothing; post-23505 re-read: found
    insertError: {
      code: "23505",
      message: 'duplicate key value violates unique constraint "jobs_ghl_opportunity_id_key"',
      details: "Key (ghl_opportunity_id)=(opp-race) already exists.",
    },
  });
  const deps = { supabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-race");
  assertEquals(result.status, 200);
  assertEquals(result.body, { action: "skipped", job_number: "JOB-1050", ghl_update: "success" });
});

Deno.test("handleQuoteAccepted: 23505 + re-read finds NOTHING -> 500 error, not a silent skip (C1 fix)", async () => {
  const supabase = fakeSupabase({
    selectResults: [null, null], // pre-check: nothing; post-23505 re-read: STILL nothing
    insertError: {
      code: "23505",
      message: 'duplicate key value violates unique constraint "jobs_job_number_key"',
      details: "Key (job_number)=(JOB-1102) already exists.",
    },
  });
  const deps = { supabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-collision");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
  assertEquals(typeof result.body.error, "string");
  // Must NOT be the benign skip shape — this is the exact misattribution bug C1 flags.
  assertEquals(result.body.action, undefined);
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites.length, 1);
  assertEquals(syncLogWrites[0].row.action_taken, "error");
  assertEquals(syncLogWrites[0].row.status, "error");
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites[0].row.status, "error");
});

Deno.test("handleQuoteAccepted: non-unique insert error -> 500 (I2-c)", async () => {
  const supabase = fakeSupabase({
    selectResults: [null],
    insertError: { code: "23514", message: "check constraint violation" },
  });
  const deps = { supabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-other-error");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
});

Deno.test("handleQuoteAccepted: outer catch converts an unexpected synchronous throw into 500 + error logs (I1)", async () => {
  const logCalls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const throwingSupabase = {
    rpc() {
      return Promise.resolve({ data: "JOB-1102", error: null });
    },
    from(table: string) {
      if (table === "jobs") {
        throw new Error("boom — unexpected synchronous throw");
      }
      // sync_log / job_events writers must still be able to log the failure.
      return {
        insert: (row: Record<string, unknown>) => {
          logCalls.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  const deps = { supabase: throwingSupabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-boom");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
  assertEquals(typeof result.body.error, "string");
  assertEquals(logCalls.some((c) => c.table === "sync_log" && c.row.status === "error"), true);
});

// ── Cleanup fix (I8b): skip-path sync_log now aligns with job_events on a
// failed GHL write-back retry, instead of always claiming status:'success'. ──

Deno.test("handleQuoteAccepted: skip-path sync_log reflects a SUCCESSFUL retry as action_taken:'updated', status:'success' (I8b)", async () => {
  const existingJob = { id: "uuid-9", job_number: "JOB-1050", job_name: "JOB-1050 – Smith" };
  const supabase = fakeSupabase({ selectResults: [existingJob] });
  const deps = {
    supabase,
    fetchOpportunity: () => Promise.reject(new Error("should not be called")),
    fetchContact: () => Promise.reject(new Error("should not be called")),
    updateOpportunity: () => Promise.resolve({ success: true }),
    payloadIn: {},
  };
  await handleQuoteAccepted(deps as any, "opp-1");
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.action_taken, "updated");
  assertEquals(syncLogWrites[0].row.status, "success");
  assertEquals(syncLogWrites[0].row.error_message, null);
});

Deno.test("handleQuoteAccepted: skip-path sync_log reflects a FAILED retry as action_taken:'updated', status:'error' with error_message — aligned with job_events (I8b)", async () => {
  const existingJob = { id: "uuid-9", job_number: "JOB-1050", job_name: "JOB-1050 – Smith" };
  const supabase = fakeSupabase({ selectResults: [existingJob] });
  const deps = {
    supabase,
    fetchOpportunity: () => Promise.reject(new Error("should not be called")),
    fetchContact: () => Promise.reject(new Error("should not be called")),
    updateOpportunity: () => Promise.reject(new Error("GHL down")),
    payloadIn: {},
  };
  await handleQuoteAccepted(deps as any, "opp-1");
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(syncLogWrites[0].row.action_taken, "updated");
  assertEquals(syncLogWrites[0].row.status, "error");
  assertEquals(typeof syncLogWrites[0].row.error_message, "string");
  // The two writes must now agree — both report the degraded outcome.
  assertEquals(syncLogWrites[0].row.status, jobEventWrites[0].row.status);
});

// ============================================================
// ── Task 4: handleJobScheduled — schedule path ──────────────────────────────
// ============================================================

// ── field ID constants sanity ────────────────────────────────────────────────

Deno.test("Task 4 field ID constants are non-empty strings", () => {
  for (const id of [CREW_FIELD_ID, START_DATE_FIELD_ID, END_DATE_FIELD_ID]) {
    assertEquals(typeof id, "string");
    assertEquals(id.length > 0, true);
  }
});

// ── normalizeCrew ─────────────────────────────────────────────────────────────

Deno.test("normalizeCrew: valid string trimmed", () => {
  assertEquals(normalizeCrew("  Crew 1  "), "Crew 1");
});

Deno.test("normalizeCrew: empty/whitespace/non-string become null", () => {
  assertEquals(normalizeCrew(""), null);
  assertEquals(normalizeCrew("   "), null);
  assertEquals(normalizeCrew(undefined), null);
  assertEquals(normalizeCrew(null), null);
  assertEquals(normalizeCrew(42), null);
});

// ── normalizeScheduleDate ──────────────────────────────────────────────────────

Deno.test("normalizeScheduleDate: bare YYYY-MM-DD passes through", () => {
  assertEquals(normalizeScheduleDate("2026-08-20"), "2026-08-20");
});

Deno.test("normalizeScheduleDate: ISO timestamp truncated to date portion", () => {
  assertEquals(normalizeScheduleDate("2026-08-20T00:00:00.000Z"), "2026-08-20");
});

Deno.test("normalizeScheduleDate: invalid calendar date (Feb 30) returns null", () => {
  assertEquals(normalizeScheduleDate("2026-02-30"), null);
});

Deno.test("normalizeScheduleDate: malformed string returns null", () => {
  assertEquals(normalizeScheduleDate("08/20/2026"), null);
  assertEquals(normalizeScheduleDate("not a date"), null);
});

Deno.test("normalizeScheduleDate: empty/whitespace/non-string returns null", () => {
  assertEquals(normalizeScheduleDate(""), null);
  assertEquals(normalizeScheduleDate("   "), null);
  assertEquals(normalizeScheduleDate(undefined), null);
  assertEquals(normalizeScheduleDate(null), null);
  assertEquals(normalizeScheduleDate(12345), null);
});

// ── extractScheduleFields ──────────────────────────────────────────────────────

Deno.test("extractScheduleFields: pulls crew/startDate/endDate by field ID", () => {
  const opp = {
    customFields: [
      { id: CREW_FIELD_ID, field_value: "Crew 2" },
      { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
      { id: END_DATE_FIELD_ID, field_value: "2026-08-21" },
    ],
  };
  assertEquals(extractScheduleFields(opp), { crew: "Crew 2", startDate: "2026-08-20", endDate: "2026-08-21" });
});

Deno.test("extractScheduleFields: missing custom fields all null", () => {
  assertEquals(extractScheduleFields({}), { crew: null, startDate: null, endDate: null });
  assertEquals(extractScheduleFields(null), { crew: null, startDate: null, endDate: null });
});

// ── shouldSkipSchedule ────────────────────────────────────────────────────────

Deno.test("shouldSkipSchedule: no job row -> skip with 'no job record' reason", () => {
  const result = shouldSkipSchedule(null, { crew: "Crew 1", startDate: "2026-08-20", endDate: null });
  assertEquals(result.skip, true);
  assertEquals(result.reason, "no job record — was Quote Accepted skipped?");
});

Deno.test("shouldSkipSchedule: job exists, crew missing -> skip with 'crew or start date not set'", () => {
  const result = shouldSkipSchedule({ id: "j1" }, { crew: null, startDate: "2026-08-20", endDate: null });
  assertEquals(result.skip, true);
  assertEquals(result.reason, "crew or start date not set");
});

Deno.test("shouldSkipSchedule: job exists, start date missing -> skip", () => {
  const result = shouldSkipSchedule({ id: "j1" }, { crew: "Crew 1", startDate: null, endDate: null });
  assertEquals(result.skip, true);
  assertEquals(result.reason, "crew or start date not set");
});

Deno.test("shouldSkipSchedule: job exists, crew + start date both present -> no skip", () => {
  const result = shouldSkipSchedule({ id: "j1" }, { crew: "Crew 1", startDate: "2026-08-20", endDate: null });
  assertEquals(result.skip, false);
  assertEquals(result.reason, undefined);
});

// ── resolveCrewEnvKey ────────────────────────────────────────────────────────

Deno.test("resolveCrewEnvKey: matches case-insensitively and trims", () => {
  assertEquals(resolveCrewEnvKey("Crew 1"), "crew1");
  assertEquals(resolveCrewEnvKey("crew 2"), "crew2");
  assertEquals(resolveCrewEnvKey(" CREW 3 "), "crew3");
  assertEquals(resolveCrewEnvKey("Crew 4"), "crew4");
});

Deno.test("resolveCrewEnvKey: unmapped crew value or null returns null", () => {
  assertEquals(resolveCrewEnvKey("Jackson"), null);
  assertEquals(resolveCrewEnvKey("Other"), null);
  assertEquals(resolveCrewEnvKey(null), null);
});

// ── buildCalendarDescription / buildCalendarEventBody ──────────────────────────

Deno.test("buildCalendarDescription: all fields present", () => {
  const desc = buildCalendarDescription({
    job_name: "JOB-1100 – Morrison – Holladay",
    client_name: "Ann Morrison",
    job_address: "4285 S 300 W, Murray",
    estimate_value: 4200,
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: null,
  });
  assertEquals(
    desc,
    "Client: Ann Morrison\nEstimate: $4,200.00\nCrew: Crew 1\nAddress: 4285 S 300 W, Murray",
  );
});

Deno.test("buildCalendarDescription: omits null lines", () => {
  const desc = buildCalendarDescription({
    job_name: "JOB-1100",
    client_name: null,
    job_address: null,
    estimate_value: null,
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: null,
  });
  assertEquals(desc, "Crew: Crew 1");
});

Deno.test("buildCalendarEventBody: title is full job_name, no scope section", () => {
  const body = buildCalendarEventBody({
    job_name: "JOB-1100 – Morrison – Holladay",
    client_name: "Ann Morrison",
    job_address: "4285 S 300 W, Murray",
    estimate_value: 4200,
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: null,
  });
  assertEquals(body.summary, "JOB-1100 – Morrison – Holladay");
  assertEquals(body.start, { date: "2026-08-20" });
  // No end_date on the job -> falls back to start_date, then addOneDay (exclusive end).
  assertEquals(body.end, { date: "2026-08-21" });
});

Deno.test("buildCalendarEventBody: end_date present uses addOneDay(end_date), not start_date", () => {
  const body = buildCalendarEventBody({
    job_name: "JOB-1100",
    client_name: null,
    job_address: null,
    estimate_value: null,
    crew: null,
    start_date: "2026-08-20",
    end_date: "2026-08-22",
  });
  assertEquals(body.start, { date: "2026-08-20" });
  assertEquals(body.end, { date: "2026-08-23" });
});

// ── buildSlackScheduleMessage ──────────────────────────────────────────────────

Deno.test("buildSlackScheduleMessage: exact string, all fields present", () => {
  const msg = buildSlackScheduleMessage({
    job_name: "JOB-1100 – Morrison – Holladay",
    start_date: "2026-08-20",
    job_address: "4285 S 300 W, Murray",
    client_name: "Ann Morrison",
  });
  assertEquals(
    msg,
    "🏗️ New job scheduled: JOB-1100 – Morrison – Holladay\n📅 Thu Aug 20\n📍 4285 S 300 W, Murray\n👤 Ann Morrison",
  );
});

Deno.test("buildSlackScheduleMessage: omits 📍 line when job_address null", () => {
  const msg = buildSlackScheduleMessage({
    job_name: "JOB-1100",
    start_date: "2026-08-20",
    job_address: null,
    client_name: "Ann Morrison",
  });
  assertEquals(msg, "🏗️ New job scheduled: JOB-1100\n📅 Thu Aug 20\n👤 Ann Morrison");
});

Deno.test("buildSlackScheduleMessage: omits 👤 line when client_name null", () => {
  const msg = buildSlackScheduleMessage({
    job_name: "JOB-1100",
    start_date: "2026-08-20",
    job_address: "4285 S 300 W, Murray",
    client_name: null,
  });
  assertEquals(msg, "🏗️ New job scheduled: JOB-1100\n📅 Thu Aug 20\n📍 4285 S 300 W, Murray");
});

Deno.test("buildSlackScheduleMessage: omits both when address and client null", () => {
  const msg = buildSlackScheduleMessage({
    job_name: "JOB-1100",
    start_date: "2026-08-20",
    job_address: null,
    client_name: null,
  });
  assertEquals(msg, "🏗️ New job scheduled: JOB-1100\n📅 Thu Aug 20");
});

// ── handleJobScheduled (deps-injected orchestration) ────────────────────────────

interface FakeScheduleJobRow {
  id: string;
  job_number: string;
  job_name: string;
  client_name: string | null;
  job_address: string | null;
  estimate_value: number | null;
  crew: string | null;
  start_date: string | null;
  end_date: string | null;
  gcal_main_event_id: string | null;
  gcal_crew_event_id: string | null;
  slack_notified_at: string | null;
  bill_job_code: string | null;
}

function fakeScheduleSupabase(opts: {
  job?: FakeScheduleJobRow | null;
  updateError?: { message?: string } | null;
} = {}) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; eqCol: string; eqVal: string }> = [];
  const job = opts.job === undefined ? null : opts.job;

  return {
    _inserted: inserted,
    _updates: updates,
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return { maybeSingle: () => Promise.resolve({ data: job, error: null }) };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(eqCol: string, eqVal: string) {
              updates.push({ table, payload, eqCol, eqVal });
              return Promise.resolve({ error: table === "jobs" ? (opts.updateError ?? null) : null });
            },
          };
        },
      };
    },
  };
}

function freshJobRow(overrides: Partial<FakeScheduleJobRow> = {}): FakeScheduleJobRow {
  return {
    id: "job-uuid-1",
    job_number: "JOB-1100",
    job_name: "JOB-1100 – Morrison – Holladay",
    client_name: "Ann Morrison",
    job_address: "4285 S 300 W, Murray",
    estimate_value: 4200,
    crew: null,
    start_date: null,
    end_date: null,
    gcal_main_event_id: null,
    gcal_crew_event_id: null,
    slack_notified_at: null,
    bill_job_code: null,
    ...overrides,
  };
}

const HAPPY_OPP = {
  opportunity: {
    customFields: [
      { id: CREW_FIELD_ID, field_value: "Crew 1" },
      { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
      { id: END_DATE_FIELD_ID, field_value: "2026-08-21" },
    ],
  },
};

function happyScheduleDeps(overrides: Partial<{
  fetchOpportunity: () => Promise<any>;
  getAccessToken: () => Promise<string>;
  createCalendarEvent: (calendarId: string, accessToken: string, eventBody: any) => Promise<{ id: string }>;
  postSlackMessage: (channel: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  ensureBillJobCode: (jobName: string) => Promise<{ status: "success" | "error"; error?: string }>;
  billApiToken: string | null;
}> = {}) {
  return {
    fetchOpportunity: overrides.fetchOpportunity ?? (() => Promise.resolve(HAPPY_OPP)),
    getAccessToken: overrides.getAccessToken ?? (() => Promise.resolve("gcal-token")),
    createCalendarEvent: overrides.createCalendarEvent ?? ((calendarId: string) =>
      Promise.resolve({ id: `gcal-evt-${calendarId}` })),
    calendarIds: { main: "main-cal", crew1: "crew1-cal", crew2: "crew2-cal", crew3: "crew3-cal", crew4: "crew4-cal" },
    postSlackMessage: overrides.postSlackMessage ?? (() => Promise.resolve({ ok: true })),
    slackChannels: { crew1: "C-CREW1", crew2: "C-CREW2", crew3: "C-CREW3", crew4: "C-CREW4" },
    billApiToken: overrides.billApiToken === undefined ? null : overrides.billApiToken,
    ensureBillJobCode: overrides.ensureBillJobCode ?? (() => Promise.resolve({ status: "success" as const })),
    payloadIn: { event: "job_scheduled", opportunityId: "opp-sched-1" },
  };
}

Deno.test("handleJobScheduled: no job row -> 200 skip, reason explains Quote Accepted", async () => {
  const supabase = fakeScheduleSupabase({ job: null });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  assertEquals(result.body, { action: "skipped", reason: "no job record — was Quote Accepted skipped?" });
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.action_taken, "skipped");
});

Deno.test("handleJobScheduled: job exists but crew/start date not set on opportunity -> 200 skip, no external calls", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  let calendarCalled = false;
  let slackCalled = false;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () => Promise.resolve({ opportunity: { customFields: [] } }),
      createCalendarEvent: () => { calendarCalled = true; return Promise.resolve({ id: "should-not-happen" }); },
      postSlackMessage: () => { slackCalled = true; return Promise.resolve({ ok: true }); },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  assertEquals(result.body, { action: "skipped", reason: "crew or start date not set" });
  assertEquals(calendarCalled, false);
  assertEquals(slackCalled, false);
});

Deno.test("handleJobScheduled: full success path — calendar (both IDs), Slack, BILL all run and persist", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = { supabase, ...happyScheduleDeps({ billApiToken: "bill-token-abc" }) };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");

  assertEquals(result.status, 200);
  assertEquals(result.body, {
    success: true,
    action: "scheduled",
    job_number: "JOB-1100",
    calendar: "success",
    slack: "success",
    bill: "success",
  });

  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates.length, 1);
  const payload = jobsUpdates[0].payload;
  assertEquals(payload.crew, "Crew 1");
  assertEquals(payload.start_date, "2026-08-20");
  assertEquals(payload.end_date, "2026-08-21");
  assertEquals(payload.status_v2, "scheduled");
  assertEquals(payload.gcal_main_event_id, "gcal-evt-main-cal");
  assertEquals(payload.gcal_crew_event_id, "gcal-evt-crew1-cal");
  assertEquals(payload.bill_job_code, "JOB-1100 – Morrison – Holladay");
  assertEquals(typeof payload.slack_notified_at, "string");
  assertEquals(typeof payload.updated_at, "string");
  assertEquals(jobsUpdates[0].eqVal, "job-uuid-1");

  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.action_taken, "updated");
  assertEquals(syncLogWrites[0].row.status, "success");
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites[0].row.stage_from, 5);
  assertEquals(jobEventWrites[0].row.stage_to, 6);
  assertEquals(jobEventWrites[0].row.status, "success");
});

Deno.test("handleJobScheduled: BILL_API_TOKEN absent -> bill leg 'skipped', ensureBillJobCode never called", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  let billCalled = false;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      billApiToken: null,
      ensureBillJobCode: () => { billCalled = true; return Promise.resolve({ status: "success" as const }); },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body.bill, "skipped");
  assertEquals(billCalled, false);
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates[0].payload.bill_job_code, undefined);
});

Deno.test("handleJobScheduled: all three legs already done (idempotent) -> all skip, no external calls, still 'scheduled'", async () => {
  const job = freshJobRow({
    gcal_main_event_id: "existing-main-evt",
    gcal_crew_event_id: "existing-crew-evt",
    slack_notified_at: "2026-08-15T00:00:00.000Z",
    bill_job_code: "JOB-1100 – Morrison – Holladay",
  });
  const supabase = fakeScheduleSupabase({ job });
  let calendarCalled = false;
  let slackCalled = false;
  let billCalled = false;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      billApiToken: "bill-token-abc",
      createCalendarEvent: () => { calendarCalled = true; return Promise.resolve({ id: "x" }); },
      postSlackMessage: () => { slackCalled = true; return Promise.resolve({ ok: true }); },
      ensureBillJobCode: () => { billCalled = true; return Promise.resolve({ status: "success" as const }); },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body, {
    success: true,
    action: "scheduled",
    job_number: "JOB-1100",
    calendar: "skipped",
    slack: "skipped",
    bill: "skipped",
  });
  assertEquals(calendarCalled, false);
  assertEquals(slackCalled, false);
  assertEquals(billCalled, false);
  // Re-fire still refreshes crew/dates and status_v2, but must not clobber the already-set leg columns.
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates[0].payload.gcal_main_event_id, undefined);
  assertEquals(jobsUpdates[0].payload.slack_notified_at, undefined);
  assertEquals(jobsUpdates[0].payload.bill_job_code, undefined);
});

Deno.test("handleJobScheduled: partial calendar failure — main succeeds, crew fails -> 'partial', only main ID persists", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: (calendarId: string) => {
        if (calendarId === "crew1-cal") return Promise.reject(new Error("crew calendar down"));
        return Promise.resolve({ id: "gcal-evt-main" });
      },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body.calendar, "partial");
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates[0].payload.gcal_main_event_id, "gcal-evt-main");
  assertEquals(jobsUpdates[0].payload.gcal_crew_event_id, undefined);
});

Deno.test("handleJobScheduled: Slack — unmapped crew value -> 'skipped', not 'error'", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  let slackCalled = false;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Jackson" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
            ],
          },
        }),
      postSlackMessage: () => { slackCalled = true; return Promise.resolve({ ok: true }); },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body.slack, "skipped");
  assertEquals(slackCalled, false);
});

Deno.test("handleJobScheduled: Slack — crew mapped but channel env missing -> 'skipped', not 'error'", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = {
    supabase,
    ...happyScheduleDeps(),
  };
  (deps as any).slackChannels = { crew1: "", crew2: "C-CREW2", crew3: "C-CREW3", crew4: "C-CREW4" };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body.slack, "skipped");
});

Deno.test("handleJobScheduled: Slack API returns ok:false -> 'error', non-fatal to overall 200", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = {
    supabase,
    ...happyScheduleDeps({ postSlackMessage: () => Promise.resolve({ ok: false, error: "channel_not_found" }) }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.slack, "error");
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.status, "error");
  assertEquals(String(syncLogWrites[0].row.error_message).includes("channel_not_found"), true);
});

Deno.test("handleJobScheduled: BILL leg errors -> 'error', non-fatal, other legs unaffected", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = {
    supabase,
    ...happyScheduleDeps({
      billApiToken: "bill-token-abc",
      ensureBillJobCode: () => Promise.resolve({ status: "error" as const, error: "BILL 500" }),
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.calendar, "success");
  assertEquals(result.body.slack, "success");
  assertEquals(result.body.bill, "error");
});

Deno.test("handleJobScheduled: opportunity fetch failure -> 500, job_events + sync_log both 'error'", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = {
    supabase,
    ...happyScheduleDeps({ fetchOpportunity: () => Promise.reject(new Error("GHL unreachable")) }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites[0].row.status, "error");
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.status, "error");
});

Deno.test("handleJobScheduled: job row update failure -> 500", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job, updateError: { message: "db down" } });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
});

Deno.test("handleJobScheduled: job lookup failure -> 500", async () => {
  const supabase = {
    from(table: string) {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "db down" } }) }) }),
        insert: (row: Record<string, unknown>) => Promise.resolve({ data: null, error: null }),
      };
    },
  };
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
});

Deno.test("handleJobScheduled: outer catch converts an unexpected synchronous throw into 500 + error logs", async () => {
  const logCalls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const throwingSupabase = {
    from(table: string) {
      if (table === "jobs") {
        throw new Error("boom — unexpected synchronous throw");
      }
      return {
        insert: (row: Record<string, unknown>) => {
          logCalls.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  const deps = { supabase: throwingSupabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 500);
  assertEquals(result.body.success, false);
  assertEquals(logCalls.some((c) => c.table === "sync_log" && c.row.status === "error"), true);
});
