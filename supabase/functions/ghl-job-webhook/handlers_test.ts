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
