import "server-only";

// ============================================================
// Lost Boys Demolition — web app — GHL push orchestration
//
// pushEstimateToGhl(estimateId) pushes one estimate version to GHL as two
// independently try/caught targets:
//   - fields: an opportunity carrying the pricing custom fields (always
//     attempted).
//   - doc: a customer-facing GHL estimate document (attempted unless Path
//     B / missing contact email+phone / the GHL estimates scope isn't
//     granted).
//
// Every DB write here (ghl_push_state, sync_log, job_events) is
// independently try/caught and non-fatal to the returned PushResult — a
// logging or bookkeeping failure never hides (or is hidden by) whether the
// actual GHL push succeeded. The already-committed estimate row is never
// touched or rolled back by any of this.
//
// Idempotency: calling this function again for the same estimate always
// re-attempts BOTH targets. That's deliberate, not a bug — "retry only
// what's unfinished" falls out naturally from each target's own
// attach/create and create/replace/revise decisions being idempotent
// (re-applying the same fields to an existing opportunity, or
// full-replacing a still-draft doc, is always safe), rather than from any
// "skip if already done" bookkeeping here.
// ============================================================

import { createAdminClient } from "@/lib/supabase/admin";
import { getEstimate } from "@/lib/estimates/repo";
import type { EstimateLineItemRow, EstimateRow, GhlPushStateRow } from "@/lib/estimates/types";
import { writeJobEvent, writeSyncLog } from "@/lib/log";
import {
  GhlApiError,
  createContact,
  createOpportunity,
  getCustomFieldDefs,
  listEstimateDocs,
  resolvePipeline,
  searchOpportunitiesByContact,
  updateOpportunity,
} from "./client";
import {
  buildEstimateDocPayload,
  createEstimateDoc,
  findDocByMeta,
  updateEstimateDoc,
  type EstimateDocContact,
} from "./estimateDoc";
import {
  ESTIMATE_FIELD_IDS,
  buildEstimateCustomFields,
  buildJobScopeSelection,
  buildScopeNotes,
  computeLaborHoursField,
  decideDocAction,
  decideDocPreflight,
  extractDocStatus,
  findExistingOpportunityByName,
  opportunityName,
  selectInheritedState,
  splitClientName,
  type ChainVersionRef,
} from "./estimateFields";

export interface PushResult {
  fields: "ok" | "error";
  doc: "ok" | "skipped_path_b" | "skipped_missing_contact" | "not_configured" | "error";
  errors?: { fields?: string; doc?: string };
}

const FUNCTION_NAME = "web-estimate-push";
const ESTIMATE_IN_PROGRESS_STAGE = 3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── ghl_push_state persistence ────────────────────────────────────────────
// Mutable bookkeeping (see CLAUDE.md: "kept OFF the immutable estimates
// table by design"), so a failed write here degrades future idempotency
// but must never fail the push itself — swallowed + logged, same
// contract as log.ts's writers.

async function upsertPushState(
  admin: AdminClient,
  estimateId: string,
  patch: Partial<Omit<GhlPushStateRow, "estimate_id" | "attempts" | "updated_at">> & {
    incrementAttempts?: boolean;
  },
): Promise<void> {
  const { incrementAttempts, ...rest } = patch;
  const updates: Record<string, unknown> = { estimate_id: estimateId, ...rest, updated_at: nowIso() };

  if (incrementAttempts) {
    const { data } = await admin
      .from("ghl_push_state")
      .select("attempts")
      .eq("estimate_id", estimateId)
      .maybeSingle();
    updates.attempts = ((data?.attempts as number | undefined) ?? 0) + 1;
  }

  const { error } = await admin.from("ghl_push_state").upsert(updates);
  if (error) console.error("[push] ghl_push_state upsert failed:", error);
}

/** Binding carry #3: a v2+ estimate's own ghl_push_state row is empty, so
 *  on first push we walk the version chain (already fetched by
 *  getEstimate()) and adopt the nearest ancestor's push state — carrying
 *  the GHL contact/opportunity/doc ids forward so a revision updates the
 *  SAME opportunity and revises the SAME doc lineage instead of push.ts
 *  creating duplicates. */
async function loadInheritedPushState(
  admin: AdminClient,
  versionChain: EstimateRow[],
  ownEstimateId: string,
): Promise<GhlPushStateRow | null> {
  const ancestorIds = versionChain.filter((v) => v.id !== ownEstimateId).map((v) => v.id);
  if (ancestorIds.length === 0) return null;

  const { data, error } = await admin.from("ghl_push_state").select("*").in("estimate_id", ancestorIds);
  if (error || !data) return null;

  const byId: Record<string, GhlPushStateRow | null | undefined> = {};
  for (const row of data as GhlPushStateRow[]) byId[row.estimate_id] = row;

  const chainRefs: ChainVersionRef[] = versionChain.map((v) => ({ id: v.id, version: v.version }));
  return selectInheritedState(chainRefs, byId, ownEstimateId);
}

// ── Job Scope live option list ────────────────────────────────────────────
// Best-effort: a failure here (e.g. a transient GHL error) degrades to
// "every line item name drops into Scope Notes instead of the multi-select"
// rather than failing the whole fields target over a field that's
// secondary to the pricing numbers.

async function loadJobScopeOptions(): Promise<string[]> {
  try {
    const defs = await getCustomFieldDefs();
    const jobScopeDef = defs.find((d) => d.id === ESTIMATE_FIELD_IDS.jobScope);
    return jobScopeDef?.picklistOptions ?? [];
  } catch {
    return [];
  }
}

// ── Contact resolution ────────────────────────────────────────────────────
//
// LIVE FINDING (Task 12 E2E, 2026-08-14): client.ts's searchContactByEmail
// (Task 9) calls `GET /contacts/?locationId=...&email=...`, which the live
// GHL API now rejects with a 422 ("property email should not exist") —
// that query shape is no longer accepted. Swapping to `query=` or the
// dedicated POST /contacts/search endpoint returns 200 but empty results
// even for a contact created and confirmed-readable seconds earlier (index
// propagation lag or a search-scope gap — not chased further; out of this
// task's file scope, since searchContactByEmail belongs to Task 9's
// already-merged client.ts).
//
// Route around it entirely: createContact's documented dup-400-reuse path
// (client.ts, "on a 400 where GHL blocks the create as a duplicate...
// returns that existing contact's id instead of throwing") is
// live-reverified working in this same session — POSTing a contact whose
// email already exists reliably returns 400 with `meta.contactId`. So
// resolveContact always attempts create-or-reuse via createContact alone;
// it never calls the broken search. See task-12-report.md.

async function resolveContact(estimate: EstimateRow): Promise<string> {
  if (!estimate.client_email) {
    throw new Error(
      `pushEstimateToGhl: estimate ${estimate.id} has no client_email — cannot resolve a GHL contact`,
    );
  }

  const { firstName, lastName } = splitClientName(estimate.client_name);
  return createContact({
    firstName,
    lastName,
    email: estimate.client_email,
    phone: estimate.client_phone ?? undefined,
    address1: estimate.job_address ?? undefined,
    city: estimate.city ?? undefined,
  });
}

// ── Fields target ──────────────────────────────────────────────────────
// Attach path (a known opportunity id — either this estimate's own prior
// push, or inherited from a parent version) always wins over the create
// path. The create path itself search-before-creates (binding carry #2)
// to guard against a duplicate opportunity on a network-retry crash
// between createOpportunity succeeding and ghl_push_state being persisted.

interface FieldsTargetResult {
  opportunityId: string;
  createdNewOpportunity: boolean;
}

/** CV-2 SETTLED LIVE (Task 12 fix round 1, 2026-08-14): `PUT /opportunities/{id}`
 *  MERGES `customFields` into the opportunity's existing set — it does NOT
 *  replace the array. Live-verified: created a disposable test opportunity
 *  with field A set, PUT with ONLY field B in `customFields`, then fetched
 *  fresh — field A was still present in both the PUT response and the
 *  follow-up GET. So a re-push here is safe: it can never wipe Crew, Job
 *  Start/End Date, or any other field written by ghl-job-webhook /
 *  airtable-job-scheduled, and it can never wipe this module's OWN
 *  conditionally-omitted fields (Estimator/Job Scope/Airtable Job ID when
 *  null, or Job Scope when loadJobScopeOptions() degrades to []) — an
 *  earlier push's values for those stay put under a merge, they are not
 *  nulled out by a later push that happens to omit them. */
async function pushFieldsTarget(
  estimate: EstimateRow,
  lineItems: EstimateLineItemRow[],
  jobScopeOptions: string[],
  priorDocNumber: string | null,
  contactId: string,
  knownOpportunityId: string | null,
): Promise<FieldsTargetResult> {
  const jobScope = buildJobScopeSelection(
    lineItems.map((li) => li.name),
    jobScopeOptions,
  );
  const scopeNotes = buildScopeNotes({
    estimate,
    lineItems,
    droppedScopeNames: jobScope.dropped,
    docNumber: priorDocNumber,
  });
  const laborHours = computeLaborHoursField(estimate.labor_cost, estimate.labor_rate);
  const customFields = buildEstimateCustomFields({
    estimate,
    laborHours,
    jobScopeMatched: jobScope.matched,
    scopeNotes,
  });
  const name = opportunityName(estimate);
  const monetaryValue = estimate.quoted_price ?? estimate.total_bid;

  if (knownOpportunityId) {
    await updateOpportunity(knownOpportunityId, { name, monetaryValue, customFields });
    return { opportunityId: knownOpportunityId, createdNewOpportunity: false };
  }

  const existingOpps = await searchOpportunitiesByContact(contactId);
  const match = findExistingOpportunityByName(existingOpps, name);
  if (match) {
    await updateOpportunity(match.id, { name, monetaryValue, customFields });
    return { opportunityId: match.id, createdNewOpportunity: false };
  }

  const pipeline = await resolvePipeline();
  const opportunityId = await createOpportunity({
    name,
    status: "open",
    pipelineId: pipeline.pipelineId,
    pipelineStageId: pipeline.estimateInProgressStageId,
    contactId,
    monetaryValue,
    customFields,
  });
  return { opportunityId, createdNewOpportunity: true };
}

// ── Doc target ──────────────────────────────────────────────────────────

interface DocTargetResult {
  docId: string;
  docNumber: string | null;
  action: "create" | "replace" | "revise";
}

function toDocContact(estimate: EstimateRow, contactId: string): EstimateDocContact {
  return {
    id: contactId,
    name: estimate.client_name,
    email: estimate.client_email,
    phone: estimate.client_phone,
  };
}

async function pushDocTarget(
  estimate: EstimateRow,
  lineItems: EstimateLineItemRow[],
  contactId: string,
  priorDocId: string | null,
): Promise<DocTargetResult> {
  let docId = priorDocId;
  let docStatus: string | null = null;

  if (docId) {
    // Known doc — read its live status to decide replace vs. revise. A
    // 401/403 here propagates to the caller, which classifies it as
    // 'not_configured'.
    const list = await listEstimateDocs({ contactId });
    docStatus = extractDocStatus(list, docId);
  } else {
    // No known doc — create-then-crash recovery lookup. findDocByMeta's
    // own listEstimateDocs call doubles as the live scope smoke test (a
    // 401/403 propagates from there too).
    const recovered = await findDocByMeta(contactId, estimate.id);
    if (recovered) {
      docId = recovered.id;
      docStatus = "draft"; // just-recovered — assume still draft, see decideDocAction
    }
  }

  const action = decideDocAction(docId, docStatus);
  const contact = toDocContact(estimate, contactId);

  if (action === "create") {
    const payload = buildEstimateDocPayload(estimate, lineItems, contact, { isRevision: false });
    const result = await createEstimateDoc(payload);
    return { docId: result.id, docNumber: result.estimateNumber, action };
  }

  if (action === "replace") {
    const payload = buildEstimateDocPayload(estimate, lineItems, contact, { isRevision: false });
    try {
      const result = await updateEstimateDoc(docId as string, payload);
      return { docId: docId as string, docNumber: result.estimateNumber, action };
    } catch (err) {
      // Review finding 3: a tracked doc that was deleted out-of-band (e.g.
      // Dane deleting a draft in the GHL UI) 404s on PUT. Without this
      // fallback that would wedge the estimate on doc:"error" forever —
      // decideDocAction would keep returning "replace" against a docId
      // that will never again resolve. Recover by creating a fresh draft
      // and adopting its id, exactly like the "create" branch above.
      if (err instanceof GhlApiError && err.status === 404) {
        const created = await createEstimateDoc(payload);
        return { docId: created.id, docNumber: created.estimateNumber, action: "create" };
      }
      throw err;
    }
  }

  // revise — the prior doc (sent/viewed/accepted/declined) is left alone;
  // a new "ESTIMATE (REVISED)" draft is created and tracking moves to it.
  const payload = buildEstimateDocPayload(estimate, lineItems, contact, { isRevision: true });
  const result = await createEstimateDoc(payload);
  return { docId: result.id, docNumber: result.estimateNumber, action };
}

// ── Orchestrator ──────────────────────────────────────────────────────────

/**
 * Pushes one estimate version to GHL. See module header for the
 * fields/doc target contract and idempotency model.
 */
export async function pushEstimateToGhl(estimateId: string): Promise<PushResult> {
  const admin = createAdminClient();
  const detail = await getEstimate(estimateId);
  const { estimate, lineItems, versionChain } = detail;

  let state = detail.pushState;
  if (!state && estimate.supersedes_estimate_id) {
    state = await loadInheritedPushState(admin, versionChain, estimate.id);
  }

  const isPathB = estimate.is_path_b;

  let contactId = state?.ghl_contact_id ?? null;
  let opportunityId = state?.ghl_opportunity_id ?? null;
  const priorDocId = state?.ghl_estimate_id ?? null;
  const priorDocNumber = state?.ghl_estimate_number ?? null;

  const errors: { fields?: string; doc?: string } = {};
  let fieldsResult: PushResult["fields"] = "ok";

  const jobScopeOptions = await loadJobScopeOptions();

  try {
    // Review finding 2c: resolve the contact FIRST and assign it to the
    // outer `contactId` immediately on success — before attempting the
    // opportunity create/update — so a failure in the REST of the fields
    // target (e.g. a transient updateOpportunity 500) doesn't discard a
    // contact id that was already in hand. Only actually resolves when not
    // already known (attach path / inherited from a parent version).
    if (!contactId) {
      contactId = await resolveContact(estimate);
    }

    const fieldsOut = await pushFieldsTarget(
      estimate,
      lineItems,
      jobScopeOptions,
      priorDocNumber,
      contactId,
      opportunityId,
    );
    opportunityId = fieldsOut.opportunityId;

    await upsertPushState(admin, estimate.id, {
      ghl_contact_id: contactId,
      ghl_opportunity_id: opportunityId,
      fields_pushed_at: nowIso(),
      last_error: null,
    });
    await writeSyncLog(admin, {
      direction: "app_to_ghl",
      trigger_event: "estimate_push_fields",
      action_taken: fieldsOut.createdNewOpportunity ? "created" : "updated",
      status: "success",
      payload_in: { estimateId: estimate.id, estimateNumber: estimate.estimate_number, version: estimate.version },
    });

    // job_events only when a brand-new opportunity was actually POSTed —
    // not on attach, and not on a search-recovered match.
    if (fieldsOut.createdNewOpportunity) {
      await writeJobEvent(admin, {
        job_number: estimate.job_number,
        stage_from: null,
        stage_to: ESTIMATE_IN_PROGRESS_STAGE,
        function_name: FUNCTION_NAME,
        trigger_source: "app",
        ghl_opportunity_id: opportunityId,
        action_summary: `Created GHL opportunity for estimate #${estimate.estimate_number} v${estimate.version}`,
        status: "success",
        payload_in: { estimateId: estimate.id },
      });
    }
  } catch (err) {
    fieldsResult = "error";
    errors.fields = errorMessage(err);
    await upsertPushState(admin, estimate.id, {
      ghl_contact_id: contactId,
      ghl_opportunity_id: opportunityId,
      last_error: errors.fields,
      incrementAttempts: true,
    });
    await writeSyncLog(admin, {
      direction: "app_to_ghl",
      trigger_event: "estimate_push_fields",
      action_taken: "error",
      status: "error",
      error_message: errors.fields,
      payload_in: { estimateId: estimate.id, estimateNumber: estimate.estimate_number, version: estimate.version },
    });
  }

  // Review finding 2a: the doc target is gated SOLELY on decideDocPreflight
  // (contact-id presence, Path B, email/phone) — never on `fieldsResult`.
  // A fields-target failure that happened AFTER a contact id was already
  // resolved (e.g. the opportunity write itself 500ing) must not block a
  // doc push that has everything it needs. pushDocTarget never touches the
  // opportunity, only the contact, so the two targets are genuinely
  // independent here, not just independently try/caught.
  const preflight = decideDocPreflight({
    isPathB,
    hasContactId: contactId !== null,
    contactEmail: estimate.client_email,
    contactPhone: estimate.client_phone,
  });

  let docResult: PushResult["doc"];

  if (!preflight.proceed) {
    docResult = preflight.reason;
  } else if (!contactId) {
    // Structurally unreachable — preflight.proceed already required
    // hasContactId. Kept as an explicit TS narrowing guard rather than a
    // cast, so this can never silently push a doc with a null contactId
    // even if decideDocPreflight's contract changes later.
    docResult = "skipped_missing_contact";
  } else {
    try {
      const docOut = await pushDocTarget(estimate, lineItems, contactId, priorDocId);
      docResult = "ok";
      await upsertPushState(admin, estimate.id, {
        ghl_estimate_id: docOut.docId,
        ghl_estimate_number: docOut.docNumber,
        doc_pushed_at: nowIso(),
        last_error: null,
      });
      await writeSyncLog(admin, {
        direction: "app_to_ghl",
        trigger_event: "estimate_push_doc",
        action_taken: docOut.action === "replace" ? "updated" : "created",
        status: "success",
        payload_in: { estimateId: estimate.id, docAction: docOut.action },
      });
    } catch (err) {
      if (err instanceof GhlApiError && (err.status === 401 || err.status === 403)) {
        docResult = "not_configured";
        await writeSyncLog(admin, {
          direction: "app_to_ghl",
          trigger_event: "estimate_push_doc",
          action_taken: "skipped",
          status: "success",
          error_message: errorMessage(err),
          payload_in: { estimateId: estimate.id, reason: "not_configured" },
        });
      } else {
        docResult = "error";
        errors.doc = errorMessage(err);
        await upsertPushState(admin, estimate.id, { last_error: errors.doc, incrementAttempts: true });
        await writeSyncLog(admin, {
          direction: "app_to_ghl",
          trigger_event: "estimate_push_doc",
          action_taken: "error",
          status: "error",
          error_message: errors.doc,
          payload_in: { estimateId: estimate.id },
        });
      }
    }
  }

  // Review finding 2b: this is now the ONLY place either skip reason is
  // logged, and it runs unconditionally — regardless of whether the skip
  // came from the pure preflight or the defensive narrowing guard above —
  // so every docResult value (ok / not_configured / error already log
  // inside their own branch above; skipped_path_b / skipped_missing_contact
  // log here) writes exactly one sync_log row for the doc target. Nothing
  // upstream of this point may `return` early — that would reintroduce the
  // "no sync_log row" gap this fixes.
  if (docResult === "skipped_path_b" || docResult === "skipped_missing_contact") {
    await writeSyncLog(admin, {
      direction: "app_to_ghl",
      trigger_event: "estimate_push_doc",
      action_taken: "skipped",
      status: "success",
      payload_in: { estimateId: estimate.id, reason: docResult },
    });
  }

  return {
    fields: fieldsResult,
    doc: docResult,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}
