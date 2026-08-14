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
}
