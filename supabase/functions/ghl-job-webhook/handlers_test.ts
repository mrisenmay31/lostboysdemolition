import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseWebhookBody,
  mapContactToLabelInput,
  getCustomFieldValue,
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

function fakeSupabase(overrides: Partial<{
  existingJob: { id: string; job_number: string } | null;
  insertResult: { data: any; error: any };
  rpcResult: { data: any; error: any };
  raceExisting: { id: string; job_number: string } | null;
}> = {}) {
  const inserted: any[] = [];
  return {
    _inserted: inserted,
    rpc(fn: string) {
      if (fn === "next_job_number") {
        return Promise.resolve(overrides.rpcResult ?? { data: "JOB-1102", error: null });
      }
      return Promise.resolve({ data: null, error: new Error(`unexpected rpc ${fn}`) });
    },
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: overrides.existingJob ?? overrides.raceExisting ?? null,
                    error: null,
                  }),
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
                    overrides.insertResult ?? { data: { id: "uuid-1", job_number: row.job_number }, error: null },
                  ),
              };
            },
          };
        },
      };
    },
  };
}

Deno.test("handleQuoteAccepted: idempotent skip when job already exists", async () => {
  const supabase = fakeSupabase({ existingJob: { id: "uuid-9", job_number: "JOB-1050" } });
  const deps = {
    supabase,
    fetchOpportunity: () => Promise.reject(new Error("should not be called")),
    fetchContact: () => Promise.reject(new Error("should not be called")),
    updateOpportunity: () => Promise.reject(new Error("should not be called")),
    payloadIn: { event: "quote_accepted", opportunityId: "opp-1" },
  };
  const result = await handleQuoteAccepted(deps as any, "opp-1");
  assertEquals(result.status, 200);
  assertEquals(result.body, { action: "skipped", job_number: "JOB-1050" });
});

Deno.test("handleQuoteAccepted: creates job on happy path", async () => {
  const supabase = fakeSupabase();
  const deps = {
    supabase,
    fetchOpportunity: () =>
      Promise.resolve({
        opportunity: {
          contactId: "contact-1",
          monetaryValue: 4200,
          customFields: [{ id: JOB_ADDRESS_FIELD_ID, field_value: "4285 S 300 W, Murray, UT 84107" }],
        },
      }),
    fetchContact: () =>
      Promise.resolve({ contact: { id: "contact-1", firstName: "Ann", lastName: "Morrison", tags: ["Homeowner"] } }),
    updateOpportunity: () => Promise.resolve({ success: true }),
    payloadIn: { event: "quote_accepted", opportunityId: "opp-1" },
  };
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

Deno.test("handleQuoteAccepted: non-fatal GHL update failure still returns 200", async () => {
  const supabase = fakeSupabase();
  const deps = {
    supabase,
    fetchOpportunity: () =>
      Promise.resolve({
        opportunity: { contactId: "contact-1", monetaryValue: 1000, customFields: [] },
      }),
    fetchContact: () => Promise.resolve({ contact: { id: "contact-1", firstName: "Ann" } }),
    updateOpportunity: () => Promise.reject(new Error("GHL down")),
    payloadIn: { event: "quote_accepted", opportunityId: "opp-2" },
  };
  const result = await handleQuoteAccepted(deps as any, "opp-2");
  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.ghl_update, "failed");
});
