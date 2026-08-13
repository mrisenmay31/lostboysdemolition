// ============================================================
// Lost Boys Demolition — ghl-job-webhook pure logic + deps-injected handlers
// Kept separate from index.ts (which owns Deno.serve + cold-start network
// calls) so this module has zero top-level side effects and can be unit
// tested without hitting the network.
// ============================================================

import { buildJobName, clientLabel, parseCity } from "../_shared/job.ts";
import { addOneDay, formatCurrency } from "../_shared/google.ts";
import { writeJobEvent, writeSyncLog } from "../_shared/log.ts";

// ── GHL custom field IDs — sourced from field_mapping.md (repo root) ─────────
// field_mapping.md, Group 1 — Job Info, "Job Address"
export const JOB_ADDRESS_FIELD_ID = "4pjFIkOmQFpqZ5bOBI9z";
// field_mapping.md, Group 4 — Integration, "Job ID (human-readable)" —
// existing "Airtable Job ID" GHL field, reused per brief as the job-number field.
export const JOB_NUMBER_FIELD_ID = "Gtl6ADpbBGOlYYFil4n6";

// ── Request body contract ─────────────────────────────────────────────────────

export type WebhookEvent = "quote_accepted" | "job_scheduled";

export type ParsedWebhookBody =
  | { event: WebhookEvent; opportunityId: string }
  | { error: string };

/** Live-verification fix: GHL's "Webhook" workflow action fired and
 *  authenticated but 400'd — it nests the configured custom data under a
 *  `customData` key rather than sending it at the top level. Logged
 *  diagnostics deliberately omit the body itself (GHL's standard payload
 *  carries contact PII) — top-level key names plus the shape of `customData`
 *  are enough to tell curl/"Custom Webhook" top-level bodies apart from a
 *  "Webhook" action's nested one, or spot an unexpected third shape. */
function logParseRejection(body: Record<string, unknown>): void {
  console.error(
    "[parseWebhookBody] Rejected — top-level keys:",
    Object.keys(body),
    "| typeof customData:",
    typeof body.customData,
  );
}

export function parseWebhookBody(json: unknown): ParsedWebhookBody {
  if (typeof json !== "object" || json === null) {
    return { error: "Request body must be a JSON object" };
  }
  const body = json as Record<string, unknown>;

  // Try the top-level shape first (current contract — curl tests and
  // possibly the newer "Custom Webhook" action use it; keep it working
  // unchanged). Only when BOTH top-level keys are absent do we fall back to
  // GHL's "Webhook" action envelope, `body.customData.{event,opportunityId}`.
  let event: unknown = body.event;
  let opportunityId: unknown = body.opportunityId;

  if (
    event === undefined &&
    opportunityId === undefined &&
    typeof body.customData === "object" &&
    body.customData !== null
  ) {
    const customData = body.customData as Record<string, unknown>;
    event = customData.event;
    opportunityId = customData.opportunityId;
  }

  if (event !== "quote_accepted" && event !== "job_scheduled") {
    logParseRejection(body);
    return { error: `Unknown or missing event: ${JSON.stringify(event)}` };
  }
  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    logParseRejection(body);
    return { error: "Missing or invalid opportunityId — must be a non-empty string" };
  }
  return { event, opportunityId };
}

// ── Pure extraction helpers ───────────────────────────────────────────────────

export function mapContactToLabelInput(contact: any): {
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
} {
  const str = (v: any): string | null => (typeof v === "string" ? v : null);
  return {
    companyName: str(contact?.companyName),
    firstName: str(contact?.firstName),
    lastName: str(contact?.lastName),
  };
}

/** Looks up a GHL custom field value by field ID, tolerant of the several
 *  shapes GHL's API uses for custom fields across read/write payloads. */
export function getCustomFieldValue(
  customFields: any[] | null | undefined,
  fieldId: string,
): any {
  if (!Array.isArray(customFields)) return undefined;
  const match = customFields.find((cf) => cf?.id === fieldId || cf?.fieldId === fieldId);
  if (!match) return undefined;
  return match.field_value ?? match.fieldValue ?? match.value ?? undefined;
}

/** Normalizes a raw GHL custom-field value into a usable address string or
 *  null. Fix round 1 (I1 + I6): a non-string field value (unexpected GHL
 *  shape) must never reach parseCity/clientLabel — coerce to null instead of
 *  throwing. An empty/whitespace-only string must also fall through to the
 *  contact-address fallback rather than "winning" the ?? chain. */
export function normalizeJobAddress(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  return trimmed === "" ? null : trimmed;
}

/** Mirrors ghl-contact-sync/index.ts's resolveClientType — same tag
 *  vocabulary (Contractor / Homeowner), same case-insensitive matching. */
export function resolveClientType(tags: unknown): string | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const lower = tags.map((t) => String(t).toLowerCase());
  if (lower.includes("contractor")) return "Contractor";
  if (lower.includes("homeowner")) return "Homeowner";
  return null;
}

/** Fallback address built from a GHL contact record when the opportunity's
 *  Job Address custom field is empty. */
export function buildContactAddress(contact: any): string | null {
  if (!contact) return null;
  const parts = [contact.address1, contact.city, contact.state, contact.postalCode]
    .map((p) => (p ? String(p).trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Case-insensitive substring match against live GHL stage names — a May
 *  2026 error log showed combined names like "Deposit Received/Job Scheduled". */
export function findStageId(
  stages: Array<{ id: string; name: string }>,
  substring: string,
): string | null {
  const needle = substring.toLowerCase();
  const match = stages.find((s) => (s?.name ?? "").toLowerCase().includes(needle));
  return match ? match.id : null;
}

// ── handleQuoteAccepted — deps-injected orchestration ─────────────────────────

export interface QuoteAcceptedDeps {
  supabase: any;
  fetchOpportunity: (id: string) => Promise<any>;
  fetchContact: (id: string) => Promise<any>;
  updateOpportunity: (id: string, body: Record<string, unknown>) => Promise<any>;
  payloadIn?: unknown;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const UNIQUE_VIOLATION = "23505";

interface ExistingJobRow {
  id: string;
  job_number: string;
  job_name: string;
}

/** I3: the idempotent PUT (name + job-number custom field) is re-attempted on
 *  every "skipped" exit, not just the create path — so a re-fired webhook
 *  self-heals a GHL write-back that failed on a prior run. Non-fatal here too. */
async function retryGhlWriteBack(
  deps: QuoteAcceptedDeps,
  opportunityId: string,
  job: { job_number: string; job_name: string },
): Promise<{ status: "success" | "failed"; error: string | null }> {
  try {
    await deps.updateOpportunity(opportunityId, {
      name: job.job_name,
      customFields: [{ id: JOB_NUMBER_FIELD_ID, field_value: job.job_number }],
    });
    return { status: "success", error: null };
  } catch (err: any) {
    const msg = err.message ?? String(err);
    console.error("[handleQuoteAccepted] Skip-path GHL write-back retry failed (non-fatal):", msg);
    return { status: "failed", error: msg };
  }
}

async function respondSkipped(
  supabase: any,
  deps: QuoteAcceptedDeps,
  opportunityId: string,
  job: ExistingJobRow,
  summaryPrefix: string,
): Promise<HandlerResult> {
  const retry = await retryGhlWriteBack(deps, opportunityId, job);

  // Cleanup (controller ruling, fix round 2, I8b; corrected fix round 1, I4):
  // sync_log used to hardcode action_taken:'skipped'/status:'success'
  // regardless of retry outcome, while job_events correctly recorded 'error'
  // on a failed retry. The alignment only applies to the degraded case — a
  // normal no-op skip (retry succeeded, nothing actually changed) must stay
  // countable as action_taken:'skipped'/status:'success'. Only a FAILED GHL
  // retry gets action_taken:'updated' (a write was attempted) with
  // status:'error' and an error_message explaining what failed.
  await writeSyncLog(supabase, {
    direction: "ghl_to_supabase",
    trigger_event: "quote_accepted",
    action_taken: retry.status === "success" ? "skipped" : "updated",
    status: retry.status === "success" ? "success" : "error",
    error_message: retry.status === "failed" ? `GHL PUT retry failed (non-fatal): ${retry.error}` : null,
    payload_in: deps.payloadIn,
  });
  await writeJobEvent(supabase, {
    job_number: job.job_number,
    stage_from: null,
    stage_to: 5,
    function_name: "ghl-job-webhook",
    trigger_source: "ghl_workflow",
    ghl_opportunity_id: opportunityId,
    action_summary:
      retry.status === "success"
        ? `${summaryPrefix}; GHL write-back re-confirmed`
        : `${summaryPrefix}; GHL write-back retry failed`,
    status: retry.status === "success" ? "skipped" : "error",
    error_message: retry.status === "failed" ? `GHL PUT retry failed (non-fatal): ${retry.error}` : null,
    payload_in: deps.payloadIn,
  });

  return {
    status: 200,
    body: { action: "skipped", job_number: job.job_number, ghl_update: retry.status },
  };
}

export async function handleQuoteAccepted(
  deps: QuoteAcceptedDeps,
  opportunityId: string,
): Promise<HandlerResult> {
  const { supabase } = deps;

  // I1: outer safety net. Every branch below already has its own specific
  // error handling for expected failure modes (idempotency-check error, GHL
  // fetch failure, mint failure, insert failure); this catch exists for
  // anything unexpected — a synchronous supabase-client throw, or a bug in
  // the label/address-building steps that aren't individually try/catch'd.
  try {
    // ── Idempotency check first — the UNIQUE constraint on ghl_opportunity_id
    //    is the backstop, but checking here avoids minting a number we throw away.
    const { data: existing, error: existingError } = await supabase
      .from("jobs")
      .select("id, job_number, job_name")
      .eq("ghl_opportunity_id", opportunityId)
      .maybeSingle();

    if (existingError) {
      const msg = `Idempotency check failed: ${existingError.message ?? String(existingError)}`;
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "quote_accepted",
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      return { status: 500, body: { success: false, error: msg } };
    }

    if (existing) {
      return await respondSkipped(
        supabase,
        deps,
        opportunityId,
        existing,
        "Skipped — job already exists for this GHL opportunity",
      );
    }

    // ── Fetch opportunity + contact from GHL ────────────────────────────────────
    let opp: any;
    let contactRecord: any;
    let contactId: string;
    try {
      const opportunity = await deps.fetchOpportunity(opportunityId);
      opp = opportunity?.opportunity ?? opportunity;
      contactId = opp?.contactId;
      if (!contactId) throw new Error("Opportunity has no contactId");

      const contact = await deps.fetchContact(contactId);
      contactRecord = contact?.contact ?? contact;
    } catch (err: any) {
      const msg = `Failed to fetch opportunity/contact: ${err.message ?? String(err)}`;
      console.error("[handleQuoteAccepted]", msg);
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "quote_accepted",
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      await writeJobEvent(supabase, {
        job_number: null,
        stage_from: null,
        stage_to: 5,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: "Aborted — GHL fetch failed",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      return { status: 500, body: { success: false, error: msg } };
    }

    const labelInput = mapContactToLabelInput(contactRecord);
    const client = clientLabel(labelInput);
    const clientType = resolveClientType(contactRecord?.tags);

    // I1/I6: coerce non-string/empty custom-field values to null so an
    // unexpected GHL shape falls through to the contact-address fallback
    // instead of throwing inside parseCity, and an empty string doesn't
    // "win" a `??` chain over a usable fallback.
    const rawJobAddress = getCustomFieldValue(opp?.customFields ?? opp?.custom_fields, JOB_ADDRESS_FIELD_ID);
    const jobAddress = normalizeJobAddress(rawJobAddress) ?? buildContactAddress(contactRecord) ?? null;
    const city = parseCity(jobAddress);

    const rawMonetaryValue = opp?.monetaryValue;
    const estimateValue =
      typeof rawMonetaryValue === "number"
        ? rawMonetaryValue
        : (Number.isFinite(parseFloat(rawMonetaryValue)) ? parseFloat(rawMonetaryValue) : null);

    // ── Mint job number ──────────────────────────────────────────────────────────
    const { data: jobNumber, error: mintError } = await supabase.rpc("next_job_number");
    if (mintError || !jobNumber) {
      const msg = `Failed to mint job number: ${mintError?.message ?? "no value returned"}`;
      console.error("[handleQuoteAccepted]", msg);
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "quote_accepted",
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      await writeJobEvent(supabase, {
        job_number: null,
        stage_from: null,
        stage_to: 5,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: "Aborted — job number mint failed",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      return { status: 500, body: { success: false, error: msg } };
    }

    const jobName = buildJobName(jobNumber, client, city);

    // ── Mint + insert (per brief: select next_job_number() then insert with
    //    that number; a unique-violation race on ghl_opportunity_id loses cleanly). ──
    const { data: inserted, error: insertError } = await supabase
      .from("jobs")
      .insert({
        job_number: jobNumber,
        job_name: jobName,
        client_name: client,
        client_type: clientType,
        job_address: jobAddress,
        city,
        ghl_opportunity_id: opportunityId,
        ghl_contact_id: contactId,
        estimate_value: estimateValue,
        status_v2: "accepted",
      })
      .select("id, job_number")
      .single();

    if (insertError) {
      if (insertError.code === UNIQUE_VIOLATION) {
        const { data: raced } = await supabase
          .from("jobs")
          .select("id, job_number, job_name")
          .eq("ghl_opportunity_id", opportunityId)
          .maybeSingle();

        if (raced) {
          return await respondSkipped(
            supabase,
            deps,
            opportunityId,
            raced,
            "Skipped — lost insert race on ghl_opportunity_id",
          );
        }

        // C1 fix: a 23505 on this insert can come from EITHER unique column
        // (job_number OR ghl_opportunity_id). If the re-read on
        // ghl_opportunity_id finds nothing, the collision was NOT the
        // expected opportunity race — treating it as a benign skip here
        // would silently drop the job with no row and no GHL retry, since
        // GHL only re-fires on a genuine failure response. Treat as a full,
        // loud error instead.
        const detail = insertError.details ? ` Details: ${insertError.details}` : "";
        const msg =
          `Insert unique-violation but re-read on ghl_opportunity_id found no row — ` +
          `collision was likely on job_number, not the expected opportunity race. ` +
          `insertError: ${insertError.message ?? String(insertError)}.${detail}`;
        console.error("[handleQuoteAccepted]", msg);
        await writeSyncLog(supabase, {
          direction: "ghl_to_supabase",
          trigger_event: "quote_accepted",
          action_taken: "error",
          status: "error",
          error_message: msg,
          payload_in: deps.payloadIn,
        });
        await writeJobEvent(supabase, {
          job_number: null,
          stage_from: null,
          stage_to: 5,
          function_name: "ghl-job-webhook",
          trigger_source: "ghl_workflow",
          ghl_opportunity_id: opportunityId,
          action_summary: "Aborted — 23505 unique-violation misattributed; no row found on re-read",
          status: "error",
          error_message: msg,
          payload_in: deps.payloadIn,
        });
        return { status: 500, body: { success: false, error: msg } };
      }

      const detail = insertError.details ? ` Details: ${insertError.details}` : "";
      const msg = `Insert failed: ${insertError.message ?? String(insertError)}.${detail}`;
      console.error("[handleQuoteAccepted]", msg);
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "quote_accepted",
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      await writeJobEvent(supabase, {
        job_number: null,
        stage_from: null,
        stage_to: 5,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: "Aborted — DB insert failed",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      return { status: 500, body: { success: false, error: msg } };
    }

    // ── GHL write-back — non-fatal. Job row already committed; a failure here
    //    just means the opportunity's name/custom field lag until a retry re-fires. ──
    let ghlUpdateStatus: "success" | "failed" = "success";
    let ghlUpdateError: string | null = null;
    try {
      await deps.updateOpportunity(opportunityId, {
        name: jobName,
        customFields: [{ id: JOB_NUMBER_FIELD_ID, field_value: jobNumber }],
      });
    } catch (err: any) {
      ghlUpdateStatus = "failed";
      ghlUpdateError = err.message ?? String(err);
      console.error("[handleQuoteAccepted] GHL opportunity update failed (non-fatal):", ghlUpdateError);
    }

    await writeJobEvent(supabase, {
      job_number: jobNumber,
      stage_from: null,
      stage_to: 5,
      function_name: "ghl-job-webhook",
      trigger_source: "ghl_workflow",
      ghl_opportunity_id: opportunityId,
      action_summary:
        ghlUpdateStatus === "success"
          ? "Job created and GHL opportunity updated"
          : "Job created; GHL opportunity update failed",
      status: ghlUpdateStatus === "success" ? "success" : "error",
      error_message: ghlUpdateStatus === "failed" ? `GHL PUT failed (non-fatal): ${ghlUpdateError}` : null,
      payload_in: deps.payloadIn,
    });

    await writeSyncLog(supabase, {
      direction: "ghl_to_supabase",
      trigger_event: "quote_accepted",
      action_taken: "created",
      status: "success",
      payload_in: deps.payloadIn,
    });

    return {
      status: 200,
      body: {
        success: true,
        action: "created",
        job_number: jobNumber,
        ghl_update: ghlUpdateStatus,
      },
    };
  } catch (err: any) {
    // I1: anything that slipped past every specific try/catch above (e.g. a
    // synchronous throw from the supabase client, or an unanticipated shape
    // bug) still lands here instead of crashing the request unhandled.
    const msg = `Unexpected error in handleQuoteAccepted: ${err.message ?? String(err)}`;
    console.error("[handleQuoteAccepted]", msg);
    await writeSyncLog(supabase, {
      direction: "ghl_to_supabase",
      trigger_event: "quote_accepted",
      action_taken: "error",
      status: "error",
      error_message: msg,
      payload_in: deps.payloadIn,
    });
    await writeJobEvent(supabase, {
      job_number: null,
      stage_from: null,
      stage_to: 5,
      function_name: "ghl-job-webhook",
      trigger_source: "ghl_workflow",
      ghl_opportunity_id: opportunityId,
      action_summary: "Aborted — unexpected error",
      status: "error",
      error_message: msg,
      payload_in: deps.payloadIn,
    });
    return { status: 500, body: { success: false, error: msg } };
  }
}

// ============================================================
// ── handleJobScheduled — deps-injected orchestration (Task 4) ──────────────
// ============================================================

// ── GHL custom field IDs — sourced from ghl_field_mapping.md / field_mapping.md
// (repo root), Group 3 — Scheduling ───────────────────────────────────────
export const CREW_FIELD_ID = "fZ0oA8LnX0mK1k2or4Yi";
export const START_DATE_FIELD_ID = "j62a5w1P2v0YvgZ3dI6z";
export const END_DATE_FIELD_ID = "5SplCgVz5cocqIX21RQs";

// ── Pure extraction / validation helpers ────────────────────────────────────

export function normalizeCrew(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

const SCHEDULE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GHL date custom fields may arrive as bare YYYY-MM-DD or an ISO timestamp;
 *  take the date portion and validate it's a real calendar date. Anything
 *  else (unparseable, non-string, Feb 30) becomes null rather than throwing
 *  — the schedule guard treats a null start date as "not set". Per the
 *  brief: if the live GHL format differs from YYYY-MM-DD, that surfaces at
 *  live-verification, not here. */
export function normalizeScheduleDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const datePart = trimmed.slice(0, 10);
  if (!SCHEDULE_DATE_RE.test(datePart)) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return datePart;
}

export interface ScheduleFields {
  crew: string | null;
  startDate: string | null;
  endDate: string | null;
}

export function extractScheduleFields(opp: any): ScheduleFields {
  const customFields = opp?.customFields ?? opp?.custom_fields;
  return {
    crew: normalizeCrew(getCustomFieldValue(customFields, CREW_FIELD_ID)),
    startDate: normalizeScheduleDate(getCustomFieldValue(customFields, START_DATE_FIELD_ID)),
    endDate: normalizeScheduleDate(getCustomFieldValue(customFields, END_DATE_FIELD_ID)),
  };
}

export interface ScheduleGuardResult {
  skip: boolean;
  reason?: string;
}

/** Schedule-path guard (controller ruling): a job row must already exist for
 *  this opportunity (created by quote_accepted) before anything else runs,
 *  and Crew + Start Date must both be populated on the opportunity. Both
 *  failure modes are explicit 200 skips, not errors — a job not yet existing
 *  or not yet fully assigned is expected, ordinary state. */
export function shouldSkipSchedule(
  job: { id: string } | null,
  fields: ScheduleFields,
): ScheduleGuardResult {
  if (!job) {
    return { skip: true, reason: "no job record — was Quote Accepted skipped?" };
  }
  if (!fields.crew || !fields.startDate) {
    return { skip: true, reason: "crew or start date not set" };
  }
  return { skip: false };
}

// ── Crew → env-key resolution (shared shape for calendar + Slack maps) ──────

export type CrewEnvKey = "crew1" | "crew2" | "crew3" | "crew4";

const CREW_ENV_KEY_MAP: Record<string, CrewEnvKey> = {
  "crew 1": "crew1",
  "crew 2": "crew2",
  "crew 3": "crew3",
  "crew 4": "crew4",
};

/** Case-insensitive/trimmed match — pattern airtable-job-scheduled/index.ts:64. */
export function resolveCrewEnvKey(crew: string | null): CrewEnvKey | null {
  if (!crew) return null;
  return CREW_ENV_KEY_MAP[crew.trim().toLowerCase()] ?? null;
}

// ── Calendar event body ──────────────────────────────────────────────────────

export interface ScheduleJobInput {
  job_name: string;
  client_name: string | null;
  job_address: string | null;
  estimate_value: number | null;
  crew: string | null;
  start_date: string;
  end_date: string | null;
}

/** Client, estimate value, crew, address — omit any line whose value is
 *  null/empty. No scope/line-items section (that arrives in Phase B). */
export function buildCalendarDescription(job: ScheduleJobInput): string {
  const lines: string[] = [];
  if (job.client_name) lines.push(`Client: ${job.client_name}`);
  if (job.estimate_value != null) lines.push(`Estimate: ${formatCurrency(job.estimate_value)}`);
  if (job.crew) lines.push(`Crew: ${job.crew}`);
  if (job.job_address) lines.push(`Address: ${job.job_address}`);
  return lines.join("\n");
}

export function buildCalendarEventBody(job: ScheduleJobInput): {
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
} {
  const effectiveEnd = job.end_date || job.start_date;
  return {
    summary: job.job_name,
    description: buildCalendarDescription(job),
    start: { date: job.start_date },
    end: { date: addOneDay(effectiveEnd) },
  };
}

// ── Slack message ────────────────────────────────────────────────────────────

function formatScheduleDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const month = dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${weekday} ${month} ${d}`;
}

/** Exact template per controller ruling — omit 📍/👤 lines when null; no
 *  🕗/📞 (those fields don't exist on the jobs row). */
export function buildSlackScheduleMessage(job: {
  job_name: string;
  start_date: string;
  job_address: string | null;
  client_name: string | null;
}): string {
  const lines = [
    `🏗️ New job scheduled: ${job.job_name}`,
    `📅 ${formatScheduleDate(job.start_date)}`,
  ];
  if (job.job_address) lines.push(`📍 ${job.job_address}`);
  if (job.client_name) lines.push(`👤 ${job.client_name}`);
  return lines.join("\n");
}

// ── handleJobScheduled — deps-injected orchestration ─────────────────────────

// 'stale' (fix round 1, I3) — a reschedule was detected (crew/dates changed
// after the calendar leg's IDs were already stamped) and the calendar leg
// was a no-op this fire; distinct from 'skipped' so the response is honest
// that the existing calendar events no longer reflect the new crew/dates.
export type LegStatus = "success" | "partial" | "skipped" | "error" | "stale";

export interface JobScheduledDeps {
  supabase: any;
  fetchOpportunity: (id: string) => Promise<any>;
  getAccessToken: () => Promise<string>;
  createCalendarEvent: (calendarId: string, accessToken: string, eventBody: any) => Promise<{ id: string }>;
  calendarIds: Record<"main" | CrewEnvKey, string>;
  postSlackMessage: (channel: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  slackChannels: Record<CrewEnvKey, string>;
  billApiToken: string | null;
  ensureBillJobCode: (jobName: string) => Promise<{ status: "success" | "error"; error?: string }>;
  payloadIn?: unknown;
}

interface ScheduleJobRow {
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

export async function handleJobScheduled(
  deps: JobScheduledDeps,
  opportunityId: string,
): Promise<HandlerResult> {
  const { supabase } = deps;

  try {
    // ── Guard 1: job row must already exist (created by quote_accepted) ──────
    const { data: job, error: jobLookupError } = await supabase
      .from("jobs")
      .select(
        "id, job_number, job_name, client_name, job_address, estimate_value, crew, " +
          "start_date, end_date, gcal_main_event_id, gcal_crew_event_id, slack_notified_at, bill_job_code",
      )
      .eq("ghl_opportunity_id", opportunityId)
      .maybeSingle();

    if (jobLookupError) {
      const msg = `Job lookup failed: ${jobLookupError.message ?? String(jobLookupError)}`;
      console.error("[handleJobScheduled]", msg);
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "job_scheduled",
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      return { status: 500, body: { success: false, error: msg } };
    }

    if (!job) {
      const guard = shouldSkipSchedule(null, { crew: null, startDate: null, endDate: null });
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "job_scheduled",
        action_taken: "skipped",
        status: "success",
        payload_in: deps.payloadIn,
      });
      await writeJobEvent(supabase, {
        job_number: null,
        stage_from: null,
        stage_to: 6,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: `Skipped — ${guard.reason}`,
        status: "skipped",
        payload_in: deps.payloadIn,
      });
      return { status: 200, body: { action: "skipped", reason: guard.reason } };
    }

    const jobRow = job as ScheduleJobRow;

    // ── Fetch opportunity, extract Crew + Start/End Date ──────────────────────
    let opp: any;
    try {
      const opportunity = await deps.fetchOpportunity(opportunityId);
      opp = opportunity?.opportunity ?? opportunity;
    } catch (err: any) {
      const msg = `Failed to fetch opportunity: ${err.message ?? String(err)}`;
      console.error("[handleJobScheduled]", msg);
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "job_scheduled",
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      await writeJobEvent(supabase, {
        job_number: jobRow.job_number,
        stage_from: 5,
        stage_to: 6,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: "Aborted — GHL opportunity fetch failed",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      return { status: 500, body: { success: false, error: msg } };
    }

    const fields = extractScheduleFields(opp);

    // ── Guard 2: Crew + Start Date must both be set ───────────────────────────
    const guard = shouldSkipSchedule(jobRow, fields);
    if (guard.skip) {
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "job_scheduled",
        action_taken: "skipped",
        status: "success",
        payload_in: deps.payloadIn,
      });
      await writeJobEvent(supabase, {
        job_number: jobRow.job_number,
        stage_from: 5,
        stage_to: 6,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: `Skipped — ${guard.reason}`,
        status: "skipped",
        payload_in: deps.payloadIn,
      });
      return { status: 200, body: { action: "skipped", reason: guard.reason } };
    }

    const startDate = fields.startDate!;
    const crewEnvKey = resolveCrewEnvKey(fields.crew);

    // ── Fix round 1, I3: reschedule visibility ────────────────────────────────
    // A "reschedule" is crew/start/end changing on an opportunity whose
    // calendar or Slack leg was already stamped from a prior fire. We do NOT
    // patch/delete/re-create calendar events and do NOT re-send Slack here —
    // that's a deferred backlog item — but we DO still persist the new
    // crew/dates below, and we make the drift loud: a job_events row, a
    // console.error, and (when the calendar leg is a no-op this fire because
    // its IDs are already stamped) a 'stale' calendar status in the response
    // instead of a misleadingly clean 'skipped'.
    const legsStamped = Boolean(jobRow.gcal_main_event_id) || Boolean(jobRow.slack_notified_at);
    const rescheduleDetected =
      legsStamped &&
      (jobRow.crew !== fields.crew ||
        jobRow.start_date !== fields.startDate ||
        jobRow.end_date !== fields.endDate);

    if (rescheduleDetected) {
      const rescheduleMsg =
        `Reschedule detected for ${jobRow.job_number} — crew/dates changed after the calendar/Slack ` +
        `legs were already stamped. NOT auto-patching calendar events or re-sending Slack (deferred ` +
        `backlog item). old: crew=${jobRow.crew ?? "—"} start=${jobRow.start_date ?? "—"} end=${jobRow.end_date ?? "—"} ` +
        `| new: crew=${fields.crew ?? "—"} start=${fields.startDate ?? "—"} end=${fields.endDate ?? "—"}`;
      console.error("[handleJobScheduled]", rescheduleMsg);
      await writeJobEvent(supabase, {
        job_number: jobRow.job_number,
        stage_from: 6,
        stage_to: 6,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: "reschedule_detected",
        status: "success",
        payload_in: {
          old: { crew: jobRow.crew, start_date: jobRow.start_date, end_date: jobRow.end_date },
          new: { crew: fields.crew, start_date: fields.startDate, end_date: fields.endDate },
        },
      });
    }

    // ── Leg 1: Calendar — per-EVENT-ID idempotency (fix round 1, C1+C2) ────────
    // C1+C2 shared root cause: the old gate checked ONLY gcal_main_event_id
    // for the whole leg, so (C1) a re-fire that only ever got the main event
    // created never went back for a still-missing crew event, and (C2) if
    // main failed but crew succeeded, a re-fire would try to recreate BOTH,
    // duplicating the crew event. Each target is now gated on its own column.
    let calendarStatus: LegStatus;
    let mainEventId: string | null = null;
    let crewEventId: string | null = null;
    let calendarError: string | null = null;

    const needsMain = !jobRow.gcal_main_event_id;
    const needsCrew = !jobRow.gcal_crew_event_id;

    if (!needsMain && !needsCrew) {
      calendarStatus = "skipped";
    } else {
      const eventBody = buildCalendarEventBody({
        job_name: jobRow.job_name,
        client_name: jobRow.client_name,
        job_address: jobRow.job_address,
        estimate_value: jobRow.estimate_value,
        crew: fields.crew,
        start_date: startDate,
        end_date: fields.endDate,
      });

      const targets: Array<{ label: "main" | "crew"; calendarId: string }> = [];
      const mainConfigMissing = needsMain && !deps.calendarIds.main;
      if (needsMain && deps.calendarIds.main) {
        targets.push({ label: "main", calendarId: deps.calendarIds.main });
      }

      // I1: a crew value that maps to a known crew (Crew 1-4) but whose
      // calendar env var isn't configured is a misconfiguration, not the
      // ordinary "this job's crew has no crew calendar" case — warn
      // (precedent: airtable-job-scheduled/index.ts:426-428) and make sure
      // the response never claims a bare 'success' while silently never
      // creating that crew event.
      let crewMisconfigured = false;
      if (needsCrew) {
        if (crewEnvKey) {
          const crewCalId = deps.calendarIds[crewEnvKey];
          if (crewCalId) {
            targets.push({ label: "crew", calendarId: crewCalId });
          } else {
            crewMisconfigured = true;
            console.warn(
              `[calendar] No crew calendar mapped for crew value: "${fields.crew}" — posting to main only`,
            );
          }
        }
        // else: crew value isn't one of the 4 known crews (e.g. "Jackson"/
        // "Other") — no crew calendar is expected, that's ordinary, not a
        // misconfiguration.
      }

      const errors: string[] = [];
      if (targets.length > 0) {
        try {
          const accessToken = await deps.getAccessToken();
          const results = await Promise.allSettled(
            targets.map((t) => deps.createCalendarEvent(t.calendarId, accessToken, eventBody)),
          );
          results.forEach((r, i) => {
            const t = targets[i];
            if (r.status === "fulfilled") {
              if (t.label === "main") {
                mainEventId = r.value.id;
                console.log(`[calendar] main event created: ${mainEventId}`);
              } else {
                crewEventId = r.value.id;
                console.log(`[calendar] crew event created: ${crewEventId}`);
              }
            } else {
              errors.push(`${t.label}: ${r.reason?.message ?? String(r.reason)}`);
            }
          });
        } catch (err: any) {
          errors.push(`access-token: ${err.message ?? String(err)}`);
        }
      }

      const anyCreated = mainEventId !== null || crewEventId !== null;
      const errParts = [...errors];
      if (crewMisconfigured) {
        errParts.push(`no crew calendar configured for ${fields.crew}`);
      } else if (mainConfigMissing && targets.length === 0) {
        errParts.push("no calendar IDs configured for the needed leg(s)");
      }

      if (targets.length === 0) {
        calendarStatus = crewMisconfigured ? "partial" : "skipped";
      } else if (errors.length === 0 && !crewMisconfigured) {
        calendarStatus = "success";
      } else if (anyCreated || crewMisconfigured) {
        calendarStatus = "partial";
      } else {
        calendarStatus = "error";
      }

      calendarError = errParts.length > 0 ? errParts.join("; ") : null;
    }

    // I2: persist any newly-created event IDs IMMEDIATELY — a small, dedicated
    // update touching only the gcal columns — before Slack/BILL run and before
    // the terminal update below. A later terminal-update failure (unrelated
    // columns) must not orphan calendar events that were actually created.
    if (mainEventId || crewEventId) {
      const gcalUpdatePayload: Record<string, unknown> = {};
      if (mainEventId) gcalUpdatePayload.gcal_main_event_id = mainEventId;
      if (crewEventId) gcalUpdatePayload.gcal_crew_event_id = crewEventId;
      const { error: gcalPersistError } = await supabase
        .from("jobs")
        .update(gcalUpdatePayload)
        .eq("id", jobRow.id);
      if (gcalPersistError) {
        const persistMsg =
          `Failed to persist calendar event ID(s) immediately: ${gcalPersistError.message ?? String(gcalPersistError)}`;
        console.error("[handleJobScheduled]", persistMsg);
        calendarError = calendarError ? `${calendarError}; ${persistMsg}` : persistMsg;
        if (calendarStatus === "success") calendarStatus = "partial";
      }
    }

    // I3: the calendar leg being a clean no-op ('skipped', both IDs already
    // stamped) is only honestly 'skipped' if nothing changed since — a
    // reschedule makes the still-existing events stale, not current.
    if (rescheduleDetected && calendarStatus === "skipped") {
      calendarStatus = "stale";
    }

    // ── Leg 2: Slack (idempotent on slack_notified_at) ────────────────────────
    let slackStatus: LegStatus;
    let slackNotified = false;
    let slackError: string | null = null;

    if (jobRow.slack_notified_at) {
      slackStatus = "skipped";
    } else {
      const channel = crewEnvKey ? deps.slackChannels[crewEnvKey] : "";
      if (!crewEnvKey || !channel) {
        slackStatus = "skipped";
        slackError = crewEnvKey
          ? "no Slack channel configured for crew"
          : "crew not mapped to a known crew Slack channel";
      } else {
        try {
          const message = buildSlackScheduleMessage({
            job_name: jobRow.job_name,
            start_date: startDate,
            job_address: jobRow.job_address,
            client_name: jobRow.client_name,
          });
          const result = await deps.postSlackMessage(channel, message);
          if (result.ok) {
            slackStatus = "success";
            slackNotified = true;
          } else {
            slackStatus = "error";
            slackError = result.error ?? "Slack API returned ok:false";
          }
        } catch (err: any) {
          slackStatus = "error";
          slackError = err.message ?? String(err);
        }
      }
    }

    // ── Leg 3: BILL job code (gated on BILL_API_TOKEN; idempotent on bill_job_code) ──
    let billStatus: LegStatus;
    let billJobCode: string | null = null;
    let billError: string | null = null;

    if (jobRow.bill_job_code) {
      billStatus = "skipped";
    } else if (!deps.billApiToken) {
      billStatus = "skipped";
    } else {
      try {
        const result = await deps.ensureBillJobCode(jobRow.job_name);
        if (result.status === "success") {
          billStatus = "success";
          billJobCode = jobRow.job_name;
        } else {
          billStatus = "error";
          billError = result.error ?? "BILL job code creation failed";
        }
      } catch (err: any) {
        billStatus = "error";
        billError = err.message ?? String(err);
      }
    }

    // ── Persist ────────────────────────────────────────────────────────────────
    // I2: gcal_main_event_id / gcal_crew_event_id are deliberately NOT set here
    // — they were already committed immediately after the calendar leg, above,
    // specifically so a failure in THIS update can't orphan them.
    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      crew: fields.crew,
      start_date: fields.startDate,
      end_date: fields.endDate,
      status_v2: "scheduled",
      updated_at: nowIso,
    };
    if (slackNotified) updatePayload.slack_notified_at = nowIso;
    if (billJobCode) updatePayload.bill_job_code = billJobCode;

    const { error: updateError } = await supabase.from("jobs").update(updatePayload).eq("id", jobRow.id);

    if (updateError) {
      const msg = `Job row update failed: ${updateError.message ?? String(updateError)}`;
      console.error("[handleJobScheduled]", msg);
      await writeSyncLog(supabase, {
        direction: "ghl_to_supabase",
        trigger_event: "job_scheduled",
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      await writeJobEvent(supabase, {
        job_number: jobRow.job_number,
        stage_from: 5,
        stage_to: 6,
        function_name: "ghl-job-webhook",
        trigger_source: "ghl_workflow",
        ghl_opportunity_id: opportunityId,
        action_summary: `Aborted — job row update failed | calendar: ${calendarStatus}, slack: ${slackStatus}, bill: ${billStatus}`,
        status: "error",
        error_message: msg,
        payload_in: deps.payloadIn,
      });
      return { status: 500, body: { success: false, error: msg } };
    }

    const legErrors = [
      calendarError ? `calendar: ${calendarError}` : null,
      slackError ? `slack: ${slackError}` : null,
      billError ? `bill: ${billError}` : null,
    ].filter((x): x is string => x !== null);
    const anyLegError = calendarStatus === "error" || slackStatus === "error" || billStatus === "error";
    const overallErrorMsg = legErrors.length > 0 ? legErrors.join(" | ") : null;

    await writeJobEvent(supabase, {
      job_number: jobRow.job_number,
      stage_from: 5,
      stage_to: 6,
      function_name: "ghl-job-webhook",
      trigger_source: "ghl_workflow",
      ghl_opportunity_id: opportunityId,
      action_summary: `Job scheduled | calendar: ${calendarStatus}, slack: ${slackStatus}, bill: ${billStatus}`,
      status: anyLegError ? "error" : "success",
      error_message: overallErrorMsg,
      payload_in: deps.payloadIn,
    });

    await writeSyncLog(supabase, {
      direction: "ghl_to_supabase",
      trigger_event: "job_scheduled",
      action_taken: "updated",
      status: anyLegError ? "error" : "success",
      error_message: overallErrorMsg,
      payload_in: deps.payloadIn,
    });

    return {
      status: 200,
      body: {
        success: true,
        action: "scheduled",
        job_number: jobRow.job_number,
        calendar: calendarStatus,
        slack: slackStatus,
        bill: billStatus,
      },
    };
  } catch (err: any) {
    const msg = `Unexpected error in handleJobScheduled: ${err.message ?? String(err)}`;
    console.error("[handleJobScheduled]", msg);
    await writeSyncLog(supabase, {
      direction: "ghl_to_supabase",
      trigger_event: "job_scheduled",
      action_taken: "error",
      status: "error",
      error_message: msg,
      payload_in: deps.payloadIn,
    });
    await writeJobEvent(supabase, {
      job_number: null,
      stage_from: 5,
      stage_to: 6,
      function_name: "ghl-job-webhook",
      trigger_source: "ghl_workflow",
      ghl_opportunity_id: opportunityId,
      action_summary: "Aborted — unexpected error",
      status: "error",
      error_message: msg,
      payload_in: deps.payloadIn,
    });
    return { status: 500, body: { success: false, error: msg } };
  }
}
