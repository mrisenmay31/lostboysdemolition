import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCrewJobBlock } from "../_shared/slack.ts";
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
  // ── BL-4 Task A: contact fields ──
  extractContactJobFields,
  // ── BL-4 Task B: estimate -> job promotion ──
  pickHighestNonSupersededVersion,
  selectPromotableEstimate,
  promoteEstimateForJob,
  selectChainEstimateNumber,
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
  handleJobScheduled,
  // ── BL-4 Task C: start time / scope ──
  START_TIME_FIELD_ID,
  JOB_SCOPE_FIELD_ID,
  normalizeStartTime,
  normalizeJobScopeNames,
  buildScopeSummaryFromLineItems,
  buildScopeSummaryFromScopeNames,
  resolveScopeSummary,
  // ── F4: job_details currency guardrail + tier 2.5 ──
  stripCurrencyFromScopeText,
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

// ── parseWebhookBody: GHL "Webhook" action customData envelope (live-verify fix) ──

Deno.test("parseWebhookBody: customData-nested valid body parses", () => {
  assertEquals(
    parseWebhookBody({
      contact_id: "c1",
      customData: { event: "job_scheduled", opportunityId: "opp-nested-1" },
    }),
    { event: "job_scheduled", opportunityId: "opp-nested-1" },
  );
});

Deno.test("parseWebhookBody: customData-nested body with missing opportunityId rejects", () => {
  const result = parseWebhookBody({
    customData: { event: "quote_accepted" },
  }) as { error: string };
  assertEquals(typeof result.error, "string");
});

Deno.test("parseWebhookBody: top-level shape still parses (regression — curl / Custom Webhook action)", () => {
  assertEquals(
    parseWebhookBody({ event: "quote_accepted", opportunityId: "opp-top-level" }),
    { event: "quote_accepted", opportunityId: "opp-top-level" },
  );
});

Deno.test("parseWebhookBody: non-object customData is ignored cleanly, not thrown", () => {
  const asString = parseWebhookBody({ customData: "not an object" }) as { error: string };
  assertEquals(typeof asString.error, "string");

  const asNull = parseWebhookBody({ customData: null }) as { error: string };
  assertEquals(typeof asNull.error, "string");

  const asNumber = parseWebhookBody({ customData: 42 }) as { error: string };
  assertEquals(typeof asNumber.error, "string");
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

// ── extractContactJobFields (BL-4 Task A) ────────────────────────────────────

Deno.test("extractContactJobFields: full contact", () => {
  assertEquals(
    extractContactJobFields({
      firstName: "Ann",
      lastName: "Morrison",
      companyName: "Morrison Construction",
      phone: "+18015551234",
    }),
    { clientContactName: "Ann Morrison", businessName: "Morrison Construction", clientPhone: "+18015551234" },
  );
});

Deno.test("extractContactJobFields: only firstName -> name is just firstName, no trailing space", () => {
  assertEquals(
    extractContactJobFields({ firstName: "Ann" }),
    { clientContactName: "Ann", businessName: null, clientPhone: null },
  );
});

Deno.test("extractContactJobFields: only lastName -> name is just lastName", () => {
  assertEquals(
    extractContactJobFields({ lastName: "Morrison" }),
    { clientContactName: "Morrison", businessName: null, clientPhone: null },
  );
});

Deno.test("extractContactJobFields: no name fields -> clientContactName null", () => {
  assertEquals(
    extractContactJobFields({ companyName: "Acme LLC" }),
    { clientContactName: null, businessName: "Acme LLC", clientPhone: null },
  );
});

Deno.test("extractContactJobFields: empty/whitespace-only fields become null", () => {
  assertEquals(
    extractContactJobFields({ firstName: "", lastName: "  ", companyName: "   ", phone: "" }),
    { clientContactName: null, businessName: null, clientPhone: null },
  );
});

Deno.test("extractContactJobFields: non-string values coerced to null instead of leaking through", () => {
  assertEquals(
    extractContactJobFields({ firstName: 42, lastName: { weird: true }, companyName: ["a"], phone: null }),
    { clientContactName: null, businessName: null, clientPhone: null },
  );
});

Deno.test("extractContactJobFields: null/undefined contact -> all null", () => {
  assertEquals(extractContactJobFields(null), { clientContactName: null, businessName: null, clientPhone: null });
  assertEquals(extractContactJobFields(undefined), { clientContactName: null, businessName: null, clientPhone: null });
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

// ── getCustomFieldValue: BL-4 Task D tolerance widening ────────────────────

Deno.test("getCustomFieldValue: finds by fieldValueString key", () => {
  const fields = [{ id: "abc", fieldValueString: "8:00 AM" }];
  assertEquals(getCustomFieldValue(fields, "abc"), "8:00 AM");
});

Deno.test("getCustomFieldValue: finds by fieldValueArray key", () => {
  const fields = [{ id: "abc", fieldValueArray: ["Demo", "Haul away"] }];
  assertEquals(getCustomFieldValue(fields, "abc"), ["Demo", "Haul away"]);
});

Deno.test("getCustomFieldValue: field_value/fieldValue/value still take priority over fieldValueString/fieldValueArray", () => {
  const fields = [{ id: "abc", field_value: "primary", fieldValueString: "secondary" }];
  assertEquals(getCustomFieldValue(fields, "abc"), "primary");
});

Deno.test("getCustomFieldValue: fieldValueDate is deliberately NOT read (epoch-ms risk) — falls through to undefined", () => {
  const fields = [{ id: "abc", fieldValueDate: 1755648000000 }];
  assertEquals(getCustomFieldValue(fields, "abc"), undefined);
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

// ── Shared "estimates" / "ghl_push_state" mock table builders (F2 review fix
// round — chain-pivot). `estimates` is now queried two different shapes:
//   - by job_number (tier 1 of resolveScopeSummary, unchanged): resolves
//     directly off `.eq()`.
//   - by estimate_number (F2's chain lookup, used by both
//     promoteEstimateForJob and tier 2 of resolveScopeSummary):
//     `.eq().neq().order().limit()`.
// `ghl_push_state` now always chains `.order()` after `.eq()` (F6). ──

function makeEstimatesTableMock(opts: {
  byJobNumber?: any[] | null;
  byJobNumberError?: { message?: string } | null;
  chainByNumber?: Record<number, any | null | undefined>;
  chainError?: { message?: string } | null;
}) {
  return {
    select(_cols: string) {
      return {
        eq(col: string, val: any) {
          if (col === "job_number") {
            return Promise.resolve({ data: opts.byJobNumber ?? [], error: opts.byJobNumberError ?? null });
          }
          if (col === "estimate_number") {
            return {
              neq(_c: string, _v: string) {
                return {
                  order(_c: string, _o: any) {
                    return {
                      limit(_n: number) {
                        if (opts.chainError) return Promise.resolve({ data: null, error: opts.chainError });
                        const row = opts.chainByNumber?.[val];
                        return Promise.resolve({ data: row ? [row] : [], error: null });
                      },
                    };
                  },
                };
              },
            };
          }
          throw new Error(`makeEstimatesTableMock: unexpected .eq column "${col}"`);
        },
      };
    },
  };
}

function makeGhlPushStateMock(opts: { rows?: any[] | null; error?: { message?: string } | null }) {
  return {
    select(_cols: string) {
      return {
        eq(_col: string, _val: string) {
          return {
            order(_c: string, _o: any) {
              return Promise.resolve({ data: opts.rows ?? [], error: opts.error ?? null });
            },
          };
        },
      };
    },
  };
}

function fakeSupabase(opts: {
  selectResults?: Array<FakeJobRow | null>;
  insertError?: { code?: string; message?: string; details?: string } | null;
  rpcResult?: { data: any; error: any };
  // ── BL-4 Task B: estimate -> job promotion ──
  ghlPushStateRows?: any[] | null;
  ghlPushStateError?: { message?: string } | null;
  updateEstimateJobNumberResult?: { data: any; error: any };
  updateEstimateStatusResult?: { data: any; error: any };
  // ── F2: chain-pivot lookup ──
  chainVersionByEstimateNumber?: Record<number, any | null | undefined>;
  chainVersionError?: { message?: string } | null;
} = {}) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const selectQueue: Array<FakeJobRow | null> = opts.selectResults ? [...opts.selectResults] : [null];
  const rpcCalls: Array<{ fn: string; args: any }> = [];

  return {
    _inserted: inserted,
    _rpcCalls: rpcCalls,
    rpc(fn: string, args?: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "next_job_number") {
        return Promise.resolve(opts.rpcResult ?? { data: "JOB-1102", error: null });
      }
      if (fn === "update_estimate_job_number") {
        return Promise.resolve(opts.updateEstimateJobNumberResult ?? { data: null, error: null });
      }
      if (fn === "update_estimate_status") {
        return Promise.resolve(opts.updateEstimateStatusResult ?? { data: null, error: null });
      }
      return Promise.resolve({ data: null, error: new Error(`unexpected rpc ${fn}`) });
    },
    from(table: string) {
      if (table === "ghl_push_state") {
        return makeGhlPushStateMock({ rows: opts.ghlPushStateRows, error: opts.ghlPushStateError });
      }
      if (table === "estimates") {
        return makeEstimatesTableMock({
          chainByNumber: opts.chainVersionByEstimateNumber,
          chainError: opts.chainVersionError,
        });
      }
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
  assertEquals(result.body, {
    action: "skipped",
    job_number: "JOB-1050",
    ghl_update: "success",
    promotion: "not_found",
  });
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
  assertEquals(result.body, {
    action: "skipped",
    job_number: "JOB-1050",
    ghl_update: "failed",
    promotion: "not_found",
  });
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
  assertEquals(result.body.promotion, "not_found");
  const jobsInserted = supabase._inserted.filter((i: any) => i.table === "jobs");
  assertEquals(jobsInserted.length, 1);
  assertEquals(jobsInserted[0].row.client_name, "Morrison");
  assertEquals(jobsInserted[0].row.client_type, "Homeowner");
  assertEquals(jobsInserted[0].row.city, "Murray");
  assertEquals(jobsInserted[0].row.estimate_value, 4200);
  assertEquals(jobsInserted[0].row.status_v2, "accepted");
  assertEquals(jobsInserted[0].row.ghl_opportunity_id, "opp-1");
  // BL-4 Task A: contact fields land on the jobs insert (happyDeps' contact
  // has firstName/lastName but no companyName/phone).
  assertEquals(jobsInserted[0].row.client_contact_name, "Ann Morrison");
  assertEquals(jobsInserted[0].row.business_name, null);
  assertEquals(jobsInserted[0].row.client_phone, null);
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
  assertEquals(result.body, {
    action: "skipped",
    job_number: "JOB-1050",
    ghl_update: "success",
    promotion: "not_found",
  });
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

// ── Cleanup fix (I8b, corrected fix round 1 I4): skip-path sync_log aligns
// with job_events ONLY on a failed GHL write-back retry — a normal no-op
// skip must stay countable as action_taken:'skipped'. ──

Deno.test("handleQuoteAccepted: skip-path sync_log — SUCCESSFUL retry stays action_taken:'skipped', status:'success' (I4)", async () => {
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
  assertEquals(syncLogWrites[0].row.action_taken, "skipped");
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
// ── BL-4 Task B: estimate -> job promotion ──────────────────────────────────
// ============================================================

// ── pickHighestNonSupersededVersion / selectPromotableEstimate (pure) ───────

const EST_V1 = { id: "est-1", estimate_number: 1426, version: 1, status: "sent", job_number: null, created_at: "2026-08-14T10:00:00Z" };
const EST_V2 = { id: "est-2", estimate_number: 1426, version: 2, status: "sent", job_number: null, created_at: "2026-08-14T11:00:00Z" };
const EST_V1_SUPERSEDED = { ...EST_V1, status: "superseded" };

Deno.test("pickHighestNonSupersededVersion: picks the highest version", () => {
  assertEquals(pickHighestNonSupersededVersion([EST_V1, EST_V2]), EST_V2);
});

Deno.test("pickHighestNonSupersededVersion: drops superseded rows", () => {
  assertEquals(pickHighestNonSupersededVersion([EST_V1_SUPERSEDED, EST_V2]), EST_V2);
});

Deno.test("pickHighestNonSupersededVersion: all superseded -> null", () => {
  assertEquals(pickHighestNonSupersededVersion([EST_V1_SUPERSEDED, { ...EST_V2, status: "superseded" }]), null);
});

Deno.test("pickHighestNonSupersededVersion: tie on version -> newest created_at wins", () => {
  const older = { ...EST_V1, created_at: "2026-08-14T09:00:00Z" };
  const newer = { ...EST_V1, id: "est-newer", created_at: "2026-08-14T12:00:00Z" };
  assertEquals(pickHighestNonSupersededVersion([older, newer]), newer);
});

Deno.test("pickHighestNonSupersededVersion: empty/null/undefined rows -> null", () => {
  assertEquals(pickHighestNonSupersededVersion([]), null);
  assertEquals(pickHighestNonSupersededVersion(null), null);
  assertEquals(pickHighestNonSupersededVersion(undefined), null);
  assertEquals(pickHighestNonSupersededVersion([null, undefined]), null);
});

Deno.test("selectPromotableEstimate: unwraps ghl_push_state-joined rows and picks the winner", () => {
  const rows = [
    { estimate_id: "est-1", estimates: EST_V1 },
    { estimate_id: "est-2", estimates: EST_V2 },
  ];
  assertEquals(selectPromotableEstimate(rows), EST_V2);
});

Deno.test("selectPromotableEstimate: drops rows with a missing embedded estimate", () => {
  const rows = [
    { estimate_id: "est-1", estimates: null },
    { estimate_id: "est-2", estimates: EST_V2 },
  ];
  assertEquals(selectPromotableEstimate(rows), EST_V2);
});

Deno.test("selectPromotableEstimate: empty/null rows -> null", () => {
  assertEquals(selectPromotableEstimate([]), null);
  assertEquals(selectPromotableEstimate(null), null);
});

// ── promoteEstimateForJob (deps-injected: takes a raw supabase-shaped client) ──

function fakePromotionSupabase(opts: {
  ghlPushStateRows?: any[] | null;
  ghlPushStateError?: { message?: string } | null;
  updateEstimateJobNumberResult?: { data: any; error: any };
  updateEstimateStatusResult?: { data: any; error: any };
  // ── F2: chain-pivot lookup ──
  chainVersionByEstimateNumber?: Record<number, any | null | undefined>;
  chainVersionError?: { message?: string } | null;
} = {}) {
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  return {
    _rpcCalls: rpcCalls,
    rpc(fn: string, args?: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "update_estimate_job_number") {
        return Promise.resolve(opts.updateEstimateJobNumberResult ?? { data: null, error: null });
      }
      if (fn === "update_estimate_status") {
        return Promise.resolve(opts.updateEstimateStatusResult ?? { data: null, error: null });
      }
      return Promise.resolve({ data: null, error: new Error(`unexpected rpc ${fn}`) });
    },
    from(table: string) {
      if (table === "ghl_push_state") {
        return makeGhlPushStateMock({ rows: opts.ghlPushStateRows, error: opts.ghlPushStateError });
      }
      if (table === "estimates") {
        return makeEstimatesTableMock({
          chainByNumber: opts.chainVersionByEstimateNumber,
          chainError: opts.chainVersionError,
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

// NOTE (F2 review fix round): ghlPushStateRows alone no longer determines
// the promoted row — promoteEstimateForJob now pivots to the CHAIN's
// current version via chainVersionByEstimateNumber (fetchCurrentChainVersion).
// Tests below set both, with the chain entry matching the push-state row's
// estimate_number so pre-existing "row IS the current version" scenarios
// keep the same expected results as before the fix.

Deno.test("promoteEstimateForJob: found, neither field set yet -> promotes, both RPCs called with correct args", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: null } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result, { outcome: "promoted", estimateNumber: 1426 });
  assertEquals(supabase._rpcCalls, [
    {
      fn: "update_estimate_job_number",
      args: { p_id: "est-2", p_job_number: "JOB-1104", p_actor: null, p_actor_name: "ghl-job-webhook" },
    },
    {
      fn: "update_estimate_status",
      args: { p_id: "est-2", p_status: "accepted", p_actor: null, p_actor_name: "ghl-job-webhook" },
    },
  ]);
});

Deno.test("promoteEstimateForJob: no matching ghl_push_state rows -> not_found, no RPC calls", async () => {
  const supabase = fakePromotionSupabase({ ghlPushStateRows: [] });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result, { outcome: "not_found" });
  assertEquals(supabase._rpcCalls, []);
});

Deno.test("promoteEstimateForJob: already promoted (job_number + status already match) -> skipped, no RPC calls", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "accepted", job_number: "JOB-1104" } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "accepted", job_number: "JOB-1104" } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result, { outcome: "skipped", estimateNumber: 1426 });
  assertEquals(supabase._rpcCalls, []);
});

Deno.test("promoteEstimateForJob: job_number already correct but status isn't -> only update_estimate_status called", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: "JOB-1104" } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: "JOB-1104" } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result, { outcome: "promoted", estimateNumber: 1426 });
  assertEquals(supabase._rpcCalls.map((c) => c.fn), ["update_estimate_status"]);
});

Deno.test("promoteEstimateForJob: update_estimate_job_number RPC errors -> failed, non-fatal shape", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: null } },
    updateEstimateJobNumberResult: { data: null, error: { message: "estimate not found" } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result.outcome, "failed");
  assertEquals(result.estimateNumber, 1426);
  assertEquals(typeof result.detail, "string");
  // status RPC must not fire once the job-number RPC has already failed.
  assertEquals(supabase._rpcCalls.map((c) => c.fn), ["update_estimate_job_number"]);
});

Deno.test("promoteEstimateForJob: update_estimate_status RPC errors -> failed", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: "JOB-1104" } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: "JOB-1104" } },
    updateEstimateStatusResult: { data: null, error: { message: "db down" } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result.outcome, "failed");
  assertEquals(result.estimateNumber, 1426);
});

Deno.test("promoteEstimateForJob: ghl_push_state lookup errors -> failed, no RPC calls", async () => {
  const supabase = fakePromotionSupabase({ ghlPushStateError: { message: "db down" } });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result.outcome, "failed");
  assertEquals(supabase._rpcCalls, []);
});

Deno.test("promoteEstimateForJob: unexpected synchronous throw -> failed, never propagates", async () => {
  const throwingSupabase = {
    from() {
      throw new Error("boom");
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
  const result = await promoteEstimateForJob(throwingSupabase, "opp-1", "JOB-1104");
  assertEquals(result.outcome, "failed");
});

Deno.test("promoteEstimateForJob: F8 — a thrown null (not an Error instance) doesn't itself throw inside the catch handler", async () => {
  const throwingSupabase = {
    from() {
      throw null; // deliberately not an Error — exercises err?.message, not err.message
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
  const result = await promoteEstimateForJob(throwingSupabase, "opp-1", "JOB-1104");
  assertEquals(result.outcome, "failed");
  assertEquals(typeof result.detail, "string");
});

// ── F2: chain-pivot fixes the ordinary revise flow ──────────────────────────

Deno.test("promoteEstimateForJob: F2 — v1 pushed then superseded by a revise, v2 (current) never re-pushed -> still promotes v2, not v1", async () => {
  // Only v1 has a ghl_push_state row (superseded); v2 is the chain's
  // current version but was never re-pushed, so it has NO push-state row of
  // its own. Before the F2 fix this resolved to not_found.
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-1", estimates: { ...EST_V1, status: "superseded", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: null } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1419");
  assertEquals(result, { outcome: "promoted", estimateNumber: 1426 });
  assertEquals(supabase._rpcCalls, [
    {
      fn: "update_estimate_job_number",
      args: { p_id: "est-2", p_job_number: "JOB-1419", p_actor: null, p_actor_name: "ghl-job-webhook" },
    },
    {
      fn: "update_estimate_status",
      args: { p_id: "est-2", p_status: "accepted", p_actor: null, p_actor_name: "ghl-job-webhook" },
    },
  ]);
});

Deno.test("promoteEstimateForJob: F2 — every version of the chain is superseded -> not_found, no RPC calls", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-1", estimates: { ...EST_V1, status: "superseded", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: null }, // fetchCurrentChainVersion finds nothing non-superseded
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1419");
  assertEquals(result, { outcome: "not_found" });
  assertEquals(supabase._rpcCalls, []);
});

// ── F3: conflicting job_number refuses to overwrite ─────────────────────────

Deno.test("promoteEstimateForJob: F3 — chain already linked to a DIFFERENT job_number -> 'conflict', refuses to write, no RPC calls", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "accepted", job_number: "JOB-1108" } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "accepted", job_number: "JOB-1108" } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result.outcome, "conflict");
  assertEquals(result.estimateNumber, 1426);
  assertEquals(typeof result.detail, "string");
  assertEquals(supabase._rpcCalls, []);
});

Deno.test("promoteEstimateForJob: F3 — job_number already equal to the target is NOT a conflict (idempotent skip)", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "accepted", job_number: "JOB-1104" } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "accepted", job_number: "JOB-1104" } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result, { outcome: "skipped", estimateNumber: 1426 });
  assertEquals(supabase._rpcCalls, []);
});

// ── F7: guard the RPC argument shape ────────────────────────────────────────

Deno.test("promoteEstimateForJob: F7 — chain lookup row with a non-string id refuses the RPC call instead of passing p_id: undefined", async () => {
  const supabase = fakePromotionSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, id: ["est-2"], status: "sent", job_number: null } },
  });
  const result = await promoteEstimateForJob(supabase, "opp-1", "JOB-1104");
  assertEquals(result.outcome, "failed");
  assertEquals(typeof result.detail, "string");
  assertEquals(supabase._rpcCalls, []);
});

// ── selectChainEstimateNumber (pure, F2/F6) ─────────────────────────────────

Deno.test("selectChainEstimateNumber: single chain (all rows share one estimate_number) -> returns that number", () => {
  const rows = [
    { estimate_id: "est-1", estimates: EST_V1 },
    { estimate_id: "est-2", estimates: EST_V2 },
  ];
  assertEquals(selectChainEstimateNumber(rows), 1426);
});

Deno.test("selectChainEstimateNumber: superseded rows are NOT dropped — a superseded-only row still identifies its chain", () => {
  const rows = [{ estimate_id: "est-1", estimates: { ...EST_V1, status: "superseded" } }];
  assertEquals(selectChainEstimateNumber(rows), 1426);
});

Deno.test("selectChainEstimateNumber: F6 — two DISTINCT chains sharing an opportunity -> newest created_at wins, not highest version", () => {
  const obsoleteChainHighVersion = {
    id: "est-old-v3",
    estimate_number: 1200,
    version: 3,
    status: "sent",
    job_number: null,
    created_at: "2026-01-01T00:00:00Z",
  };
  const currentChainLowVersion = {
    id: "est-new-v1",
    estimate_number: 1430,
    version: 1,
    status: "sent",
    job_number: null,
    created_at: "2026-08-16T00:00:00Z",
  };
  const rows = [
    { estimate_id: "est-old-v3", estimates: obsoleteChainHighVersion },
    { estimate_id: "est-new-v1", estimates: currentChainLowVersion },
  ];
  assertEquals(selectChainEstimateNumber(rows), 1430);
});

Deno.test("selectChainEstimateNumber: null/undefined/empty rows, or rows with no embedded estimate -> null", () => {
  assertEquals(selectChainEstimateNumber(null), null);
  assertEquals(selectChainEstimateNumber(undefined), null);
  assertEquals(selectChainEstimateNumber([]), null);
  assertEquals(selectChainEstimateNumber([{ estimate_id: "x", estimates: null }]), null);
});

// ── handleQuoteAccepted integration: promotion wired into both exit paths ────

Deno.test("handleQuoteAccepted: create path — estimate found via ghl_push_state -> promoted, surfaced in body + job_events", async () => {
  const supabase = fakeSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: null } },
  });
  const deps = { supabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.promotion, "promoted");
  assertEquals(
    (supabase as any)._rpcCalls.some((c: any) => c.fn === "update_estimate_job_number" && c.args.p_job_number === "JOB-1102"),
    true,
  );
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(String(jobEventWrites[0].row.action_summary).includes("promotion: promoted"), true);
});

Deno.test("handleQuoteAccepted: create path — no linked estimate -> promotion:'not_found', job creation still succeeds", async () => {
  const supabase = fakeSupabase({ ghlPushStateRows: [] });
  const deps = { supabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.promotion, "not_found");
});

Deno.test("handleQuoteAccepted: create path — promotion RPC error is non-fatal, job creation still returns 200", async () => {
  const supabase = fakeSupabase({
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: null } },
    updateEstimateJobNumberResult: { data: null, error: { message: "db down" } },
  });
  const deps = { supabase, ...happyDeps(), payloadIn: {} };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.promotion, "failed");
});

Deno.test("handleQuoteAccepted: skip path — promotion also runs and self-heals a prior partial failure", async () => {
  const existingJob = { id: "uuid-9", job_number: "JOB-1050", job_name: "JOB-1050 – Smith" };
  const supabase = fakeSupabase({
    selectResults: [existingJob],
    ghlPushStateRows: [{ estimate_id: "est-2", estimates: { ...EST_V2, status: "sent", job_number: null } }],
    chainVersionByEstimateNumber: { 1426: { ...EST_V2, status: "sent", job_number: null } },
  });
  const deps = {
    supabase,
    fetchOpportunity: () => Promise.reject(new Error("should not be called")),
    fetchContact: () => Promise.reject(new Error("should not be called")),
    updateOpportunity: () => Promise.resolve({ success: true }),
    payloadIn: {},
  };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body, {
    action: "skipped",
    job_number: "JOB-1050",
    ghl_update: "success",
    promotion: "promoted",
  });
  assertEquals(
    (supabase as any)._rpcCalls.some((c: any) => c.fn === "update_estimate_job_number" && c.args.p_job_number === "JOB-1050"),
    true,
  );
});

// ============================================================
// ── v2 Task 4 (lane 4c): ENABLE_GHL_ACCEPTANCE_JOB_CREATION gate ───────────
// (deviation 7 — fail-safe default: absent or anything but the literal
// string "false" runs the legacy minting path unchanged.) ──────────────────
// ============================================================

const ACCEPTANCE_FLAG_KEY = "ENABLE_GHL_ACCEPTANCE_JOB_CREATION";

Deno.test("handleQuoteAccepted: flag absent -> legacy minting path runs unchanged (creates job)", async () => {
  Deno.env.delete(ACCEPTANCE_FLAG_KEY);
  const supabase = fakeSupabase();
  const deps = { supabase, ...happyDeps(), payloadIn: { event: "quote_accepted", opportunityId: "opp-1" } };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.action, "created");
  assertEquals(result.body.job_number, "JOB-1102");
  assertEquals(supabase._inserted.filter((i: any) => i.table === "jobs").length, 1);
});

for (const nonDisablingValue of ["FALSE", "0", "true", "", "False", "false "]) {
  Deno.test(
    `handleQuoteAccepted: flag set to ${JSON.stringify(nonDisablingValue)} (not the literal "false") -> legacy minting path runs unchanged`,
    async () => {
      Deno.env.set(ACCEPTANCE_FLAG_KEY, nonDisablingValue);
      try {
        const supabase = fakeSupabase();
        const deps = { supabase, ...happyDeps(), payloadIn: { event: "quote_accepted", opportunityId: "opp-1" } };
        const result = await handleQuoteAccepted(deps as any, "opp-1");
        assertEquals(result.status, 200);
        assertEquals(result.body.success, true);
        assertEquals(result.body.action, "created");
        assertEquals(supabase._inserted.filter((i: any) => i.table === "jobs").length, 1);
      } finally {
        Deno.env.delete(ACCEPTANCE_FLAG_KEY);
      }
    },
  );
}

Deno.test(
  'handleQuoteAccepted: flag === "false" -> quote_accepted_awaiting_schedule, no jobs insert, no next_job_number call, no GHL fetch/update, and exactly one skipped audit pair',
  async () => {
    Deno.env.set(ACCEPTANCE_FLAG_KEY, "false");
    try {
      const supabase = fakeSupabase();
      let fetchOpportunityCalled = false;
      let fetchContactCalled = false;
      let updateOpportunityCalled = false;
      const deps = {
        supabase,
        fetchOpportunity: () => {
          fetchOpportunityCalled = true;
          return Promise.reject(new Error("should not be called"));
        },
        fetchContact: () => {
          fetchContactCalled = true;
          return Promise.reject(new Error("should not be called"));
        },
        updateOpportunity: () => {
          updateOpportunityCalled = true;
          return Promise.reject(new Error("should not be called"));
        },
        payloadIn: { event: "quote_accepted", opportunityId: "opp-flag-off" },
      };
      const result = await handleQuoteAccepted(deps as any, "opp-flag-off");

      assertEquals(result.status, 200);
      assertEquals(result.body, { success: true, action: "quote_accepted_awaiting_schedule" });

      // No GHL touched at all.
      assertEquals(fetchOpportunityCalled, false);
      assertEquals(fetchContactCalled, false);
      assertEquals(updateOpportunityCalled, false);

      // No jobs insert, no mint.
      assertEquals(supabase._inserted.filter((i: any) => i.table === "jobs").length, 0);
      assertEquals((supabase as any)._rpcCalls.filter((c: any) => c.fn === "next_job_number").length, 0);

      // Exactly one sync_log row, satisfying the CHECK constraint's allowed
      // values (action_taken in created|updated|skipped|error; direction in
      // ghl_to_airtable|airtable_to_ghl|ghl_to_supabase|supabase_to_slack|app_to_ghl).
      const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
      assertEquals(syncLogWrites.length, 1);
      assertEquals(syncLogWrites[0].row.direction, "ghl_to_supabase");
      assertEquals(syncLogWrites[0].row.trigger_event, "quote_accepted");
      assertEquals(syncLogWrites[0].row.action_taken, "skipped");
      assertEquals(syncLogWrites[0].row.status, "success");
      assertEquals(syncLogWrites[0].row.error_message, undefined);

      // Exactly one job_events row, satisfying its CHECK (status in
      // success|error|skipped).
      const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
      assertEquals(jobEventWrites.length, 1);
      assertEquals(jobEventWrites[0].row.job_number, null);
      assertEquals(jobEventWrites[0].row.stage_from, null);
      assertEquals(jobEventWrites[0].row.stage_to, 5);
      assertEquals(jobEventWrites[0].row.function_name, "ghl-job-webhook");
      assertEquals(jobEventWrites[0].row.trigger_source, "ghl_workflow");
      assertEquals(jobEventWrites[0].row.ghl_opportunity_id, "opp-flag-off");
      assertEquals(jobEventWrites[0].row.status, "skipped");
    } finally {
      Deno.env.delete(ACCEPTANCE_FLAG_KEY);
    }
  },
);

Deno.test('handleQuoteAccepted: flag === "false" is checked at REQUEST time, not module load — flips take effect without a restart', async () => {
  const supabase1 = fakeSupabase();
  Deno.env.delete(ACCEPTANCE_FLAG_KEY);
  const created = await handleQuoteAccepted(
    { supabase: supabase1, ...happyDeps(), payloadIn: {} } as any,
    "opp-flip-1",
  );
  assertEquals(created.body.action, "created");

  try {
    Deno.env.set(ACCEPTANCE_FLAG_KEY, "false");
    const supabase2 = fakeSupabase();
    const awaiting = await handleQuoteAccepted(
      { supabase: supabase2, ...happyDeps(), payloadIn: {} } as any,
      "opp-flip-2",
    );
    assertEquals(awaiting.body.action, "quote_accepted_awaiting_schedule");
  } finally {
    Deno.env.delete(ACCEPTANCE_FLAG_KEY);
  }
});

// ============================================================
// ── Task 4: handleJobScheduled — schedule path ──────────────────────────────
// ============================================================

// ── field ID constants sanity ────────────────────────────────────────────────

Deno.test("Task 4 field ID constants are non-empty strings", () => {
  for (const id of [CREW_FIELD_ID, START_DATE_FIELD_ID, END_DATE_FIELD_ID, START_TIME_FIELD_ID, JOB_SCOPE_FIELD_ID]) {
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

Deno.test("extractScheduleFields: pulls crew/startDate/endDate/startTime/jobScopeNames by field ID", () => {
  const opp = {
    customFields: [
      { id: CREW_FIELD_ID, field_value: "Crew 2" },
      { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
      { id: END_DATE_FIELD_ID, field_value: "2026-08-21" },
      { id: START_TIME_FIELD_ID, field_value: "8:00 AM" },
      { id: JOB_SCOPE_FIELD_ID, field_value: ["Demo", "Haul away"] },
    ],
  };
  assertEquals(extractScheduleFields(opp), {
    crew: "Crew 2",
    startDate: "2026-08-20",
    endDate: "2026-08-21",
    startTime: "8:00 AM",
    jobScopeNames: ["Demo", "Haul away"],
  });
});

Deno.test("extractScheduleFields: missing custom fields all null/empty", () => {
  assertEquals(extractScheduleFields({}), {
    crew: null,
    startDate: null,
    endDate: null,
    startTime: null,
    jobScopeNames: [],
  });
  assertEquals(extractScheduleFields(null), {
    crew: null,
    startDate: null,
    endDate: null,
    startTime: null,
    jobScopeNames: [],
  });
});

// ── shouldSkipSchedule ────────────────────────────────────────────────────────

Deno.test("shouldSkipSchedule: no job row -> skip with 'no job record' reason", () => {
  const result = shouldSkipSchedule(null, {
    crew: "Crew 1",
    startDate: "2026-08-20",
    endDate: null,
    startTime: null,
    jobScopeNames: [],
  });
  assertEquals(result.skip, true);
  assertEquals(result.reason, "no job record — was Quote Accepted skipped?");
});

Deno.test("shouldSkipSchedule: job exists, crew missing -> skip with 'crew or start date not set'", () => {
  const result = shouldSkipSchedule(
    { id: "j1" },
    { crew: null, startDate: "2026-08-20", endDate: null, startTime: null, jobScopeNames: [] },
  );
  assertEquals(result.skip, true);
  assertEquals(result.reason, "crew or start date not set");
});

Deno.test("shouldSkipSchedule: job exists, start date missing -> skip", () => {
  const result = shouldSkipSchedule(
    { id: "j1" },
    { crew: "Crew 1", startDate: null, endDate: null, startTime: null, jobScopeNames: [] },
  );
  assertEquals(result.skip, true);
  assertEquals(result.reason, "crew or start date not set");
});

Deno.test("shouldSkipSchedule: job exists, crew + start date both present -> no skip", () => {
  const result = shouldSkipSchedule(
    { id: "j1" },
    { crew: "Crew 1", startDate: "2026-08-20", endDate: null, startTime: null, jobScopeNames: [] },
  );
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
  }, "main");
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
  }, "main");
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
  }, "main");
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
  }, "main");
  assertEquals(body.start, { date: "2026-08-20" });
  assertEquals(body.end, { date: "2026-08-23" });
});

// ── BL-5: crew audience omits the Estimate line ─────────────────────────────

Deno.test('buildCalendarDescription: crew audience omits the Estimate line (BL-5)', () => {
  const desc = buildCalendarDescription({
    job_name: "JOB-1100 – Morrison – Holladay",
    client_name: "Ann Morrison",
    job_address: "4285 S 300 W, Murray",
    estimate_value: 4200,
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: null,
  }, "crew");
  assertEquals(desc, "Client: Ann Morrison\nCrew: Crew 1\nAddress: 4285 S 300 W, Murray");
});

Deno.test("buildCalendarDescription: crew and main identical when estimate_value is null", () => {
  const input = {
    job_name: "JOB-1100", client_name: "Ann Morrison", job_address: null,
    estimate_value: null, crew: "Crew 1", start_date: "2026-08-20", end_date: null,
  };
  assertEquals(buildCalendarDescription(input, "crew"), buildCalendarDescription(input, "main"));
});

Deno.test('buildCalendarEventBody: crew description carries no "Estimate:" line while main does', () => {
  const input = {
    job_name: "JOB-1100", client_name: null, job_address: null,
    estimate_value: 4200, crew: "Crew 1", start_date: "2026-08-20", end_date: null,
  };
  const main = buildCalendarEventBody(input, "main");
  const crew = buildCalendarEventBody(input, "crew");
  assert(main.description.includes("Estimate: $4,200.00"));
  assert(!crew.description.includes("Estimate:"));
  // Everything except the description is audience-independent.
  assertEquals(main.summary, crew.summary);
  assertEquals(main.start, crew.start);
  assertEquals(main.end, crew.end);
});

// ── normalizeStartTime (BL-4 Task C) ────────────────────────────────────────

Deno.test("normalizeStartTime: valid string trimmed, never reformatted", () => {
  assertEquals(normalizeStartTime("  8:00 AM  "), "8:00 AM");
  assertEquals(normalizeStartTime("08:00"), "08:00"); // passed through as-is, not normalized to a canonical form
});

Deno.test("normalizeStartTime: empty/whitespace/non-string become null", () => {
  assertEquals(normalizeStartTime(""), null);
  assertEquals(normalizeStartTime("   "), null);
  assertEquals(normalizeStartTime(undefined), null);
  assertEquals(normalizeStartTime(null), null);
  assertEquals(normalizeStartTime(42), null);
});

// ── normalizeJobScopeNames (BL-4 Task C) ────────────────────────────────────

Deno.test("normalizeJobScopeNames: array of plain strings, trimmed", () => {
  assertEquals(normalizeJobScopeNames([" Demo ", "Haul away"]), ["Demo", "Haul away"]);
});

Deno.test("normalizeJobScopeNames: array of objects carrying name/value/label", () => {
  assertEquals(
    normalizeJobScopeNames([{ name: "Demo" }, { value: "Haul away" }, { label: "Concrete removal" }]),
    ["Demo", "Haul away", "Concrete removal"],
  );
});

Deno.test("normalizeJobScopeNames: single comma-separated string (the tags-string defect shape)", () => {
  assertEquals(normalizeJobScopeNames("Demo,Haul away, Concrete removal"), ["Demo", "Haul away", "Concrete removal"]);
});

Deno.test("normalizeJobScopeNames: single plain string (no commas) -> one-element array", () => {
  assertEquals(normalizeJobScopeNames("Demo"), ["Demo"]);
});

Deno.test("normalizeJobScopeNames: dedupes while preserving first-seen order", () => {
  assertEquals(normalizeJobScopeNames(["Demo", "Haul away", "Demo"]), ["Demo", "Haul away"]);
});

Deno.test("normalizeJobScopeNames: drops empty entries and junk items", () => {
  assertEquals(normalizeJobScopeNames(["Demo", "", "  ", 42, { weird: true }, null]), ["Demo"]);
});

Deno.test("normalizeJobScopeNames: null/undefined/non-string-non-array -> []", () => {
  assertEquals(normalizeJobScopeNames(null), []);
  assertEquals(normalizeJobScopeNames(undefined), []);
  assertEquals(normalizeJobScopeNames(42), []);
  assertEquals(normalizeJobScopeNames({ weird: true }), []);
});

// ── normalizeJobScopeNames: F9 hardening ────────────────────────────────────

Deno.test("normalizeJobScopeNames: F9 — a present-but-non-string name does not short-circuit past a usable value/label", () => {
  assertEquals(normalizeJobScopeNames([{ name: 123, value: "Kitchen Demo" }]), ["Kitchen Demo"]);
  assertEquals(normalizeJobScopeNames([{ name: [], label: "Garage Demo" }]), ["Garage Demo"]);
  assertEquals(normalizeJobScopeNames([{ name: 123, value: 456, label: "Basement Demo" }]), ["Basement Demo"]);
});

Deno.test("normalizeJobScopeNames: F9 — a nested array is flattened, not silently dropped", () => {
  assertEquals(normalizeJobScopeNames([["Kitchen Demo"]]), ["Kitchen Demo"]);
  assertEquals(
    normalizeJobScopeNames([["Kitchen Demo", "Haul away"], "Garage Demo"]),
    ["Kitchen Demo", "Haul away", "Garage Demo"],
  );
  // Nested arrays of objects are flattened too, and dedupe still applies.
  assertEquals(
    normalizeJobScopeNames([[{ name: "Demo" }], [{ value: "Demo" }, { label: "Haul away" }]]),
    ["Demo", "Haul away"],
  );
});

// ── buildScopeSummaryFromLineItems / buildScopeSummaryFromScopeNames (BL-4 Task C) ──

Deno.test("buildScopeSummaryFromLineItems: renders 'name — description' per item, in order", () => {
  assertEquals(
    buildScopeSummaryFromLineItems([
      { name: "Demo", description: "Full interior demo" },
      { name: "Haul away", description: "3 loads" },
    ]),
    "Demo — Full interior demo\nHaul away — 3 loads",
  );
});

Deno.test("buildScopeSummaryFromLineItems: blank/whitespace description falls back to name only", () => {
  assertEquals(
    buildScopeSummaryFromLineItems([{ name: "Demo", description: "" }, { name: "Haul away", description: "   " }]),
    "Demo\nHaul away",
  );
});

Deno.test("buildScopeSummaryFromLineItems: empty/null/undefined -> null", () => {
  assertEquals(buildScopeSummaryFromLineItems([]), null);
  assertEquals(buildScopeSummaryFromLineItems(null), null);
  assertEquals(buildScopeSummaryFromLineItems(undefined), null);
});

Deno.test("buildScopeSummaryFromScopeNames: one name per line, no descriptions", () => {
  assertEquals(buildScopeSummaryFromScopeNames(["Demo", "Haul away"]), "Demo\nHaul away");
});

Deno.test("buildScopeSummaryFromScopeNames: empty/null/undefined -> null", () => {
  assertEquals(buildScopeSummaryFromScopeNames([]), null);
  assertEquals(buildScopeSummaryFromScopeNames(null), null);
  assertEquals(buildScopeSummaryFromScopeNames(undefined), null);
});

// ── stripCurrencyFromScopeText (F4 currency guardrail) ──────────────────────

Deno.test("stripCurrencyFromScopeText: a clean sentence with no money-looking content passes through untouched", () => {
  assertEquals(
    stripCurrencyFromScopeText("Full interior demo, haul away all debris"),
    "Full interior demo, haul away all debris",
  );
});

Deno.test("stripCurrencyFromScopeText: dollar figure is stripped, surrounding prose survives", () => {
  assertEquals(
    stripCurrencyFromScopeText("Gut main floor bath, budget $4,250.00"),
    "Gut main floor bath, budget",
  );
});

Deno.test("stripCurrencyFromScopeText: bare dollar figure with no thousands separator or decimal is stripped", () => {
  assertEquals(stripCurrencyFromScopeText("quoted around $4250 for this one"), "quoted around for this one");
});

Deno.test("stripCurrencyFromScopeText: percentage is stripped, surrounding prose survives", () => {
  assertEquals(stripCurrencyFromScopeText("25% markup"), "markup");
  assertEquals(stripCurrencyFromScopeText("realized about 19.3% margin"), "realized about margin");
});

Deno.test("stripCurrencyFromScopeText: a line whose entire content is a dollar figure yields null", () => {
  assertEquals(stripCurrencyFromScopeText("$4,250"), null);
});

Deno.test("stripCurrencyFromScopeText: bare decimal money-looking figure (no $ or %) is stripped", () => {
  assertEquals(stripCurrencyFromScopeText("ballpark 4250.00 total"), "ballpark total");
});

Deno.test("stripCurrencyFromScopeText: plain integers (counts, not money) are NOT mangled", () => {
  assertEquals(stripCurrencyFromScopeText("3 loads"), "3 loads");
  assertEquals(stripCurrencyFromScopeText("2 bathrooms"), "2 bathrooms");
  assertEquals(stripCurrencyFromScopeText("Gut main floor bath, 2 bathrooms, 3 loads of debris"), "Gut main floor bath, 2 bathrooms, 3 loads of debris");
});

Deno.test("stripCurrencyFromScopeText: multi-line text — money-only line dropped, lines with surviving prose keep their prose", () => {
  assertEquals(
    stripCurrencyFromScopeText("Gut main floor bath\n$4,250.00\n2 bathrooms, 3 loads\n25% markup"),
    "Gut main floor bath\n2 bathrooms, 3 loads\nmarkup",
  );
});

Deno.test("stripCurrencyFromScopeText: every line is money-only -> null", () => {
  assertEquals(stripCurrencyFromScopeText("$4,250.00\n25%\n19.3%"), null);
});

Deno.test("stripCurrencyFromScopeText: empty string, whitespace-only, null, undefined, non-string -> null", () => {
  assertEquals(stripCurrencyFromScopeText(""), null);
  assertEquals(stripCurrencyFromScopeText("   \n  "), null);
  assertEquals(stripCurrencyFromScopeText(null), null);
  assertEquals(stripCurrencyFromScopeText(undefined), null);
  assertEquals(stripCurrencyFromScopeText(42 as any), null);
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
  // ── BL-4 Task A/C additions ──
  client_contact_name: string | null;
  business_name: string | null;
  client_phone: string | null;
  start_time: string | null;
  scope_summary: string | null;
  // v2 Task 4 (lane 4c) — see FakeScheduleJobRow.launch_workflow tests below.
  launch_workflow: boolean | null;
}

function fakeScheduleSupabase(opts: {
  job?: FakeScheduleJobRow | null;
  updateError?: { message?: string } | null;
  // ── BL-4 Task C: scope-summary tier lookups ──
  estimatesByJobNumber?: any[] | null;
  estimatesByJobNumberError?: { message?: string } | null;
  ghlPushStateRows?: any[] | null;
  ghlPushStateError?: { message?: string } | null;
  lineItemsByEstimateId?: Record<string, Array<{ name: string; description: string; sort_order: number }>>;
  lineItemsError?: { message?: string } | null;
  // ── F2: chain-pivot lookup (tier 2) ──
  chainVersionByEstimateNumber?: Record<number, any | null | undefined>;
  chainVersionError?: { message?: string } | null;
} = {}) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; eqCol: string; eqVal: string }> = [];
  const job = opts.job === undefined ? null : opts.job;

  return {
    _inserted: inserted,
    _updates: updates,
    from(table: string) {
      if (table === "jobs") {
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
                return Promise.resolve({ error: opts.updateError ?? null });
              },
            };
          },
        };
      }
      if (table === "estimates") {
        return makeEstimatesTableMock({
          byJobNumber: opts.estimatesByJobNumber,
          byJobNumberError: opts.estimatesByJobNumberError,
          chainByNumber: opts.chainVersionByEstimateNumber,
          chainError: opts.chainVersionError,
        });
      }
      if (table === "ghl_push_state") {
        return makeGhlPushStateMock({ rows: opts.ghlPushStateRows, error: opts.ghlPushStateError });
      }
      if (table === "estimate_line_items") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, estimateId: string) {
                return {
                  order(_sortCol: string, _sortOpts: any) {
                    return Promise.resolve({
                      data: opts.lineItemsByEstimateId?.[estimateId] ?? [],
                      error: opts.lineItemsError ?? null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      // sync_log / job_events
      return {
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return Promise.resolve({ data: null, error: null });
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
    client_contact_name: "Ann Morrison",
    business_name: null,
    client_phone: null,
    start_time: null,
    scope_summary: null,
    launch_workflow: false,
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

// ── Slack message — BL-4 Task C new block format (replaces the 4 locked
// buildSlackScheduleMessage assertions, now that function is deleted in
// favor of _shared/slack.ts's buildCrewJobBlock). These exercise the full
// integration: handleJobScheduled assembles CrewJobBlockInput from the job
// row + freshly-computed startTime/scopeResolution and hands it to
// postSlackMessage. Exact strings, not substrings. ──

Deno.test("handleJobScheduled Slack block: full — contact, business, phone, date, time, address, and scope (tier 3 GHL fallback)", async () => {
  const job = freshJobRow({
    client_contact_name: "Ann Morrison",
    business_name: "Morrison Construction",
    client_phone: "8015551234",
    job_address: "4285 S 300 W, Murray",
  });
  const supabase = fakeScheduleSupabase({ job });
  let sentChannel: string | null = null;
  let sentText: string | null = null;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Crew 1" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
              { id: END_DATE_FIELD_ID, field_value: "2026-08-21" },
              { id: START_TIME_FIELD_ID, field_value: "8:00 AM" },
              { id: JOB_SCOPE_FIELD_ID, field_value: ["Demo", "Haul away"] },
            ],
          },
        }),
      postSlackMessage: (channel: string, text: string) => {
        sentChannel = channel;
        sentText = text;
        return Promise.resolve({ ok: true });
      },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body.slack, "success");
  assertEquals(sentChannel, "C-CREW1");
  assertEquals(
    sentText,
    "🏗️ New job scheduled — JOB-1100\nAnn Morrison\nMorrison Construction\n(801) 555-1234\n\n" +
      "Thu Aug 20\n8:00 AM\n4285 S 300 W, Murray\n\nDemo\nHaul away",
  );
});

Deno.test("handleJobScheduled Slack block: all optional fields null/empty -> only headline + date survive", async () => {
  const job = freshJobRow({
    client_contact_name: null,
    // client_name must be nulled too, or the M1 fallback
    // (client_contact_name ?? client_name) supplies it and this test's
    // "everything optional is absent" intent no longer holds.
    client_name: null,
    business_name: null,
    client_phone: null,
    job_address: null,
  });
  const supabase = fakeScheduleSupabase({ job });
  let sentText: string | null = null;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Crew 1" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
            ],
          },
        }),
      postSlackMessage: (_c: string, text: string) => {
        sentText = text;
        return Promise.resolve({ ok: true });
      },
    }),
  };
  await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(sentText, "🏗️ New job scheduled — JOB-1100\n\nThu Aug 20");
});

Deno.test("handleJobScheduled Slack block: businessName equal to contactName (case-insensitive) is collapsed, no duplicate line", async () => {
  const job = freshJobRow({
    client_contact_name: "Ann Morrison",
    business_name: "ann morrison",
    client_phone: "8015551234",
    job_address: "100 Main St",
  });
  const supabase = fakeScheduleSupabase({ job });
  let sentText: string | null = null;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Crew 1" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
            ],
          },
        }),
      postSlackMessage: (_c: string, text: string) => {
        sentText = text;
        return Promise.resolve({ ok: true });
      },
    }),
  };
  await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(sentText, "🏗️ New job scheduled — JOB-1100\nAnn Morrison\n(801) 555-1234\n\nThu Aug 20\n100 Main St");
});

Deno.test("handleJobScheduled Slack block: no contact name, business kept, startTime + address + multi-line scope", async () => {
  const job = freshJobRow({
    client_contact_name: null,
    // See the note above: null client_name too, so this test still exercises
    // "no contact name" rather than silently testing the M1 fallback.
    client_name: null,
    business_name: "Morrison Construction",
    client_phone: null,
    job_address: "200 Elm",
  });
  const supabase = fakeScheduleSupabase({ job });
  let sentText: string | null = null;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Crew 1" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
              { id: START_TIME_FIELD_ID, field_value: "8:00 AM" },
              { id: JOB_SCOPE_FIELD_ID, field_value: ["Demo", "Haul debris"] },
            ],
          },
        }),
      postSlackMessage: (_c: string, text: string) => {
        sentText = text;
        return Promise.resolve({ ok: true });
      },
    }),
  };
  await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(
    sentText,
    "🏗️ New job scheduled — JOB-1100\nMorrison Construction\n\nThu Aug 20\n8:00 AM\n200 Elm\n\nDemo\nHaul debris",
  );
});

// M1 (review): client_contact_name is written ONLY by the Quote Accepted leg, so a
// job minted before BL-4 shipped and scheduled after it has it NULL. Without the
// fallback those jobs get a crew message with no client on it at all. Mirrors the
// same fallback in crew-night-before so both crew messages agree.
Deno.test("handleJobScheduled Slack block: falls back to client_name when client_contact_name is null", async () => {
  const job = freshJobRow({
    client_contact_name: null,
    client_name: "Contractor Company",
    business_name: null,
    client_phone: null,
    job_address: "200 Elm",
  });
  const supabase = fakeScheduleSupabase({ job });
  let sentText: string | null = null;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Crew 1" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
            ],
          },
        }),
      postSlackMessage: (_c: string, text: string) => {
        sentText = text;
        return Promise.resolve({ ok: true });
      },
    }),
  };
  await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(
    sentText,
    "🏗️ New job scheduled — JOB-1100\nContractor Company\n\nThu Aug 20\n200 Elm",
  );
});

// The fallback must not print the same string twice: buildCrewJobBlock suppresses
// the business line when it matches the contact line, which is exactly what a
// company-only contact produces once client_name is used as the fallback.
Deno.test("handleJobScheduled Slack block: client_name fallback equal to business_name renders once", async () => {
  const job = freshJobRow({
    client_contact_name: null,
    client_name: "Contractor Company",
    business_name: "Contractor Company",
    client_phone: null,
    job_address: null,
  });
  const supabase = fakeScheduleSupabase({ job });
  let sentText: string | null = null;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Crew 1" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
            ],
          },
        }),
      postSlackMessage: (_c: string, text: string) => {
        sentText = text;
        return Promise.resolve({ ok: true });
      },
    }),
  };
  await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(sentText, "🏗️ New job scheduled — JOB-1100\nContractor Company\n\nThu Aug 20");
});

// ── resolveScopeSummary / three-tier hybrid scope source (BL-4 Task C) ──────

Deno.test("resolveScopeSummary: tier 1 (promoted estimate by job_number) wins even when tier 2/3 candidates also exist", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      { id: "est-a", estimate_number: 1426, version: 1, status: "sent", job_number: "JOB-1100" },
    ],
    lineItemsByEstimateId: {
      "est-a": [
        { name: "Demo", description: "Full interior", sort_order: 1 },
        { name: "Haul away", description: "", sort_order: 2 },
      ],
    },
    ghlPushStateRows: [
      { estimate_id: "est-b", estimates: { id: "est-b", estimate_number: 1427, version: 1, status: "sent", job_number: null } },
    ],
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", ["GHL Fallback Name"]);
  assertEquals(result, { summary: "Demo — Full interior\nHaul away", tier: "estimate_by_job_number" });
});

Deno.test("resolveScopeSummary: tier 2 (ghl_push_state, F2 chain pivot) wins when tier 1 is empty", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [],
    ghlPushStateRows: [
      { estimate_id: "est-c", estimates: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null } },
    ],
    chainVersionByEstimateNumber: {
      1428: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null },
    },
    lineItemsByEstimateId: { "est-c": [{ name: "Demo", description: "", sort_order: 1 }] },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", ["GHL Fallback Name"]);
  assertEquals(result, { summary: "Demo", tier: "estimate_by_push_state" });
});

Deno.test("resolveScopeSummary: F2 — tier 2 finds the CURRENT (never-re-pushed) chain version, not the superseded pushed row", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [],
    // Only v1 has a push-state row (now superseded); v2 is the chain's
    // current version and was never re-pushed.
    ghlPushStateRows: [
      { estimate_id: "est-a", estimates: { id: "est-a", estimate_number: 1426, version: 1, status: "superseded", job_number: null } },
    ],
    chainVersionByEstimateNumber: {
      1426: { id: "est-b", estimate_number: 1426, version: 2, status: "sent", job_number: null },
    },
    lineItemsByEstimateId: { "est-b": [{ name: "Demo — v2 scope", description: "", sort_order: 1 }] },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: "Demo — v2 scope", tier: "estimate_by_push_state" });
});

// ── F4: tier 2.5 (job_details, quick-mode estimates) ────────────────────────

Deno.test("resolveScopeSummary: F4 — tier 1 resolves an estimate with ZERO line items -> falls to its job_details, currency stripped", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      {
        id: "est-a",
        estimate_number: 1426,
        version: 1,
        status: "sent",
        job_number: "JOB-1100",
        job_details: "Gut main floor bath, budget $4,250.00",
      },
    ],
    lineItemsByEstimateId: { "est-a": [] }, // quick mode: zero line items
    ghlPushStateRows: [],
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", ["GHL Fallback Name"]);
  assertEquals(result, { summary: "Gut main floor bath, budget", tier: "estimate_job_details" });
});

Deno.test("resolveScopeSummary: F4 — tier 2 resolves an estimate with ZERO line items -> falls to its job_details, no second lookup needed", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [],
    ghlPushStateRows: [
      { estimate_id: "est-c", estimates: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null } },
    ],
    chainVersionByEstimateNumber: {
      1428: {
        id: "est-c",
        estimate_number: 1428,
        version: 1,
        status: "sent",
        job_number: null,
        job_details: "25% markup, gut kitchen",
      },
    },
    lineItemsByEstimateId: { "est-c": [] },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", ["GHL Fallback Name"]);
  assertEquals(result, { summary: "markup, gut kitchen", tier: "estimate_job_details" });
});

Deno.test("resolveScopeSummary: F4 — tier 1's resolved estimate wins the job_details fallback over tier 2's, even though tier 2 also resolved one", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      {
        id: "est-tier1",
        estimate_number: 1426,
        version: 1,
        status: "sent",
        job_number: "JOB-1100",
        job_details: "Tier 1 scope text",
      },
    ],
    lineItemsByEstimateId: { "est-tier1": [] },
    ghlPushStateRows: [
      { estimate_id: "est-c", estimates: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null } },
    ],
    chainVersionByEstimateNumber: {
      1428: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null, job_details: "Tier 2 scope text" },
    },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: "Tier 1 scope text", tier: "estimate_job_details" });
});

Deno.test("resolveScopeSummary: F4 — resolved estimate has null/blank job_details -> falls through to GHL fallback (tier 3), not stuck at 2.5", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      { id: "est-a", estimate_number: 1426, version: 1, status: "sent", job_number: "JOB-1100", job_details: null },
    ],
    lineItemsByEstimateId: { "est-a": [] },
    ghlPushStateRows: [],
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", ["Demo", "Haul away"]);
  assertEquals(result, { summary: "Demo\nHaul away", tier: "ghl_fallback" });
});

Deno.test("resolveScopeSummary: F4 — job_details entirely money (e.g. just a dollar figure) strips to nothing -> falls through, does not leak a figure", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      { id: "est-a", estimate_number: 1426, version: 1, status: "sent", job_number: "JOB-1100", job_details: "$4,250" },
    ],
    lineItemsByEstimateId: { "est-a": [] },
    ghlPushStateRows: [],
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: null, tier: "none" });
});

Deno.test("resolveScopeSummary: F4 — line items DO exist (non-quick-mode) -> tier 1 wins outright, job_details never consulted even if present", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      {
        id: "est-a",
        estimate_number: 1426,
        version: 1,
        status: "sent",
        job_number: "JOB-1100",
        job_details: "$99,999 — should never surface",
      },
    ],
    lineItemsByEstimateId: { "est-a": [{ name: "Demo", description: "", sort_order: 1 }] },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: "Demo", tier: "estimate_by_job_number" });
});

Deno.test("resolveScopeSummary: F4 interacts with F1 — tier 1 line-item lookup errors AND job_details is null -> still tier 'error', not silently 'none'", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      { id: "est-a", estimate_number: 1426, version: 1, status: "sent", job_number: "JOB-1100", job_details: null },
    ],
    lineItemsError: { message: "line item lookup failed" },
    ghlPushStateRows: [],
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: null, tier: "error" });
});

Deno.test("resolveScopeSummary: tier 3 (GHL fallback names) wins when tier 1 and tier 2 are both empty", async () => {
  const supabase = fakeScheduleSupabase({ estimatesByJobNumber: [], ghlPushStateRows: [] });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", ["Demo", "Haul away"]);
  assertEquals(result, { summary: "Demo\nHaul away", tier: "ghl_fallback" });
});

Deno.test("resolveScopeSummary: all three tiers genuinely empty (no lookup errors) -> summary null, tier 'none'", async () => {
  const supabase = fakeScheduleSupabase({ estimatesByJobNumber: [], ghlPushStateRows: [] });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: null, tier: "none" });
});

Deno.test("resolveScopeSummary: tier 1 lookup error falls through to tier 2 rather than failing", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumberError: { message: "db down" },
    ghlPushStateRows: [
      { estimate_id: "est-c", estimates: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null } },
    ],
    chainVersionByEstimateNumber: {
      1428: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null },
    },
    lineItemsByEstimateId: { "est-c": [{ name: "Demo", description: "", sort_order: 1 }] },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  // Tier 2 SUCCEEDS despite tier 1's error -> a good result, not tagged 'error'.
  assertEquals(result, { summary: "Demo", tier: "estimate_by_push_state" });
});

// ── F1: 'error' tier is distinct from 'none' ────────────────────────────────

Deno.test("resolveScopeSummary: F1 — tier 1 AND tier 2 both error, fallback empty -> tier 'error' (not 'none')", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumberError: { message: "statement timeout" },
    ghlPushStateError: { message: "PostgREST blip" },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: null, tier: "error" });
});

Deno.test("resolveScopeSummary: F1 — tier 1 finds a chain but its line-item lookup errors, tier 2/3 empty -> tier 'error'", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [
      { id: "est-a", estimate_number: 1426, version: 1, status: "sent", job_number: "JOB-1100" },
    ],
    lineItemsError: { message: "line item lookup failed" },
    ghlPushStateRows: [],
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: null, tier: "error" });
});

Deno.test("resolveScopeSummary: F1 — tier 2's chain lookup itself errors (not just the ghl_push_state query) -> tier 'error'", async () => {
  const supabase = fakeScheduleSupabase({
    estimatesByJobNumber: [],
    ghlPushStateRows: [
      { estimate_id: "est-c", estimates: { id: "est-c", estimate_number: 1428, version: 1, status: "sent", job_number: null } },
    ],
    chainVersionError: { message: "db down" },
  });
  const result = await resolveScopeSummary(supabase, { job_number: "JOB-1100" }, "opp-1", []);
  assertEquals(result, { summary: null, tier: "error" });
});

Deno.test("handleJobScheduled: scope tier persisted to scope_summary and recorded in job_events action_summary", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({
    job,
    estimatesByJobNumber: [
      { id: "est-a", estimate_number: 1426, version: 1, status: "sent", job_number: "JOB-1100" },
    ],
    lineItemsByEstimateId: { "est-a": [{ name: "Demo", description: "", sort_order: 1 }] },
  });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  const terminalUpdate = jobsUpdates[jobsUpdates.length - 1];
  assertEquals(terminalUpdate.payload.scope_summary, "Demo");
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  const terminalEvent = jobEventWrites.find((e: any) => String(e.row.action_summary).includes("Job scheduled"));
  assertEquals(String(terminalEvent!.row.action_summary).includes("scope: estimate_by_job_number"), true);
});

Deno.test("handleJobScheduled: F1 — no scope anywhere -> scope_summary key OMITTED (not written as null), job_events records 'scope: none'", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = { supabase, ...happyScheduleDeps() };
  await handleJobScheduled(deps as any, "opp-sched-1");
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  const terminalUpdate = jobsUpdates[jobsUpdates.length - 1];
  // F1: the key must be absent entirely, not present-and-null — there is no
  // functional difference for a fresh row (column already defaults null),
  // but this is the same code path that protects an EXISTING good summary.
  assertEquals("scope_summary" in terminalUpdate.payload, false);
  assertEquals(terminalUpdate.payload.scope_summary, undefined);
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  const terminalEvent = jobEventWrites.find((e: any) => String(e.row.action_summary).includes("Job scheduled"));
  assertEquals(String(terminalEvent!.row.action_summary).includes("scope: none"), true);
});

Deno.test("handleJobScheduled: F1 — errored scope tier does NOT overwrite an existing scope_summary (key omitted, not clobbered to null)", async () => {
  const job = freshJobRow({ scope_summary: "Demo — full interior (existing good scope)" });
  const supabase = fakeScheduleSupabase({
    job,
    estimatesByJobNumberError: { message: "statement timeout" },
    ghlPushStateError: { message: "PostgREST blip" },
  });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  const terminalUpdate = jobsUpdates[jobsUpdates.length - 1];
  assertEquals("scope_summary" in terminalUpdate.payload, false);
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  const terminalEvent = jobEventWrites.find((e: any) => String(e.row.action_summary).includes("Job scheduled"));
  assertEquals(String(terminalEvent!.row.action_summary).includes("scope: error"), true);
});

// ── start_time persistence (BL-4 Task C) ────────────────────────────────────

Deno.test("handleJobScheduled: start_time persisted from the opportunity's Job Start Time field", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () =>
        Promise.resolve({
          opportunity: {
            customFields: [
              { id: CREW_FIELD_ID, field_value: "Crew 1" },
              { id: START_DATE_FIELD_ID, field_value: "2026-08-20" },
              { id: START_TIME_FIELD_ID, field_value: "  8:00 AM  " },
            ],
          },
        }),
    }),
  };
  await handleJobScheduled(deps as any, "opp-sched-1");
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  const terminalUpdate = jobsUpdates[jobsUpdates.length - 1];
  assertEquals(terminalUpdate.payload.start_time, "8:00 AM");
});

Deno.test("handleJobScheduled: start_time absent on the opportunity -> persisted null", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = { supabase, ...happyScheduleDeps() }; // HAPPY_OPP has no START_TIME_FIELD_ID
  await handleJobScheduled(deps as any, "opp-sched-1");
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  const terminalUpdate = jobsUpdates[jobsUpdates.length - 1];
  assertEquals(terminalUpdate.payload.start_time, null);
});

Deno.test("handleJobScheduled: no job row, flag absent -> 200 response body unchanged (no GHL retry-storm), but logged loudly as an error citing Quote Accepted (F5)", async () => {
  Deno.env.delete(ACCEPTANCE_FLAG_KEY);
  const supabase = fakeScheduleSupabase({ job: null });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  // Response body is deliberately unchanged — GHL must not retry-storm this webhook.
  assertEquals(result.status, 200);
  assertEquals(result.body, { action: "skipped", reason: "no job record — was Quote Accepted skipped?" });
  // But the audit trail must be loud: this is a missed job, not a benign skip.
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.action_taken, "error");
  assertEquals(syncLogWrites[0].row.status, "error");
  assertEquals(
    syncLogWrites[0].row.error_message,
    "job_scheduled fired but no job record exists — Quote Accepted stage was likely skipped; job NOT created",
  );
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites[0].row.status, "error");
  assertEquals(
    jobEventWrites[0].row.error_message,
    "job_scheduled fired but no job record exists — Quote Accepted stage was likely skipped; job NOT created",
  );
});

// v2 Task 4 fix round: once ENABLE_GHL_ACCEPTANCE_JOB_CREATION="false" is live, Quote
// Accepted no longer mints anything, so the "Quote Accepted was likely skipped"
// diagnosis above would misdirect triage during cutover. Same audit/status semantics
// (action_taken/status 'error' on both writers, 200/'skipped' response body) — only the
// error_message wording branches on the flag.
Deno.test('handleJobScheduled: no job row, flag === "false" -> same loud-error semantics, but wording points at app scheduling instead of Quote Accepted', async () => {
  Deno.env.set(ACCEPTANCE_FLAG_KEY, "false");
  try {
    const supabase = fakeScheduleSupabase({ job: null });
    const deps = { supabase, ...happyScheduleDeps() };
    const result = await handleJobScheduled(deps as any, "opp-sched-1");

    // Response body / skip-shape semantics are unchanged by the flag.
    assertEquals(result.status, 200);
    assertEquals(result.body, { action: "skipped", reason: "no job record — was Quote Accepted skipped?" });

    const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
    assertEquals(syncLogWrites[0].row.action_taken, "error");
    assertEquals(syncLogWrites[0].row.status, "error");
    assertEquals(
      syncLogWrites[0].row.error_message,
      "job_scheduled fired but no job record exists — app scheduling now mints the job " +
        "(ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false); this opportunity has no app-scheduled job yet",
    );
    // Must NOT contain the stale "Quote Accepted" diagnosis.
    assertEquals(String(syncLogWrites[0].row.error_message).includes("Quote Accepted"), false);

    const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
    assertEquals(jobEventWrites[0].row.status, "error");
    assertEquals(
      jobEventWrites[0].row.error_message,
      "job_scheduled fired but no job record exists — app scheduling now mints the job " +
        "(ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false); this opportunity has no app-scheduled job yet",
    );
  } finally {
    Deno.env.delete(ACCEPTANCE_FLAG_KEY);
  }
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

  // I2: two separate `jobs` updates — an immediate one carrying ONLY the gcal
  // columns (fired right after the calendar leg), then the terminal update
  // with everything else. Neither carries the other's columns.
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates.length, 2);

  const gcalUpdate = jobsUpdates[0];
  assertEquals(gcalUpdate.payload, {
    gcal_main_event_id: "gcal-evt-main-cal",
    gcal_crew_event_id: "gcal-evt-crew1-cal",
  });
  assertEquals(gcalUpdate.eqVal, "job-uuid-1");

  const terminalUpdate = jobsUpdates[1];
  const payload = terminalUpdate.payload;
  assertEquals(payload.crew, "Crew 1");
  assertEquals(payload.start_date, "2026-08-20");
  assertEquals(payload.end_date, "2026-08-21");
  assertEquals(payload.status_v2, "scheduled");
  assertEquals(payload.gcal_main_event_id, undefined);
  assertEquals(payload.gcal_crew_event_id, undefined);
  assertEquals(payload.bill_job_code, "JOB-1100 – Morrison – Holladay");
  assertEquals(typeof payload.slack_notified_at, "string");
  assertEquals(typeof payload.updated_at, "string");
  assertEquals(terminalUpdate.eqVal, "job-uuid-1");

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
  // Terminal update (index 1 — index 0 is the immediate gcal-only update).
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates[1].payload.bill_job_code, undefined);
});

Deno.test("handleJobScheduled: all three legs already done (idempotent) -> all skip, no external calls, still 'scheduled'", async () => {
  const job = freshJobRow({
    // crew/dates match HAPPY_OPP exactly — a genuine idempotent re-fire, not
    // a reschedule (I3 fires on stamped legs + a crew/date MISMATCH).
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: "2026-08-21",
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
  // No calendar/Slack/BILL work happened -> exactly ONE `jobs` update (the
  // terminal one; no immediate gcal update fires since nothing was created).
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates.length, 1);
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
  // Immediate gcal-only update (index 0) carries just the main ID that
  // actually got created; the terminal update (index 1) carries neither.
  assertEquals(jobsUpdates[0].payload, { gcal_main_event_id: "gcal-evt-main" });
  assertEquals(jobsUpdates[1].payload.gcal_main_event_id, undefined);
  assertEquals(jobsUpdates[1].payload.gcal_crew_event_id, undefined);
});

// ── Fix round 1: C1+C2 — per-EVENT-ID calendar resumability ────────────────────

Deno.test("handleJobScheduled: C1 — main ID already set, crew ID null -> re-fire creates ONLY the crew event", async () => {
  const job = freshJobRow({
    // Matches HAPPY_OPP's crew/dates exactly so this isn't also read as a
    // reschedule (I3) — purely exercising the per-ID calendar resumability.
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: "2026-08-21",
    gcal_main_event_id: "existing-main-evt",
    gcal_crew_event_id: null,
  });
  const supabase = fakeScheduleSupabase({ job });
  const createdCalendarIds: string[] = [];
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: (calendarId: string) => {
        createdCalendarIds.push(calendarId);
        return Promise.resolve({ id: `gcal-evt-${calendarId}` });
      },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(createdCalendarIds, ["crew1-cal"]); // main NOT re-created
  assertEquals(result.body.calendar, "success");
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates[0].payload, { gcal_crew_event_id: "gcal-evt-crew1-cal" });
});

Deno.test("handleJobScheduled: C2 — crew ID already set, main ID null -> re-fire creates ONLY the main event, no duplicate crew event", async () => {
  const job = freshJobRow({
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: "2026-08-21",
    gcal_main_event_id: null,
    gcal_crew_event_id: "existing-crew-evt",
  });
  const supabase = fakeScheduleSupabase({ job });
  const createdCalendarIds: string[] = [];
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: (calendarId: string) => {
        createdCalendarIds.push(calendarId);
        return Promise.resolve({ id: `gcal-evt-${calendarId}` });
      },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(createdCalendarIds, ["main-cal"]); // crew NOT re-created (no duplicate)
  assertEquals(result.body.calendar, "success");
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  assertEquals(jobsUpdates[0].payload, { gcal_main_event_id: "gcal-evt-main-cal" });
});

// ── BL-5: crew calendar events carry no pricing ─────────────────────────────

Deno.test("handleJobScheduled calendar: main body carries Estimate line, crew body does not (BL-5)", async () => {
  const job = freshJobRow({ estimate_value: 4200, client_name: "Ann Morrison" });
  const supabase = fakeScheduleSupabase({ job });
  const bodies: Record<string, any> = {};
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: (calendarId: string, _tok: string, eventBody: any) => {
        bodies[calendarId] = eventBody;
        return Promise.resolve({ id: `gcal-evt-${calendarId}` });
      },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body.calendar, "success");
  assert(bodies["main-cal"].description.includes("Estimate: $4,200.00"));
  assert(!bodies["crew1-cal"].description.includes("Estimate:"));
  // Same event otherwise — title and dates identical across targets.
  assertEquals(bodies["main-cal"].summary, bodies["crew1-cal"].summary);
  assertEquals(bodies["main-cal"].start, bodies["crew1-cal"].start);
  assertEquals(bodies["main-cal"].end, bodies["crew1-cal"].end);
});

Deno.test("handleJobScheduled calendar: main already stamped -> only crew created, still without Estimate (BL-5 x C1 gate)", async () => {
  const job = freshJobRow({
    // crew/dates match HAPPY_OPP exactly so this isn't also read as a
    // reschedule (I3) — purely exercising the per-target audience wiring.
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: "2026-08-21",
    estimate_value: 4200,
    gcal_main_event_id: "already-there",
  });
  const supabase = fakeScheduleSupabase({ job });
  const bodies: Record<string, any> = {};
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: (calendarId: string, _tok: string, eventBody: any) => {
        bodies[calendarId] = eventBody;
        return Promise.resolve({ id: `gcal-evt-${calendarId}` });
      },
    }),
  };
  await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(bodies["main-cal"], undefined);       // C1 per-target gate intact
  assert(!bodies["crew1-cal"].description.includes("Estimate:"));
});

// ── Fix round 1: I1 — mapped crew, unset calendar env ──────────────────────────

Deno.test("handleJobScheduled: I1 — mapped crew with unset calendar env -> warns, reports 'partial', never bare 'success'", async () => {
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const deps = { supabase, ...happyScheduleDeps() };
  // Crew 1 IS mapped (CREW_ENV_KEY_MAP has "crew 1") but its calendar env is unset.
  (deps as any).calendarIds = { main: "main-cal", crew1: "", crew2: "crew2-cal", crew3: "crew3-cal", crew4: "crew4-cal" };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.body.calendar, "partial");
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  const terminalEvent = jobEventWrites.find((e: any) => String(e.row.action_summary).includes("Job scheduled"));
  assertEquals(terminalEvent !== undefined, true);
  assertEquals(String(terminalEvent!.row.error_message).includes("no crew calendar configured for Crew 1"), true);
});

// ── Fix round 1: I2 — immediate persistence of calendar event IDs ──────────────

Deno.test("handleJobScheduled: I2 — terminal update failure does not orphan already-persisted calendar event IDs", async () => {
  const job = freshJobRow();
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  let updateCallCount = 0;
  const supabase = {
    _inserted: inserted,
    _updates: updates,
    from(table: string) {
      return {
        select(_cols: string) {
          return { eq(_c: string, _v: string) { return { maybeSingle: () => Promise.resolve({ data: job, error: null }) }; } };
        },
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(_c: string, _v: string) {
              updateCallCount++;
              updates.push({ table, payload });
              const isTerminalUpdate = table === "jobs" && updateCallCount === 2;
              return Promise.resolve({
                error: isTerminalUpdate ? { message: "terminal write failed" } : null,
              });
            },
          };
        },
      };
    },
  };
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");

  assertEquals(result.status, 500); // terminal update failure still surfaces as a 500
  const jobsUpdates = updates.filter((u) => u.table === "jobs");
  assertEquals(jobsUpdates.length, 2);
  // The FIRST (immediate, calendar-only) update already succeeded and carries
  // both event IDs — that write is not undone by the later terminal failure.
  assertEquals(jobsUpdates[0].payload, {
    gcal_main_event_id: "gcal-evt-main-cal",
    gcal_crew_event_id: "gcal-evt-crew1-cal",
  });
});

// ── Fix round 1: I3 — reschedule visibility ─────────────────────────────────────

Deno.test("handleJobScheduled: I3 — reschedule detected (stamped legs + changed start_date) -> DB updated, reschedule_detected event written, calendar 'stale'", async () => {
  const job = freshJobRow({
    crew: "Crew 1",
    start_date: "2026-08-10", // stale — differs from HAPPY_OPP's 2026-08-20
    end_date: "2026-08-11",
    gcal_main_event_id: "existing-main-evt",
    gcal_crew_event_id: "existing-crew-evt",
    slack_notified_at: "2026-08-05T00:00:00.000Z",
  });
  const supabase = fakeScheduleSupabase({ job });
  let calendarCalled = false;
  let slackCalled = false;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: () => { calendarCalled = true; return Promise.resolve({ id: "should-not-happen" }); },
      postSlackMessage: () => { slackCalled = true; return Promise.resolve({ ok: true }); },
    }),
  };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");

  assertEquals(result.body.calendar, "stale");
  assertEquals(calendarCalled, false); // no patch/delete/re-create
  assertEquals(slackCalled, false); // no re-send (slack_notified_at already set -> ordinary skip)

  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  const rescheduleEvent = jobEventWrites.find((e: any) => e.row.action_summary === "reschedule_detected");
  assertEquals(rescheduleEvent !== undefined, true);
  assertEquals(rescheduleEvent!.row.status, "success");
  assertEquals(rescheduleEvent!.row.payload_in, {
    old: { crew: "Crew 1", start_date: "2026-08-10", end_date: "2026-08-11" },
    new: { crew: "Crew 1", start_date: "2026-08-20", end_date: "2026-08-21" },
  });

  // DB fields still get updated to the new incoming values (only the calendar
  // events themselves are left alone).
  const jobsUpdates = supabase._updates.filter((u: any) => u.table === "jobs");
  const terminalUpdate = jobsUpdates[jobsUpdates.length - 1];
  assertEquals(terminalUpdate.payload.start_date, "2026-08-20");
  assertEquals(terminalUpdate.payload.end_date, "2026-08-21");
});

Deno.test("handleJobScheduled: I3 — no reschedule when legs unstamped, even if crew/dates differ from stored (first fire)", async () => {
  // freshJobRow() defaults crew/start_date/end_date to null, no legs stamped
  // — this must NOT be misread as a reschedule (legsStamped gate matters).
  const job = freshJobRow();
  const supabase = fakeScheduleSupabase({ job });
  const result = await handleJobScheduled({ supabase, ...happyScheduleDeps() } as any, "opp-sched-1");
  assertEquals(result.body.calendar, "success");
  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites.some((e: any) => e.row.action_summary === "reschedule_detected"), false);
});

Deno.test("handleJobScheduled: Slack — unmapped crew value -> 'skipped', not 'error'; sync_log stays clean on the benign skip (F7)", async () => {
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
  // F7: "crew not mapped to a known crew Slack channel" is benign skip narration — it must
  // stay in job_events/action_summary/response only, never leak into sync_log.error_message
  // on a row whose overall status is 'success' (no leg actually errored).
  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites[0].row.status, "success");
  assertEquals(syncLogWrites[0].row.error_message, null);
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

// ============================================================
// ── v2 Task 4 (lane 4c): launch_workflow compat check ───────────────────────
// UNCONDITIONAL — not gated by ENABLE_GHL_ACCEPTANCE_JOB_CREATION. An
// app-authored job (launch_workflow=true, set by the schedule_estimate RPC
// owned by a sibling lane) must never be double-scheduled by this webhook.
// ============================================================

Deno.test("handleJobScheduled: launch_workflow=true -> app_is_schedule_authority, zero writes/calendar/Slack, one skipped audit pair", async () => {
  const job = freshJobRow({ launch_workflow: true });
  const supabase = fakeScheduleSupabase({ job });
  let fetchOpportunityCalled = false;
  let getAccessTokenCalled = false;
  let createCalendarEventCalled = false;
  let postSlackMessageCalled = false;
  let ensureBillJobCodeCalled = false;
  const deps = {
    supabase,
    ...happyScheduleDeps({
      fetchOpportunity: () => {
        fetchOpportunityCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
      getAccessToken: () => {
        getAccessTokenCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
      createCalendarEvent: () => {
        createCalendarEventCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
      postSlackMessage: () => {
        postSlackMessageCalled = true;
        return Promise.resolve({ ok: false, error: "should not be called" });
      },
      ensureBillJobCode: () => {
        ensureBillJobCodeCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
    }),
  };

  const result = await handleJobScheduled(deps as any, "opp-sched-1");

  assertEquals(result.status, 200);
  assertEquals(result.body, { success: true, action: "app_is_schedule_authority", job_number: "JOB-1100" });

  // No GHL fetch, no calendar, no Slack, no BILL — the check returns before
  // any of them run.
  assertEquals(fetchOpportunityCalled, false);
  assertEquals(getAccessTokenCalled, false);
  assertEquals(createCalendarEventCalled, false);
  assertEquals(postSlackMessageCalled, false);
  assertEquals(ensureBillJobCodeCalled, false);

  // No writes to the jobs row (no gcal-id persist, no terminal update).
  assertEquals(supabase._updates.length, 0);
  assertEquals(supabase._inserted.filter((i: any) => i.table === "jobs").length, 0);

  const syncLogWrites = supabase._inserted.filter((i: any) => i.table === "sync_log");
  assertEquals(syncLogWrites.length, 1);
  assertEquals(syncLogWrites[0].row.direction, "ghl_to_supabase");
  assertEquals(syncLogWrites[0].row.trigger_event, "job_scheduled");
  assertEquals(syncLogWrites[0].row.action_taken, "skipped");
  assertEquals(syncLogWrites[0].row.status, "success");

  const jobEventWrites = supabase._inserted.filter((i: any) => i.table === "job_events");
  assertEquals(jobEventWrites.length, 1);
  assertEquals(jobEventWrites[0].row.job_number, "JOB-1100");
  assertEquals(jobEventWrites[0].row.stage_from, 5);
  assertEquals(jobEventWrites[0].row.stage_to, 6);
  assertEquals(jobEventWrites[0].row.function_name, "ghl-job-webhook");
  assertEquals(jobEventWrites[0].row.ghl_opportunity_id, "opp-sched-1");
  assertEquals(jobEventWrites[0].row.status, "skipped");
});

Deno.test("handleJobScheduled: launch_workflow=false -> legacy scheduling path runs byte-identical to today", async () => {
  const job = freshJobRow({ launch_workflow: false });
  const supabase = fakeScheduleSupabase({ job });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.action, "scheduled");
  assertEquals(result.body.calendar, "success");
  assertEquals(result.body.slack, "success");
});

Deno.test("handleJobScheduled: launch_workflow=null -> defensively treated as legacy, scheduling runs", async () => {
  const job = freshJobRow({ launch_workflow: null });
  const supabase = fakeScheduleSupabase({ job });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.action, "scheduled");
});

Deno.test("handleJobScheduled: launch_workflow column entirely absent from the row -> defensively treated as legacy, scheduling runs", async () => {
  const { launch_workflow: _omitted, ...jobWithoutColumn } = freshJobRow();
  const supabase = fakeScheduleSupabase({ job: jobWithoutColumn as any });
  const deps = { supabase, ...happyScheduleDeps() };
  const result = await handleJobScheduled(deps as any, "opp-sched-1");
  assertEquals(result.status, 200);
  assertEquals(result.body.action, "scheduled");
});
