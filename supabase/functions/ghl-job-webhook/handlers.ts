// ============================================================
// Lost Boys Demolition — ghl-job-webhook pure logic + deps-injected handlers
// Kept separate from index.ts (which owns Deno.serve + cold-start network
// calls) so this module has zero top-level side effects and can be unit
// tested without hitting the network.
// ============================================================

import { buildJobName, clientLabel, parseCity } from "../_shared/job.ts";
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

export function parseWebhookBody(json: unknown): ParsedWebhookBody {
  if (typeof json !== "object" || json === null) {
    return { error: "Request body must be a JSON object" };
  }
  const body = json as Record<string, unknown>;
  const { event, opportunityId } = body;

  if (event !== "quote_accepted" && event !== "job_scheduled") {
    return { error: `Unknown or missing event: ${JSON.stringify(event)}` };
  }
  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
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

  await writeSyncLog(supabase, {
    direction: "ghl_to_supabase",
    trigger_event: "quote_accepted",
    action_taken: "skipped",
    status: "success",
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
