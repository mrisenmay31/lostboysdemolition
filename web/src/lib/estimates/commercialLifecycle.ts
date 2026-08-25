import "server-only";

// ============================================================
// Lost Boys Demolition — web app — estimate commercial lifecycle
// (Phase 1, v2 Task 2 / profitability v2 Phase 1 Session 2, lane 2d)
//
// The three spec-verbatim server interfaces (v2 doc lines 942-970,
// docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md)
// plus the supporting identity-link and scheduling-eligibility helpers the
// plan's Step 6 / review handoffs require:
//
//   presentEstimate(estimateId, presentedByName)   — Estimate in Progress -> Quote Sent
//   recordEstimateAcceptance(input)                — -> Quote Accepted
//   reverseEstimateAcceptance(input)                — -> Quote Sent | Closed Lost (Declined)
//   linkEstimateIdentity(input)                     — persists estimate_number <-> GHL identity
//   isSchedulingEligible(state, estimateId)          — pure; Task 4 (later) consumes this
//   resolveAcceptancePresentation(state, estimateId) — pure; fix round F3, feeds CommercialLifecyclePanel
//
// ONE DELIBERATE DEVIATION from the v2 doc's literal `presentEstimate(estimateId: string):
// Promise<void>` signature: `estimate_presentations.presented_by_name` is
// NOT NULL, and there is no login in this app to source an authenticated
// actor from (see CLAUDE.md "No-login estimate tool") — every other
// actor-touching function in this codebase (updateStatus, updateQuote,
// recordEstimateAcceptance/reverseEstimateAcceptance themselves) takes the
// picker-declared name explicitly. `presentEstimate` here takes a required
// second `presentedByName` argument for the same reason. Flagged in the
// lane 2d report as "beyond the brief."
//
// FIX ROUND (Session 2 lane 2d, 2026-08-19) — SECOND DEVIATION from the v2
// doc's literal `Promise<void>` signatures: all three of presentEstimate/
// recordEstimateAcceptance/reverseEstimateAcceptance now return
// `Promise<LifecycleActionOutcome>` (`{ warning?: string }`), not
// `Promise<void>`. F2 made a failed GHL stage move non-fatal to the DB
// write it follows — the DB write is durable either way, but the caller
// still needs to know the GHL side may have drifted, hence the warning
// channel. See each function's own "FIX ROUND F1" / "FIX ROUND F2" doc
// comments for the per-function guard/residual details, and F7 below
// recordEstimateAcceptance for its extra already-accepted guard.
//
// SNAPSHOT HASH RECIPE (presentEstimate): sha256, hex-encoded, over the
// JSON.stringify of a plain object with recursively KEY-SORTED properties
// (buildPresentationSnapshot + canonicalJson below), covering exactly the
// customer-facing content of one estimate VERSION:
//   - the estimate row's pricing/scope fields (job/client identity, labor
//     method + hours/days/employees, dump count, job-specific costs,
//     markup %, the full engine output set, quoted_price, is_path_b) —
//     NOT id/created_at/created_by/created_by_name/status (metadata, not
//     what a customer is shown)
//   - every line item (name, description, labor_hours, dump_count,
//     materials_cost, sort_order), sorted by sort_order
//   - the financial-details row's 15 economic fields, if one exists (it
//     always does for a v2-created row) — included because the snapshot
//     is meant to prove "this exact economic plan, not just this exact
//     price, was on record at presentation time"
// Recursive key-sorting means the hash is deterministic regardless of
// object construction/property-insertion order, so it never depends on a
// future field reordering in this file or on Postgres's column order.
// Since `estimates`/`estimate_line_items`/`estimate_financial_details` are
// all immutable-by-trigger once written, re-presenting the SAME version
// always reproduces the SAME hash — which is exactly why the presentations
// insert below is `on conflict (estimate_id) do nothing` (handoff #4)
// rather than an error: a retried "Present" click after a transient
// network blip is a no-op, not a failure.
//
// GHL STAGE ASSERTION (handoff #3): every stage-moving call in this file
// goes through `assertOpportunityInJobPipeline`, which THROWS if the
// linked opportunity's `pipelineId` doesn't match the resolved "Job
// Pipeline" id — a query-string-supplied `ghlOpportunityId` (the GHL-first
// entry point) could in principle name an opportunity living in a
// different GHL pipeline entirely, and writing a Job-Pipeline stage id
// onto that opportunity would be silently wrong, not just unusual. This
// throws rather than skips (unlike the "stage move only if in Job
// Pipeline" wording elsewhere in the v2 doc, which describes the same
// situation more casually) because every opportunity this file ever links
// or moves is expected, by construction, to be a Job Pipeline opportunity
// — a mismatch here is either a caller bug or a malformed query param, and
// both deserve a loud failure over a silent no-op.
//
// Handoff #7 (fix round, Session 2 lane 2d): this assertion is not
// defensive-programming boilerplate — it is LIVE-VERIFIED load-bearing.
// The 12 `JOB_PIPELINE_STAGE_NAMES` in @/lib/ghl/pipeline.ts were dumped
// from the real GHL API 2026-08-19 (ghl-job-webhook [startup] "Job
// Pipeline stages" log, pipeline id `OMDtCf2eHWQ1GQrEcJA1`), and all four
// stage needles this file's stage moves resolve against ("estimate in
// progress", "quote sent", "quote accepted", "closed lost") were confirmed
// to resolve UNIQUELY against that live list. Critically, the same GHL
// location has a SECOND pipeline ("Contractor Pipeline") that ALSO
// contains a stage literally named "Job Scheduled" — proof that a stage
// NAME match alone can be ambiguous across pipelines, so knowing a
// resolved stage id belongs to the "Job Pipeline" specifically (this
// assertion's whole job) is a real correctness requirement, not a
// hypothetical. Fix round F2 (below) makes a failed stage MOVE non-fatal
// to the DB write it follows, but this pipeline-membership check itself
// stays a hard throw — the two are orthogonal: F2 tolerates GHL being
// unreachable, this assertion refuses to write a stage id onto the wrong
// pipeline even when GHL answers successfully.
// ============================================================

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEstimate, updateStatus } from "./repo";
import { isValidEstimateId } from "./ids";
import { isUniqueViolationError } from "./errors";
import { resolveJobPipelineStages } from "@/lib/ghl/pipeline";
import { createContact, createOpportunity, getOpportunity, updateOpportunityStage } from "@/lib/ghl/client";
import type { EstimateIdentitySelection } from "@/lib/ghl/prefill";
import type {
  EstimateAcceptanceStateRow,
  EstimateDetail,
  EstimateIdentityLinkRow,
  EstimateLineItemRow,
} from "./types";

// ── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when a GHL opportunity linked to an estimate family turns out
 *  not to live in the "Job Pipeline" — see the header comment's "GHL STAGE
 *  ASSERTION" section (handoff #3). */
export class OpportunityPipelineMismatchError extends Error {
  constructor(opportunityId: string, actualPipelineId: string | undefined, expectedPipelineId: string) {
    super(
      `GHL opportunity ${opportunityId} is not in the "Job Pipeline" ` +
        `(pipelineId=${actualPipelineId ?? "unknown"}, expected ${expectedPipelineId}) — refusing to move its stage.`,
    );
    this.name = "OpportunityPipelineMismatchError";
  }
}

/** Thrown when `estimate_identity_links`' `ghl_opportunity_id` unique
 *  constraint is violated — a second estimate family tried to claim an
 *  opportunity another family already linked (handoff D: "surface a
 *  conflict as an error naming the other family"). */
export class EstimateIdentityConflictError extends Error {
  conflictingEstimateNumber: number | null;
  constructor(ghlOpportunityId: string, conflictingEstimateNumber: number | null) {
    super(
      `GHL opportunity ${ghlOpportunityId} is already linked to estimate family ` +
        `${conflictingEstimateNumber ?? "(unknown)"} — one opportunity can only link to one active estimate family.`,
    );
    this.name = "EstimateIdentityConflictError";
    this.conflictingEstimateNumber = conflictingEstimateNumber;
  }
}

/** Classification of a `record_estimate_acceptance_event` RPC failure —
 *  see classifyAcceptanceEventError below. Callers (server actions) must
 *  handle these deliberately (handoff #5): never blindly retry a
 *  'no_active_acceptance' or 'wrong_version' failure, since a retry of the
 *  exact same call will raise again by design (the RPC guards these
 *  states on purpose, not transiently). */
export type AcceptanceEventErrorCode =
  | "no_active_acceptance"
  | "wrong_version"
  | "not_presented"
  | "superseded"
  | "already_accepted"
  | "other";

export class RecordAcceptanceEventError extends Error {
  code: AcceptanceEventErrorCode;
  constructor(message: string, code: AcceptanceEventErrorCode) {
    super(message);
    this.name = "RecordAcceptanceEventError";
    this.code = code;
  }
}

/** Exported for direct unit testing of the classification rules — see the
 *  module header's handoff #5 note. Not otherwise called outside this
 *  file. */
export function classifyAcceptanceEventError(message: string): AcceptanceEventErrorCode {
  if (message.includes("no active acceptance to reverse")) return "no_active_acceptance";
  if (message.includes("is not the accepted version")) return "wrong_version";
  if (message.includes("has not been presented")) return "not_presented";
  if (message.includes("is superseded")) return "superseded";
  return "other";
}

// ── Snapshot hash (presentEstimate) ─────────────────────────────────────────

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Canonical, deterministic JSON string — recursively key-sorted so the
 *  hash never depends on property-insertion order. Exported for the test
 *  file to reproduce the exact recipe without duplicating it. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** Builds the plain object presentEstimate hashes — see the module header
 *  comment's "SNAPSHOT HASH RECIPE" for the exact field list and
 *  rationale. Exported for the test file. */
export function buildPresentationSnapshot(
  detail: Pick<EstimateDetail, "estimate" | "lineItems" | "financialDetails">,
): Record<string, unknown> {
  const { estimate, lineItems, financialDetails } = detail;
  return {
    estimate: {
      estimate_number: estimate.estimate_number,
      version: estimate.version,
      job_name: estimate.job_name,
      client_name: estimate.client_name,
      client_type: estimate.client_type,
      client_email: estimate.client_email,
      client_phone: estimate.client_phone,
      job_address: estimate.job_address,
      city: estimate.city,
      job_type: estimate.job_type,
      job_details: estimate.job_details,
      labor_method: estimate.labor_method,
      total_job_hours: estimate.total_job_hours,
      days_at_job: estimate.days_at_job,
      num_employees: estimate.num_employees,
      dump_count: estimate.dump_count,
      job_specific_costs: estimate.job_specific_costs,
      markup_pct: estimate.markup_pct,
      labor_rate: estimate.labor_rate,
      overhead_rate: estimate.overhead_rate,
      dump_rate: estimate.dump_rate,
      cc_fee_rate: estimate.cc_fee_rate,
      labor_cost: estimate.labor_cost,
      dump_fees: estimate.dump_fees,
      total_direct: estimate.total_direct,
      overhead: estimate.overhead,
      profit: estimate.profit,
      cc_fee: estimate.cc_fee,
      total_bid: estimate.total_bid,
      true_margin_pct: estimate.true_margin_pct,
      quoted_price: estimate.quoted_price,
      is_path_b: estimate.is_path_b,
    },
    lineItems: lineItems
      .slice()
      .sort((a: EstimateLineItemRow, b: EstimateLineItemRow) => a.sort_order - b.sort_order)
      .map((li) => ({
        name: li.name,
        description: li.description,
        labor_hours: li.labor_hours,
        dump_count: li.dump_count,
        materials_cost: li.materials_cost,
        sort_order: li.sort_order,
      })),
    financialDetails: financialDetails
      ? {
          formula_version: financialDetails.formula_version,
          productive_hours: financialDetails.productive_hours,
          operational_labor_cost: financialDetails.operational_labor_cost,
          materials_cost: financialDetails.materials_cost,
          rentals_cost: financialDetails.rentals_cost,
          expected_dump_cost: financialDetails.expected_dump_cost,
          subcontractors_cost: financialDetails.subcontractors_cost,
          other_direct_cost: financialDetails.other_direct_cost,
          allocated_overhead: financialDetails.allocated_overhead,
          expected_processing_cost: financialDetails.expected_processing_cost,
          risk_pricing_allowance: financialDetails.risk_pricing_allowance,
          markup_amount: financialDetails.markup_amount,
          processing_pricing_allowance: financialDetails.processing_pricing_allowance,
          discount_amount: financialDetails.discount_amount,
          customer_price: financialDetails.customer_price,
          planned_economic_profit: financialDetails.planned_economic_profit,
          planned_profit_pct: financialDetails.planned_profit_pct,
        }
      : null,
  };
}

function computeSnapshotHash(detail: Pick<EstimateDetail, "estimate" | "lineItems" | "financialDetails">): string {
  return createHash("sha256").update(canonicalJson(buildPresentationSnapshot(detail))).digest("hex");
}

// ── Shared identity-link + stage-move plumbing ──────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

async function resolveEstimateNumber(admin: AdminClient, estimateId: string): Promise<number> {
  const { data, error } = await admin.from("estimates").select("estimate_number").eq("id", estimateId).single();
  if (error || !data) {
    throw new Error(`commercialLifecycle: estimate ${estimateId} not found: ${error?.message ?? "no row"}`);
  }
  return Number(data.estimate_number);
}

async function findIdentityLink(admin: AdminClient, estimateNumber: number): Promise<EstimateIdentityLinkRow | null> {
  const { data, error } = await admin
    .from("estimate_identity_links")
    .select("*")
    .eq("estimate_number", estimateNumber)
    .maybeSingle();
  if (error) {
    throw new Error(`commercialLifecycle: estimate_identity_links lookup failed: ${error.message}`);
  }
  return (data ?? null) as EstimateIdentityLinkRow | null;
}

/** Handoff #3: throws OpportunityPipelineMismatchError if the opportunity
 *  isn't in `expectedPipelineId` — see the module header comment. Otherwise
 *  moves it to `stageId`. Takes the caller's already-resolved pipeline id
 *  rather than re-resolving it (resolveJobPipelineStages() IS cached
 *  per-process, so a second call would be free, but every caller below
 *  already has the resolved `stages` object in scope by the time it needs
 *  this — passing it through is simpler than relying on cache behavior). */
async function assertOpportunityInJobPipelineAndMoveStage(
  ghlOpportunityId: string,
  stageId: string,
  expectedPipelineId: string,
): Promise<void> {
  const opportunity = await getOpportunity(ghlOpportunityId);
  if (opportunity.pipelineId !== expectedPipelineId) {
    throw new OpportunityPipelineMismatchError(ghlOpportunityId, opportunity.pipelineId, expectedPipelineId);
  }
  await updateOpportunityStage(ghlOpportunityId, stageId);
}

// ── linkEstimateIdentity ─────────────────────────────────────────────────

export interface ContactCreationFields {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface LinkEstimateIdentityInput {
  estimateId: string;
  selection: EstimateIdentitySelection;
  linkedByName: string;
  /** Required when `selection.createContact` is true. */
  contactFields?: ContactCreationFields;
  /** Required when `selection.createOpportunity` is true. */
  opportunityName?: string;
}

/**
 * Persists the app-first / GHL-first identity decision to
 * `estimate_identity_links` (upsert by estimate_number — a family may
 * correct its link, e.g. after picking the wrong candidate), creating a
 * GHL contact and/or opportunity first when the selection asks for it
 * (`createContact`/`createOpportunity` — "require explicit ... selection
 * or creation. Never silently merge", v2 doc). Ensures the linked
 * opportunity sits at "Estimate in Progress" (handoff #3's assertion, not
 * a silent skip — see module header).
 *
 * The `ghl_opportunity_id` UNIQUE constraint means a second family cannot
 * silently steal an opportunity another family already linked — that
 * violation surfaces as EstimateIdentityConflictError, naming the other
 * family, rather than a raw Postgres constraint-violation string.
 */
export async function linkEstimateIdentity(input: LinkEstimateIdentityInput): Promise<EstimateIdentityLinkRow> {
  if (!isValidEstimateId(input.estimateId)) {
    throw new Error(`linkEstimateIdentity: invalid estimate id ${input.estimateId}`);
  }

  const admin = createAdminClient();
  const estimateNumber = await resolveEstimateNumber(admin, input.estimateId);

  let ghlContactId = input.selection.ghlContactId;
  if (input.selection.createContact) {
    const fields = input.contactFields ?? {};
    ghlContactId = await createContact({
      firstName: fields.firstName ?? undefined,
      lastName: fields.lastName ?? undefined,
      companyName: fields.companyName ?? undefined,
      email: fields.email ?? undefined,
      phone: fields.phone ?? undefined,
      address1: fields.address1 ?? undefined,
      city: fields.city ?? undefined,
      state: fields.state ?? undefined,
      postalCode: fields.postalCode ?? undefined,
    });
  }
  if (!ghlContactId) {
    throw new Error("linkEstimateIdentity: no ghlContactId resolved (neither selected nor created)");
  }

  const stages = await resolveJobPipelineStages();

  let ghlOpportunityId = input.selection.ghlOpportunityId;
  if (input.selection.createOpportunity) {
    ghlOpportunityId = await createOpportunity({
      name: input.opportunityName ?? "New estimate",
      status: "open",
      contactId: ghlContactId,
      pipelineId: stages.pipelineId,
      pipelineStageId: stages.estimateInProgressStageId,
    });
  }
  if (!ghlOpportunityId) {
    throw new Error("linkEstimateIdentity: no ghlOpportunityId resolved (neither selected nor created)");
  }

  const { data, error } = await admin
    .from("estimate_identity_links")
    .upsert(
      {
        estimate_number: estimateNumber,
        ghl_contact_id: ghlContactId,
        ghl_opportunity_id: ghlOpportunityId,
        linked_by_name: input.linkedByName,
        actor_assurance: "selected_identity",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "estimate_number" },
    )
    .select()
    .single();

  if (error) {
    if (isUniqueViolationError(error)) {
      const { data: conflicting } = await admin
        .from("estimate_identity_links")
        .select("estimate_number")
        .eq("ghl_opportunity_id", ghlOpportunityId)
        .maybeSingle();
      throw new EstimateIdentityConflictError(
        ghlOpportunityId,
        conflicting ? Number(conflicting.estimate_number) : null,
      );
    }
    throw new Error(`linkEstimateIdentity: estimate_identity_links upsert failed: ${error.message}`);
  }

  // Unconditional for both paths: a freshly created opportunity is already
  // at Estimate in Progress (createOpportunity above set that stage
  // explicitly), so this is a harmless same-value PUT in that case; a
  // SELECTED (pre-existing) opportunity may be anywhere, so this call is
  // what actually satisfies "creating the first saved estimate for a
  // linked opportunity ensures it sits at Estimate in Progress."
  await assertOpportunityInJobPipelineAndMoveStage(ghlOpportunityId, stages.estimateInProgressStageId, stages.pipelineId);

  return data as EstimateIdentityLinkRow;
}

// ── presentEstimate ────────────────────────────────────────────────────────

/** Returned by presentEstimate/recordEstimateAcceptance/reverseEstimateAcceptance
 *  (fix round F2). `warning` is set ONLY when the DB write(s) that make the
 *  action durable already succeeded but the follow-on GHL stage move
 *  failed — the caller (actions.ts) surfaces it as a non-blocking notice,
 *  never as a rejected action, since the commercial record itself is
 *  correct either way. Absent (not merely undefined-valued) on full
 *  success, matching the house `linkWarning` shape in actions.ts's
 *  `createEstimateAction`. */
export interface LifecycleActionOutcome {
  warning?: string;
}

/**
 * Estimate in Progress -> Quote Sent. Records an immutable presentation
 * snapshot (on-conflict-do-nothing per handoff #4 — presenting an
 * already-presented version is idempotent, not an error), then moves the
 * linked GHL opportunity's stage (skipped, not failed, when no identity
 * link exists yet — an estimate can be legitimately presented in some
 * other channel before ever being linked to GHL), and mirrors the
 * transition onto `estimates.status` via the existing `update_estimate_status`
 * RPC so status never silently drifts from the acceptance-lifecycle
 * projection.
 *
 * `presentedByName` — see the module header's "ONE DELIBERATE DEVIATION"
 * note: not part of the v2 doc's literal signature, added because
 * `estimate_presentations.presented_by_name` is NOT NULL and there is no
 * login to source it from otherwise.
 *
 * FIX ROUND F1 (BLOCKER): refuses a superseded version immediately after
 * fetching its detail, BEFORE any write — a stale browser tab left open
 * from before a `revise` must never be able to write a presentation row
 * (and, downstream, an acceptance) for a version that is no longer the
 * one anyone should be quoting from.
 *
 * FIX ROUND (whole-branch review): also refuses to present ANY version
 * while the family already has an active acceptance
 * (`estimate_acceptance_state.accepted`) — mirrors
 * `recordEstimateAcceptance`'s F7 guard exactly (same query, same
 * `already_accepted` code). Without this, a stale tab on a revised
 * version could move an already-accepted family's GHL opportunity from
 * "Quote Accepted" back to "Quote Sent" and overwrite `estimates.status
 * = 'accepted'` with `'sent'`, breaking the status<->acceptance-state
 * mirror invariant this module's presentEstimate/recordEstimateAcceptance/
 * reverseEstimateAcceptance are all meant to jointly preserve. Reversing
 * the active acceptance first clears this guard, same as it does for F7.
 *
 * FIX ROUND F2: the GHL stage move is now non-fatal. Order is: DB write
 * (estimate_presentations, immutable) -> GHL move (try/catch) ->
 * updateStatus. A GHL-only failure never strands the DB mirror out of
 * sync with `estimates.status` — updateStatus still runs — and is
 * surfaced as `{ warning }` instead of a thrown error. Residual: since
 * `estimate_presentations` is unique-per-version and this insert is
 * on-conflict-do-nothing, re-invoking presentEstimate for the SAME
 * version safely retries only the stage move (the insert becomes a no-op,
 * updateStatus is idempotent) — but the detail page's "Mark as presented"
 * button hides itself the instant `presentation` is non-null, so there is
 * currently no in-app retry affordance once this warning fires; a manual
 * GHL stage move (or a future dedicated retry action) is the real fix
 * path. The PushPanel's "push to GHL" button does NOT help here — it
 * moves the opportunity to "Estimate in Progress", a different stage
 * entirely, and would actively regress a successful Quote Sent move.
 */
export async function presentEstimate(estimateId: string, presentedByName: string): Promise<LifecycleActionOutcome> {
  if (!isValidEstimateId(estimateId)) {
    throw new Error(`presentEstimate: invalid estimate id ${estimateId}`);
  }

  const admin = createAdminClient();
  const detail = await getEstimate(estimateId);

  if (detail.estimate.status === "superseded") {
    throw new Error(`presentEstimate: estimate ${estimateId} is superseded — use the current version.`);
  }

  // FIX ROUND (whole-branch review): symmetric with recordEstimateAcceptance's
  // F7 guard — see this function's doc comment. A family with an active
  // acceptance must be reversed before any version can be (re-)presented.
  const { data: existingState, error: existingStateError } = await admin
    .from("estimate_acceptance_state")
    .select("accepted")
    .eq("estimate_number", detail.estimate.estimate_number)
    .maybeSingle();
  if (existingStateError) {
    throw new Error(`presentEstimate: estimate_acceptance_state check failed: ${existingStateError.message}`);
  }
  if (existingState?.accepted) {
    throw new RecordAcceptanceEventError(
      `presentEstimate: estimate family ${detail.estimate.estimate_number} has an active acceptance — reverse it ` +
        "before presenting a new version.",
      "already_accepted",
    );
  }

  const hash = computeSnapshotHash(detail);

  const { error: presentError } = await admin.from("estimate_presentations").upsert(
    {
      estimate_id: estimateId,
      presented_via: "ghl",
      presented_by_name: presentedByName,
      actor_assurance: "selected_identity",
      snapshot_hash: hash,
    },
    { onConflict: "estimate_id", ignoreDuplicates: true },
  );
  if (presentError) {
    throw new Error(`presentEstimate: estimate_presentations insert failed: ${presentError.message}`);
  }

  let warning: string | undefined;
  const link = await findIdentityLink(admin, detail.estimate.estimate_number);
  if (link) {
    // FIX ROUND (whole-branch review): resolveJobPipelineStages() moved
    // INSIDE this try — a resolution failure (e.g. cold cache + GHL
    // unreachable) must degrade the same non-fatal way a stage-MOVE
    // failure does, not throw fatally after the durable DB write above
    // already succeeded. See the matching notes on recordEstimateAcceptance
    // and reverseEstimateAcceptance.
    try {
      const stages = await resolveJobPipelineStages();
      await assertOpportunityInJobPipelineAndMoveStage(link.ghl_opportunity_id, stages.quoteSentStageId, stages.pipelineId);
    } catch (err) {
      // Handoff #7 (module header): a wrong-pipeline mismatch is a
      // correctness bug (or a malformed query param), never a transient
      // GHL outage — F2's non-fatal handling below is for network/API
      // failures ONLY, so this must re-throw rather than be swallowed
      // into a warning.
      if (err instanceof OpportunityPipelineMismatchError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[commercialLifecycle] presentEstimate: GHL stage move to Quote Sent failed for estimate family ` +
          `${detail.estimate.estimate_number} (presentation was still recorded):`,
        err,
      );
      warning = `Presentation recorded, but moving the GHL opportunity to "Quote Sent" failed: ${message}`;
    }
  } else {
    console.warn(
      `[commercialLifecycle] presentEstimate: estimate family ${detail.estimate.estimate_number} has no ` +
        "GHL identity link yet — presentation recorded, but no GHL stage move happened.",
    );
  }

  await updateStatus(estimateId, "sent", { id: null, name: presentedByName });
  return warning ? { warning } : {};
}

// ── recordEstimateAcceptance ─────────────────────────────────────────────

export interface RecordAcceptanceInput {
  estimateId: string;
  method: "signature" | "email" | "text" | "verbal" | "other";
  customerContactName: string;
  effectiveAt: string;
  recordedByName: string;
  note: string;
  evidencePaths: string[];
}

/**
 * -> Quote Accepted. Calls `record_estimate_acceptance_event` (which pins
 * `accepted_price` server-side, inside its own row lock — deviation 12;
 * this function never computes or sends a price), then moves the linked
 * GHL opportunity's stage and mirrors `estimates.status = 'accepted'`.
 *
 * Throws RecordAcceptanceEventError (never a bare Error) on any RPC-level
 * rejection, classified per `classifyAcceptanceEventError` — see handoff
 * #5 in the module header. The two app-side guards below (F1, F7) also
 * throw RecordAcceptanceEventError, with their own explicit codes, rather
 * than a bare Error — same "callers must handle these deliberately"
 * contract the RPC-raised codes already carry.
 *
 * FIX ROUND F1 (BLOCKER): fetches the estimate detail first and refuses a
 * superseded version immediately — see presentEstimate's matching doc
 * comment for the stale-tab scenario this closes. This was the more
 * severe half of the finding: accepting a superseded version pins its
 * (wrong, stale) price into the immutable `estimate_acceptance_events`
 * row, and — before this fix — flipped `estimates.status` from
 * 'superseded' back to 'accepted', DISARMING the DB's own
 * superseded-acceptance guard for that row (which keys off `status`).
 *
 * FIX ROUND F7 (MINOR): also refuses to record a new acceptance for a
 * family that already has one active (`estimate_acceptance_state.accepted`)
 * — mirrors `repo.ts`'s `updateQuote` guard pattern. Without this, a
 * double-click or a retried request after a slow/ambiguous response could
 * fire a second 'accepted' event for the same family, a phantom duplicate
 * in the acceptance audit trail. The RPC's own version/state checks catch
 * many related cases, but not this exact one (a second `estimateId` ===
 * `current_estimate_id` accept can otherwise re-succeed).
 *
 * FIX ROUND F2: the GHL stage move is now non-fatal — see presentEstimate's
 * matching doc comment for the general pattern. Residual specific to this
 * function: once the RPC above has recorded the acceptance, F7's own
 * guard means the SAME action can no longer be re-invoked to retry a
 * failed stage move (it will refuse as "already accepted"), and the
 * PushPanel's re-push targets "Estimate in Progress", not "Quote
 * Accepted". A GHL-lag warning from this function therefore has NO
 * automatic in-app healing path today — it requires a manual GHL stage
 * move (or reversing and re-accepting, which is a legitimate but heavier
 * workaround). Flagged for BUILD_LOG as an accepted low-risk limitation
 * at 3 users, not fixed this round.
 */
export async function recordEstimateAcceptance(input: RecordAcceptanceInput): Promise<LifecycleActionOutcome> {
  if (!isValidEstimateId(input.estimateId)) {
    throw new Error(`recordEstimateAcceptance: invalid estimate id ${input.estimateId}`);
  }

  const admin = createAdminClient();
  const detail = await getEstimate(input.estimateId);

  if (detail.estimate.status === "superseded") {
    // D2 (re-review fix): typed error with its own code, matching this
    // function's documented error contract (a future caller branching on
    // err.code must be able to see this guard, not just F7's).
    throw new RecordAcceptanceEventError(
      `recordEstimateAcceptance: estimate ${input.estimateId} is superseded — use the current version.`,
      "superseded",
    );
  }

  const estimateNumber = detail.estimate.estimate_number;

  const { data: existingState, error: existingStateError } = await admin
    .from("estimate_acceptance_state")
    .select("accepted")
    .eq("estimate_number", estimateNumber)
    .maybeSingle();
  if (existingStateError) {
    throw new Error(`recordEstimateAcceptance: estimate_acceptance_state check failed: ${existingStateError.message}`);
  }
  if (existingState?.accepted) {
    throw new RecordAcceptanceEventError(
      `recordEstimateAcceptance: estimate family ${estimateNumber} already has an active acceptance — reverse it ` +
        "first before recording a new one.",
      "already_accepted",
    );
  }

  const { error } = await admin.rpc("record_estimate_acceptance_event", {
    p_event: {
      estimate_id: input.estimateId,
      action: "accepted",
      authorization_method: input.method,
      customer_contact_name: input.customerContactName,
      effective_at: input.effectiveAt,
      recorded_by_name: input.recordedByName,
      actor_assurance: "selected_identity",
      note: input.note,
      evidence_paths: input.evidencePaths,
    },
  });

  if (error) {
    throw new RecordAcceptanceEventError(error.message, classifyAcceptanceEventError(error.message));
  }

  let warning: string | undefined;
  const link = await findIdentityLink(admin, estimateNumber);
  if (link) {
    // FIX ROUND (whole-branch review): resolveJobPipelineStages() moved
    // INSIDE this try — see presentEstimate's matching note.
    try {
      const stages = await resolveJobPipelineStages();
      await assertOpportunityInJobPipelineAndMoveStage(link.ghl_opportunity_id, stages.quoteAcceptedStageId, stages.pipelineId);
    } catch (err) {
      // See presentEstimate's matching catch block — a wrong-pipeline
      // mismatch is a correctness bug, not a transient failure, and must
      // re-throw rather than be swallowed into a warning.
      if (err instanceof OpportunityPipelineMismatchError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[commercialLifecycle] recordEstimateAcceptance: GHL stage move to Quote Accepted failed for estimate ` +
          `family ${estimateNumber} (acceptance was still recorded):`,
        err,
      );
      warning = `Acceptance recorded, but moving the GHL opportunity to "Quote Accepted" failed: ${message}`;
    }
  } else {
    console.warn(
      `[commercialLifecycle] recordEstimateAcceptance: estimate family ${estimateNumber} has no GHL identity ` +
        "link — acceptance recorded, but no GHL stage move happened.",
    );
  }

  await updateStatus(input.estimateId, "accepted", { id: null, name: input.recordedByName });
  return warning ? { warning } : {};
}

// ── reverseEstimateAcceptance ────────────────────────────────────────────

export interface ReverseAcceptanceInput {
  estimateId: string;
  destination: "quote_sent" | "closed_lost";
  reason: string;
  recordedByName: string;
}

/**
 * Reverses the currently-accepted version's acceptance, moving the linked
 * GHL opportunity to `destination` and mirroring `estimates.status` to
 * 'sent' (quote_sent) or 'declined' (closed_lost). Never retries — see
 * handoff #5: the RPC's "no active acceptance to reverse" / "not the
 * accepted version" raises are real, permanent guard conditions (a
 * double-reverse, or a reversal aimed at a superseded version), not
 * transient failures, so this function surfaces them as a classified
 * RecordAcceptanceEventError for the caller to show, never loops or
 * re-issues the call itself.
 *
 * FIX ROUND F1 (BLOCKER) + F3: deliberately does NOT guard on
 * `estimates.status === 'superseded'` the way presentEstimate/
 * recordEstimateAcceptance do — the version that's legitimately reversible
 * routinely CARRIES that status. The writer contract flips a version to
 * 'superseded' the instant its successor is created (see
 * `[id]/page.tsx`'s matching comment), so an accepted v1 becomes
 * 'superseded' the moment someone revises to v2 — even though v1 is still
 * the family's one actionable acceptance. Guarding on `status` here would
 * make an accepted-then-revised family's acceptance permanently
 * unreversible from the app. Instead this guards on the TARGET: the
 * `estimateId` being reversed must equal the family's
 * `estimate_acceptance_state.current_estimate_id` — i.e. it must be the
 * version any acceptance activity is actually centered on, whatever its
 * own `status` says. `CommercialLifecyclePanel`'s Reverse control (F3)
 * always passes `current_estimate_id` as the target for exactly this
 * reason, so in normal operation this check is a redundant, cheap,
 * fail-fast echo of what the RPC itself would enforce (per handoff #5,
 * "the RPC already enforces this") — it exists to fail BEFORE the
 * RPC/mutation for a caller that gets the target wrong, not to add a new
 * rule the RPC doesn't already have. When the family has never had an
 * acceptance event at all (no `estimate_acceptance_state` row), this
 * check is skipped entirely and the RPC's own "no active acceptance to
 * reverse" is what surfaces — that message is more specific than anything
 * this app-side check could say about a family with no history yet.
 *
 * FIX ROUND F2: the GHL stage move is now non-fatal — see presentEstimate's
 * matching doc comment for the general pattern. Residual specific to this
 * function: once the RPC above has recorded the reversal, the family's
 * `accepted` flips false, so re-invoking THIS SAME reverse call again will
 * raise "no active acceptance to reverse" rather than retry the stage
 * move — no automatic in-app healing path (same limitation as
 * recordEstimateAcceptance's F2 residual, and for the same reason: the
 * PushPanel targets a different stage entirely). A manual GHL stage move
 * is the real fix path.
 */
export async function reverseEstimateAcceptance(input: ReverseAcceptanceInput): Promise<LifecycleActionOutcome> {
  if (!isValidEstimateId(input.estimateId)) {
    throw new Error(`reverseEstimateAcceptance: invalid estimate id ${input.estimateId}`);
  }

  const admin = createAdminClient();
  // D1 (re-review fix): widened from resolveEstimateNumber() to also read
  // status — the reversal target is ROUTINELY 'superseded' (accepted v1,
  // then revised to v2), and the status mirror at the bottom of this
  // function must know that so it never clears the marker.
  const { data: targetRow, error: targetError } = await admin
    .from("estimates")
    .select("estimate_number, status")
    .eq("id", input.estimateId)
    .single();
  if (targetError || !targetRow) {
    throw new Error(
      `reverseEstimateAcceptance: estimate ${input.estimateId} not found: ${targetError?.message ?? "no row"}`,
    );
  }
  const estimateNumber = Number(targetRow.estimate_number);
  const targetStatus = String(targetRow.status);

  const { data: state, error: stateError } = await admin
    .from("estimate_acceptance_state")
    .select("current_estimate_id")
    .eq("estimate_number", estimateNumber)
    .maybeSingle();
  if (stateError) {
    throw new Error(`reverseEstimateAcceptance: estimate_acceptance_state lookup failed: ${stateError.message}`);
  }
  if (state && state.current_estimate_id !== input.estimateId) {
    throw new RecordAcceptanceEventError(
      `reverseEstimateAcceptance: estimate ${input.estimateId} is not the currently accepted version for family ` +
        `${estimateNumber} (accepted version is ${state.current_estimate_id}) — reverse the accepted version instead.`,
      "wrong_version",
    );
  }

  const { error } = await admin.rpc("record_estimate_acceptance_event", {
    p_event: {
      estimate_id: input.estimateId,
      action: "reversed",
      reversal_destination: input.destination,
      recorded_by_name: input.recordedByName,
      actor_assurance: "selected_identity",
      note: input.reason,
    },
  });

  if (error) {
    throw new RecordAcceptanceEventError(error.message, classifyAcceptanceEventError(error.message));
  }

  const link = await findIdentityLink(admin, estimateNumber);

  let warning: string | undefined;
  if (link) {
    // FIX ROUND (whole-branch review): resolveJobPipelineStages() is now
    // resolved ONLY when a link exists (previously unconditional, even
    // with no identity link and therefore nothing to move), and moved
    // INSIDE this try so a resolution failure degrades the same
    // non-fatal way a stage-MOVE failure does — see presentEstimate's
    // matching note.
    try {
      const stages = await resolveJobPipelineStages();
      const destinationStageId = input.destination === "quote_sent" ? stages.quoteSentStageId : stages.closedLostStageId;
      await assertOpportunityInJobPipelineAndMoveStage(link.ghl_opportunity_id, destinationStageId, stages.pipelineId);
    } catch (err) {
      // See presentEstimate's matching catch block — a wrong-pipeline
      // mismatch is a correctness bug, not a transient failure, and must
      // re-throw rather than be swallowed into a warning.
      if (err instanceof OpportunityPipelineMismatchError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[commercialLifecycle] reverseEstimateAcceptance: GHL stage move failed for estimate family ` +
          `${estimateNumber} (reversal was still recorded):`,
        err,
      );
      warning = `Reversal recorded, but moving the GHL opportunity failed: ${message}`;
    }
  } else {
    console.warn(
      `[commercialLifecycle] reverseEstimateAcceptance: estimate family ${estimateNumber} has no GHL identity ` +
        "link — reversal recorded, but no GHL stage move happened.",
    );
  }

  // D1 (re-review fix, BLOCKER): the status mirror is only meaningful for a
  // version that is still current. The reversal target is routinely
  // 'superseded' (accepted v1, then revised to v2 — see this function's
  // F1/F3 note), and mirroring 'sent'/'declined' onto it would CLEAR that
  // marker — re-exposing the stale version to the estimates list, the
  // revise flow, and re-acceptance, disarming BOTH the app-side and the
  // DB's own superseded-acceptance guards, which key off exactly this
  // column. The reversal event and GHL move above are the record; the
  // superseded marker must survive them.
  const newStatus = input.destination === "quote_sent" ? "sent" : "declined";
  if (targetStatus !== "superseded") {
    await updateStatus(input.estimateId, newStatus, { id: null, name: input.recordedByName });
  }
  return warning ? { warning } : {};
}

// ── isSchedulingEligible ──────────────────────────────────────────────────

/**
 * Pure scheduling-eligibility predicate: accepted AND the acceptance
 * projection's current_estimate_id matches the estimate version being
 * checked. Exposed here, ahead of Task 4 (a later session) actually
 * consuming it for `schedule_estimate`'s eligibility check, purely as
 * documented named logic — v2 Step-6 test list requires proving
 * "scheduling eligibility is false after reversal", which this function's
 * own test covers directly (a reversed state has `accepted: false`).
 */
export function isSchedulingEligible(
  state: EstimateAcceptanceStateRow | null,
  estimateId: string,
): boolean {
  return !!state && state.accepted && state.current_estimate_id === estimateId;
}

// ── resolveAcceptancePresentation (fix round F3) ────────────────────────
//
// Re-exported, not defined here — see acceptancePresentation.ts's module
// header for why: this file's top-level `import "server-only"` would
// otherwise poison `CommercialLifecyclePanel.tsx` ("use client"), which
// needs this function directly.
export {
  resolveAcceptancePresentation,
  type AcceptancePresentation,
} from "./acceptancePresentation";
