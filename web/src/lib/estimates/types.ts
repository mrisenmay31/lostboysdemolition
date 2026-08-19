// ============================================================
// Lost Boys Demolition — web app — estimates data layer types
//
// Two families of shapes on purpose:
//   - "Draft" types (camelCase) are the UI-facing input the builder (Task
//     11) collects and passes to repo.ts. map.ts (pure) is the ONLY place
//     that translates a draft into the snake_case jsonb payload the
//     create_estimate_with_items RPC expects.
//   - "Row" types (snake_case) mirror the `estimates` / `estimate_line_items`
//     / `estimate_mutations_audit` / `ghl_push_state` table columns
//     exactly, because that's what supabase-js hands back verbatim from a
//     `select("*")` or an RPC that `returns estimates` — no translation
//     layer, no drift risk from hand-maintaining a second field list.
// ============================================================

import type { LaborMethod } from "@/lib/pricing";

export type EstimateStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "superseded"
  | "historical";

export type ClientType = "Contractor" | "Homeowner";
export type JobType = "Residential" | "Commercial";

/** Who performed a write. With no login, `id` is always null and `name` is
 *  the picker-declared estimator (allowlist-validated in actions.ts).
 *  `id` stays in the shape because estimates.created_by / audit actor_id
 *  remain in the schema for a possible future re-auth. */
export interface EstimateActor {
  id: string | null;
  name: string;
}

// ---------------------------------------------------------------
// Draft (UI input) shapes
// ---------------------------------------------------------------

export interface LineItemDraft {
  scopeLibraryId?: string | null;
  name: string;
  description?: string;
  laborHours: number;
  dumpCount: number;
  materialsCost: number;
  sortOrder?: number;
}

export interface EstimateDraft {
  jobNumber?: string | null;
  jobName?: string | null;
  clientName?: string | null;
  clientType?: ClientType | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  jobAddress?: string | null;
  city?: string | null;
  jobType?: JobType | null;
  estimateDate?: string | null; // ISO date (YYYY-MM-DD); DB defaults to current_date when omitted
  jobDetails?: string | null;
  laborMethod: LaborMethod;
  totalJobHours?: number | null; // required when laborMethod === "total_hours"
  daysAtJob?: number | null; // required when laborMethod === "days_employees"
  numEmployees?: number | null; // required when laborMethod === "days_employees"
  dumpCount: number;
  jobSpecificCosts: number;
  markupPct: number;
  // ---------------------------------------------------------------
  // Economic-plan category costs (Phase 1, v2 Task 2 / Session 2 lane 2d).
  // These six feed computeEstimateEconomics() (web/src/lib/profitability/
  // estimateEconomics.ts) via map.ts's mapDraftToEstimatePayload, which
  // writes exactly one estimate_financial_details row in the same
  // transaction as the estimate. They do NOT change customer quote math:
  // materialsCost/rentalsCost/subcontractorsCost/otherDirectCost are the
  // four components jobSpecificCosts above is derived from
  // (jobSpecificCosts = roundToCent(materials + rentals + subcontractors +
  // otherDirect) — see EstimateBuilder.tsx), and expectedDumpCost /
  // expectedProcessingCost are REAL-COST estimates that sit alongside,
  // never inside, the priced dump/CC-fee allowances (dumpFees/ccFee on
  // EstimateOutputs) computeEstimate() already produces.
  /** Real (not priced-in) cost of materials — one of the four
   *  jobSpecificCosts components. */
  materialsCost: number;
  /** Real cost of equipment/rentals — one of the four jobSpecificCosts
   *  components. */
  rentalsCost: number;
  /** Real EXPECTED dump cost (defaults to dumpCount * rates config's
   *  estimatedDumpCostPerLoad in the builder). Deliberately NEVER folded
   *  into jobSpecificCosts or computeEstimate()'s inputs — it exists only
   *  to compute the dump risk-pricing allowance
   *  (dumpPricingBasis - expectedDumpCost) inside
   *  computeEstimateEconomics(). */
  expectedDumpCost: number;
  /** Real cost of subcontracted work — one of the four jobSpecificCosts
   *  components. */
  subcontractorsCost: number;
  /** Real cost of any other direct job cost not covered by the other
   *  three category fields — one of the four jobSpecificCosts
   *  components. */
  otherDirectCost: number;
  /** Real EXPECTED card-processing cost (defaults to the live preview's
   *  computed ccFee — see EstimateBuilder.tsx — since the priced CC-fee
   *  rate and the actual processor rate are currently the same 3.5%, per
   *  CLAUDE.md's Pricing Benchmarks). Never folded into jobSpecificCosts
   *  or computeEstimate()'s inputs. */
  expectedProcessingCost: number;
  // Almost always absent on creation — Dane sets these later via the
  // updateQuote action on an existing estimate. Included here because
  // map.ts's writer contract writes quoted_price/quote_override_reason on
  // every insert (DB columns are nullable) and createEstimate/
  // createNewVersion accept a draft that could, in principle, seed one.
  quotedPrice?: number | null;
  quoteOverrideReason?: string | null;
  status?: EstimateStatus; // defaults to 'draft' in the RPC when omitted
  /** Path B = internal record only, no proposal doc pushed. Optional here
   *  (mirrors every other RPC-defaulted flag on this type); defaults to
   *  false in both validate.ts's zod schema and map.ts's payload builder,
   *  matching the DB column's own `not null default false`. */
  isPathB?: boolean;
  lineItems: LineItemDraft[];
}

// ---------------------------------------------------------------
// Reconciliation / validation result types (validate.ts)
// ---------------------------------------------------------------

export type ValidationResult =
  | { success: true; data: EstimateDraft }
  | { success: false; errors: string[] };

/** Result of the pure quote-override-reason check — mirrors the DB CHECK
 *  `quote_override_reason_required` and the update_estimate_quote RPC's
 *  procedural raise, so the app can surface the same rule as a friendly
 *  error before ever reaching Postgres. */
export interface QuoteOverrideCheck {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------
// Row (DB) shapes
// ---------------------------------------------------------------

export interface EstimateRow {
  id: string;
  estimate_number: number;
  version: number;
  supersedes_estimate_id: string | null;
  status: EstimateStatus;
  job_number: string | null;
  job_name: string | null;
  client_name: string | null;
  client_type: ClientType | null;
  client_email: string | null;
  client_phone: string | null;
  job_address: string | null;
  city: string | null;
  job_type: JobType | null;
  estimate_date: string;
  job_details: string | null;
  labor_method: LaborMethod;
  total_job_hours: number | null;
  days_at_job: number | null;
  num_employees: number | null;
  dump_count: number;
  job_specific_costs: number;
  markup_pct: number;
  labor_rate: number;
  overhead_rate: number;
  dump_rate: number;
  cc_fee_rate: number;
  labor_cost: number;
  dump_fees: number;
  total_direct: number;
  overhead: number;
  profit: number;
  cc_fee: number;
  total_bid: number;
  true_margin_pct: number;
  quoted_price: number | null;
  quote_override_reason: string | null;
  source: string;
  airtable_estimate_id: number | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  is_path_b: boolean;
}

export interface EstimateLineItemRow {
  id: string;
  estimate_id: string;
  scope_library_id: string | null;
  name: string;
  description: string;
  labor_hours: number;
  dump_count: number;
  materials_cost: number;
  sort_order: number;
  created_at: string;
}

/** List-view projection — the columns `listEstimates` actually selects. */
export interface EstimateSummary {
  id: string;
  estimate_number: number;
  version: number;
  status: EstimateStatus;
  job_number: string | null;
  job_name: string | null;
  client_name: string | null;
  total_bid: number;
  quoted_price: number | null;
  created_at: string;
  is_path_b: boolean;
}

export interface EstimateMutationAuditRow {
  id: number;
  estimate_id: string;
  changed_at: string;
  actor_id: string | null;
  actor_name: string | null;
  old_status: EstimateStatus | null;
  new_status: EstimateStatus | null;
  old_quoted_price: number | null;
  new_quoted_price: number | null;
  old_quote_override_reason: string | null;
  new_quote_override_reason: string | null;
  old_job_number: string | null;
  new_job_number: string | null;
}

// ---------------------------------------------------------------
// Commercial lifecycle row shapes (Phase 1, v2 Task 2 / Session 2 lane 2d).
// Mirror the four tables 20260819161000_estimate_commercial_lifecycle.sql
// creates, plus the one estimate_financial_details table Task 1's core
// schema migration creates — same "Row shapes mirror table columns
// exactly" rationale as the header comment on this file.
// ---------------------------------------------------------------

/** `estimate_financial_details` — one immutable row per estimate VERSION,
 *  written by create_estimate_with_items_v2 in the same transaction as
 *  the estimate + line items. PK is estimate_id (1:1). */
export interface EstimateFinancialDetailsRow {
  estimate_id: string;
  formula_version: string;
  productive_hours: number;
  operational_labor_cost: number;
  materials_cost: number;
  rentals_cost: number;
  expected_dump_cost: number;
  subcontractors_cost: number;
  other_direct_cost: number;
  allocated_overhead: number;
  expected_processing_cost: number;
  risk_pricing_allowance: number;
  markup_amount: number;
  processing_pricing_allowance: number;
  discount_amount: number;
  customer_price: number;
  planned_economic_profit: number;
  planned_profit_pct: number;
  created_at: string;
}

/** `estimate_identity_links` — canonical estimate-family (estimate_number)
 *  -> GHL contact/opportunity relationship. Mutable registry, not
 *  versioned history. `ghl_opportunity_id` is UNIQUE — one opportunity
 *  links to at most one active estimate family. */
export interface EstimateIdentityLinkRow {
  estimate_number: number;
  ghl_contact_id: string;
  ghl_opportunity_id: string;
  linked_by_name: string;
  actor_assurance: ActorAssurance;
  created_at: string;
  updated_at: string;
}

/** `estimate_presentations` — immutable, one row per estimate VERSION
 *  (unique on estimate_id), recording that this exact version was shown
 *  to the customer with a content hash of what was shown. */
export interface EstimatePresentationRow {
  id: string;
  estimate_id: string;
  presented_via: "ghl" | "email" | "print" | "other";
  presented_by_name: string;
  actor_assurance: ActorAssurance;
  snapshot_hash: string;
  presented_at: string;
}

export type EstimateAcceptanceAction = "accepted" | "reversed";
export type ActorAssurance = "authenticated" | "selected_identity" | "external_webhook";
export type CustomerAuthorizationMethod = "signature" | "email" | "text" | "verbal" | "other";

/** `estimate_acceptance_events` — append-only acceptance/reversal event
 *  log, never updated or deleted. `accepted_price` is pinned server-side
 *  by `record_estimate_acceptance_event` on an 'accepted' event, never
 *  trusted from the caller (deviation 12). */
export interface EstimateAcceptanceEventRow {
  id: string;
  estimate_id: string;
  action: EstimateAcceptanceAction;
  authorization_method: CustomerAuthorizationMethod | null;
  customer_contact_name: string | null;
  accepted_price: number | null;
  effective_at: string;
  recorded_by_auth_user_id: string | null;
  recorded_by_name: string;
  actor_assurance: ActorAssurance;
  note: string;
  evidence_paths: string[];
  supersedes_event_id: string | null;
  reversal_destination: "quote_sent" | "closed_lost" | null;
  created_at: string;
}

/** `estimate_acceptance_state` — mutable projection of the CURRENT
 *  acceptance state per estimate FAMILY (estimate_number), re-derived by
 *  `record_estimate_acceptance_event` on every event. Scheduling (a later
 *  task) reads only this projection, so it can never select a reversed
 *  acceptance — see `isSchedulingEligible` in commercialLifecycle.ts. */
export interface EstimateAcceptanceStateRow {
  estimate_number: number;
  current_estimate_id: string;
  accepted: boolean;
  current_acceptance_event_id: string | null;
  accepted_price: number | null;
  last_event_id: string;
  updated_at: string;
}

export interface GhlPushStateRow {
  estimate_id: string;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  ghl_estimate_id: string | null;
  ghl_estimate_number: string | null;
  fields_pushed_at: string | null;
  doc_pushed_at: string | null;
  last_error: string | null;
  attempts: number;
  updated_at: string;
}

/** getEstimate()'s full return shape: header + everything a detail page
 *  (Task 11b) needs to render in one round trip. */
export interface EstimateDetail {
  estimate: EstimateRow;
  lineItems: EstimateLineItemRow[];
  /** Every version sharing this estimate's estimate_number, ordered by
   *  version ascending — includes the row itself. */
  versionChain: EstimateRow[];
  /** Newest first. */
  auditTrail: EstimateMutationAuditRow[];
  pushState: GhlPushStateRow | null;
  /** Null only if create_estimate_with_items_v2's guaranteed 1:1 insert
   *  somehow didn't run for this row (e.g. a pre-Task-2 legacy row created
   *  via v1's create_estimate_with_items, which never writes this table). */
  financialDetails: EstimateFinancialDetailsRow | null;
  /** Null until this estimate's FAMILY (estimate_number) has been linked
   *  to a GHL contact/opportunity — see commercialLifecycle.ts's
   *  linkEstimateIdentity. */
  identityLink: EstimateIdentityLinkRow | null;
  /** Null until THIS VERSION has been presented — see
   *  commercialLifecycle.ts's presentEstimate. Unique per estimate_id
   *  (one row per version, never per family). */
  presentation: EstimatePresentationRow | null;
  /** Null until this estimate's FAMILY has at least one acceptance event.
   *  `accepted: false` after a reversal — see
   *  commercialLifecycle.ts's isSchedulingEligible. */
  acceptanceState: EstimateAcceptanceStateRow | null;
}
