// ============================================================
// Lost Boys Demolition — web app — estimate → GHL field mapping
//
// PURE. No network calls, no "server-only", no Supabase — every function
// here is a plain transform from estimate/line-item data (plus small bits
// of live GHL state the orchestrator already has in hand) to either a GHL
// write payload or a routing decision. push.ts is the only caller; this
// module exists so the mapping/rendering/gating logic the Task 12 brief
// asks to be vitest-covered is actually isolated and testable without
// mocking fetch or Supabase.
//
// GHL field IDs are sourced verbatim from field_mapping.md /
// ghl_field_mapping.md (repo root, Group 1/2/4) — never re-typed by hand
// anywhere else in this module.
// ============================================================

import { allocateAmounts } from "./estimateDoc";
import { buildCustomFieldsPayload } from "./client";
import type { GhlCustomFieldWrite, GhlOpportunity } from "./types";
import type { EstimateLineItemRow, EstimateRow } from "@/lib/estimates/types";

// ── GHL custom field IDs ──────────────────────────────────────────────────

/** field_mapping.md Group 2 — Estimate. */
export const ESTIMATE_FIELD_IDS = {
  laborHours: "sN6l01lwT6G8JUBPisDQ",
  laborCost: "KVlUHcvcTtkO3IKlkaJS",
  materials: "XGz8SzkyU0jAx6blrT9t",
  dumpFees: "VgxdlrbEYNsIYCtuuZn3",
  overhead: "be36GDi35Gk6Ji5hUN5Y",
  profit: "zGtPySCTptCicEU51RSZ",
  trueMargin: "5u484IDWnOrMGkjC7eoe",
  jobScope: "lm91PNb2dNB2g0GPoUuU",
  scopeNotes: "PdNTCRzIpYi3IANr71eh",
} as const;

/** field_mapping.md Group 1 — Job Info. */
export const JOB_INFO_FIELD_IDS = {
  jobAddress: "4pjFIkOmQFpqZ5bOBI9z",
  jobType: "Jfb2jEzxdtHY9vhC8Zhj",
  estimator: "8YGC8Oy2TlRDOSZpN3Mo",
} as const;

/** field_mapping.md Group 4 — Integration. "Airtable Job ID" is the
 *  human-readable job identity field, already repurposed by
 *  ghl-job-webhook to carry job_number (JOB-XXXX) at Quote Accepted. This
 *  module writes job_number into the SAME field, ONLY when set — never a
 *  synthetic placeholder (ruling: do not repurpose this field for
 *  pre-job-number opportunity dedup; see findExistingOpportunityByName
 *  below for the actual dedup strategy). */
export const AIRTABLE_JOB_ID_FIELD_ID = "Gtl6ADpbBGOlYYFil4n6";

// ── Labor hours reconstruction (carry #8) ─────────────────────────────────

/** Reconstructs the labor-hours field from the rate SNAPSHOT stored on the
 *  estimate row (labor_cost / labor_rate) — never from live pricing_variables
 *  — so it's correct regardless of which labor-entry method (total_hours vs
 *  days_employees) produced labor_cost. Guards divide-by-zero: a zero or
 *  invalid labor_rate yields 0 hours rather than NaN/Infinity. */
export function computeLaborHoursField(laborCost: number, laborRate: number): number {
  if (!Number.isFinite(laborRate) || laborRate <= 0) return 0;
  if (!Number.isFinite(laborCost)) return 0;
  return laborCost / laborRate;
}

// ── Job Scope multi-select matching ───────────────────────────────────────

export interface JobScopeSelection {
  /** Option-list values (canonical GHL casing) to send as the Job Scope
   *  multi-select. Deduplicated, order-preserving by first occurrence. */
  matched: string[];
  /** Line item names that had no match in the live option list — these are
   *  never sent to GHL's multi-select (it would reject an unknown option);
   *  instead they're folded into the Scope Notes text so nothing silently
   *  disappears. Deduplicated, order-preserving. */
  dropped: string[];
}

/** Case-insensitive, whitespace-trimmed match of line item names against
 *  the live GHL picklist option values (client.ts's getCustomFieldDefs()
 *  picklistOptions — confirmed live to be an array of option VALUE
 *  strings, not IDs). Returns the OPTION's canonical string on a match
 *  (never the line item's own casing) since that's what GHL's multi-select
 *  write expects to recognize. */
export function buildJobScopeSelection(lineItemNames: string[], optionList: string[]): JobScopeSelection {
  const matched: string[] = [];
  const dropped: string[] = [];
  const seenMatched = new Set<string>();
  const seenDropped = new Set<string>();

  const normalizedOptions = optionList.map((opt) => ({ opt, key: opt.trim().toLowerCase() }));

  for (const rawName of lineItemNames) {
    const name = (rawName ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const hit = normalizedOptions.find((o) => o.key === key);
    if (hit) {
      if (!seenMatched.has(hit.opt)) {
        seenMatched.add(hit.opt);
        matched.push(hit.opt);
      }
    } else if (!seenDropped.has(name)) {
      seenDropped.add(name);
      dropped.push(name);
    }
  }

  return { matched, dropped };
}

// ── Scope Notes rendering ─────────────────────────────────────────────────

export interface BuildScopeNotesInput {
  estimate: Pick<
    EstimateRow,
    | "estimate_number"
    | "version"
    | "total_bid"
    | "quoted_price"
    | "quote_override_reason"
    | "markup_pct"
    | "true_margin_pct"
    | "labor_rate"
    | "dump_rate"
  >;
  lineItems: EstimateLineItemRow[];
  /** Line item names that didn't match a live Job Scope option — see
   *  buildJobScopeSelection. */
  droppedScopeNames: string[];
  /** The current GHL estimate doc number, when one is already known (null
   *  on a first-ever push — the doc doesn't exist yet when the fields
   *  target runs, since fields always push before the doc target). */
  docNumber: string | null;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Renders the Scope Notes text block pushed into GHL's `PdNTCRzIpYi3IANr71eh`
 *  field: est#/version, quoted-vs-calculated (+ override reason when they
 *  differ), markup + true margin, one line per line item (hours/dumps/
 *  materials/allocated price — using the SAME largest-remainder allocation
 *  as the estimate doc, so the two documents never disagree), any scope
 *  names that fell out of the Job Scope multi-select, and the GHL doc
 *  number once known. Pure text — no GHL write logic here. */
export function buildScopeNotes(input: BuildScopeNotesInput): string {
  const { estimate, lineItems, droppedScopeNames, docNumber } = input;
  const lines: string[] = [];

  lines.push(`Estimate #${estimate.estimate_number} v${estimate.version}`);

  const calc = estimate.total_bid;
  const quoted = estimate.quoted_price;
  const differs = quoted !== null && quoted !== undefined && Math.round(quoted * 100) !== Math.round(calc * 100);

  if (differs) {
    const reason = estimate.quote_override_reason ? ` (reason: ${estimate.quote_override_reason})` : "";
    lines.push(`Calculated: ${money(calc)} | Quoted: ${money(quoted as number)}${reason}`);
  } else {
    lines.push(`Total Bid: ${money(calc)}`);
  }

  lines.push(`Markup: ${estimate.markup_pct}% | True margin: ${estimate.true_margin_pct}%`);

  if (lineItems.length > 0) {
    lines.push("");
    lines.push("Line items:");
    const sorted = [...lineItems].sort((a, b) => a.sort_order - b.sort_order);
    const docTotal = quoted ?? calc;
    const weights = sorted.map(
      (li) => li.labor_hours * estimate.labor_rate + li.dump_count * estimate.dump_rate + li.materials_cost,
    );
    const amounts = allocateAmounts(docTotal, weights);
    sorted.forEach((li, i) => {
      const dumpLabel = li.dump_count === 1 ? "dump" : "dumps";
      lines.push(
        `- ${li.name} — ${li.labor_hours} hrs, ${li.dump_count} ${dumpLabel}, ${money(li.materials_cost)} materials — ${money(amounts[i])}`,
      );
    });
  }

  if (droppedScopeNames.length > 0) {
    lines.push("");
    lines.push(`Scope not in GHL Job Scope list: ${droppedScopeNames.join(", ")}`);
  }

  if (docNumber) {
    lines.push("");
    lines.push(`GHL Doc #: ${docNumber}`);
  }

  return lines.join("\n");
}

// ── Custom fields payload ──────────────────────────────────────────────────

export interface BuildEstimateCustomFieldsInput {
  estimate: Pick<
    EstimateRow,
    | "labor_cost"
    | "job_specific_costs"
    | "dump_fees"
    | "overhead"
    | "profit"
    | "true_margin_pct"
    | "job_address"
    | "job_type"
    | "job_number"
    | "created_by_name"
  >;
  laborHours: number;
  jobScopeMatched: string[];
  scopeNotes: string;
}

/** Builds the full 12-field GHL customFields write payload (7 estimate
 *  fields + Job Scope + Scope Notes + Job Address/Job Type + Estimator +
 *  Airtable Job ID). Reuses client.ts's buildCustomFieldsPayload for the
 *  omit-empty-value rule (null/undefined/""/[] entries are dropped, never
 *  sent as an explicit empty write) — same convention as the existing
 *  airtable-job-created edge function.
 *
 *  Estimator is sourced from estimate.created_by_name — the durable
 *  snapshot of who CREATED the estimate — never the current session/actor
 *  pushing it (carry #7: the pusher may not be the estimator). Airtable
 *  Job ID is estimate.job_number, omitted entirely (not a placeholder)
 *  when no job exists yet. */
export function buildEstimateCustomFields(input: BuildEstimateCustomFieldsInput): GhlCustomFieldWrite[] {
  const { estimate, laborHours, jobScopeMatched, scopeNotes } = input;

  return buildCustomFieldsPayload([
    [ESTIMATE_FIELD_IDS.laborHours, laborHours],
    [ESTIMATE_FIELD_IDS.laborCost, estimate.labor_cost],
    [ESTIMATE_FIELD_IDS.materials, estimate.job_specific_costs],
    [ESTIMATE_FIELD_IDS.dumpFees, estimate.dump_fees],
    [ESTIMATE_FIELD_IDS.overhead, estimate.overhead],
    [ESTIMATE_FIELD_IDS.profit, estimate.profit],
    [ESTIMATE_FIELD_IDS.trueMargin, estimate.true_margin_pct],
    [ESTIMATE_FIELD_IDS.jobScope, jobScopeMatched],
    [ESTIMATE_FIELD_IDS.scopeNotes, scopeNotes],
    [JOB_INFO_FIELD_IDS.jobAddress, estimate.job_address],
    [JOB_INFO_FIELD_IDS.jobType, estimate.job_type],
    [JOB_INFO_FIELD_IDS.estimator, estimate.created_by_name],
    [AIRTABLE_JOB_ID_FIELD_ID, estimate.job_number],
  ]);
}

// ── Opportunity naming ─────────────────────────────────────────────────────

/** Opportunity name — same fallback chain as the estimate doc's name
 *  (job_name || job_address || "Estimate #N"), but NOT truncated: GHL
 *  opportunity names don't carry the doc's 40-char validator limit
 *  (task-10-report.md's live-spike finding was specific to
 *  /invoices/estimate). */
export function opportunityName(estimate: Pick<EstimateRow, "job_name" | "job_address" | "estimate_number">): string {
  return estimate.job_name || estimate.job_address || `Estimate #${estimate.estimate_number}`;
}

// ── Contact name splitting ─────────────────────────────────────────────────

/** Best-effort first/last split for GHL contact creation — estimates only
 *  store a single client_name field (no separate first/last columns, unlike
 *  Airtable's Clients table). First whitespace-delimited token is
 *  firstName; everything else is lastName. A single-token or empty name
 *  degrades gracefully rather than throwing. */
export function splitClientName(name: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ── Doc target gating (pure preflight — the network-dependent 401/403 →
//    'not_configured' classification happens in push.ts, not here) ────────

export type DocPreflightResult =
  | { proceed: true }
  | { proceed: false; reason: "skipped_path_b" | "skipped_missing_contact" };

/** Pure preflight gate for the doc target — the SOLE gate, independent of
 *  whether the fields target itself succeeded (review finding 2: the doc
 *  target must not be blocked by a fields-target failure once a contact id
 *  is already in hand — e.g. a transient updateOpportunity 500 on the
 *  attach path, where ghl_push_state already carries a known contact).
 *  Priority order: isPathB skips unconditionally (a record-only estimate
 *  has, by definition, no proposal to send — see BUILD_PLAN.md "Path B =
 *  estimate recorded, not sent"); no resolved GHL contact id skips next
 *  (nothing to attach a doc to, regardless of why — no email at all, or a
 *  contact-resolution failure); missing email OR phone skips last
 *  (buildEstimateDocPayload requires both — this is mostly a defensive
 *  backstop, since `hasContactId` true already implies client_email was
 *  present when resolveContact ran, but is kept independent so this
 *  function's contract doesn't rely on that correlation holding forever).
 *  The remaining 'not_configured' PushResult outcome (GHL estimates scope
 *  not granted) can only be discovered via a live 401/403, so it's
 *  classified in push.ts's try/catch, not here. */
export function decideDocPreflight(input: {
  isPathB: boolean;
  hasContactId: boolean;
  contactEmail: string | null | undefined;
  contactPhone: string | null | undefined;
}): DocPreflightResult {
  if (input.isPathB) return { proceed: false, reason: "skipped_path_b" };
  if (!input.hasContactId) return { proceed: false, reason: "skipped_missing_contact" };
  if (!input.contactEmail || !input.contactPhone) return { proceed: false, reason: "skipped_missing_contact" };
  return { proceed: true };
}

// ── Doc create/replace/revise decision ─────────────────────────────────────

export type DocAction = "create" | "replace" | "revise";

/** Decides what to do with the doc target given what push_state already
 *  knows (existingDocId) and the doc's live status when known:
 *   - no known doc id -> create a fresh draft.
 *   - known doc id, still 'draft' (or status unknown — e.g. a
 *     create-then-crash recovery match, safely assumed still draft since
 *     this process created it moments before crashing) -> full-replace PUT
 *     in place.
 *   - known doc id, status has moved past draft (sent/viewed/accepted/
 *     declined) -> leave it alone and create a NEW "ESTIMATE (REVISED)"
 *     draft instead. */
export function decideDocAction(existingDocId: string | null, existingDocStatus: string | null): DocAction {
  if (!existingDocId) return "create";
  if (existingDocStatus === null || existingDocStatus === "draft") return "replace";
  return "revise";
}

/** Pure parse of listEstimateDocs' response shape (confirmed live:
 *  `{ estimates: [...], total, traceId }`) to find one doc's current
 *  status by id. Tolerant of the bare-array shape too, same defensive
 *  style as estimateDoc.ts's findDocByMeta. */
export function extractDocStatus(listResponse: unknown, docId: string): string | null {
  const d = listResponse as
    | { estimates?: Array<{ _id?: string; id?: string; status?: string }> }
    | Array<{ _id?: string; id?: string; status?: string }>
    | null
    | undefined;
  const list = Array.isArray(d) ? d : (d?.estimates ?? []);
  const match = list.find((item) => (item._id ?? item.id) === docId);
  return match?.status ?? null;
}

// ── Opportunity search-before-create dedup ─────────────────────────────────

/** Search-before-create dedup key (binding carry #2, ruled on): exact
 *  opportunity-name match scoped to the contact's opportunity list (the
 *  caller pre-filters to this contact via searchOpportunitiesByContact).
 *  The one candidate GHL field that could carry a stable pre-job identity
 *  (Airtable Job ID) is reserved by this same module for job_number ONLY
 *  (ruled: do not repurpose it) — so name matching, scoped to the contact,
 *  is the accepted key. Exact match only (case-sensitive) since the caller
 *  controls both the name being searched for and the name that was set on
 *  create. */
export function findExistingOpportunityByName(opportunities: GhlOpportunity[], name: string): GhlOpportunity | null {
  return opportunities.find((o) => o.name === name) ?? null;
}

// ── Version-chain push-state inheritance (binding carry #3) ────────────────

export interface ChainVersionRef {
  id: string;
  version: number;
}

/** v2+ estimates start with an EMPTY ghl_push_state row (no versioning
 *  applies to that bookkeeping table). This walks the version chain
 *  (descending, nearest ancestor first) and returns the first ancestor's
 *  push_state that isn't null — so a revision naturally carries forward
 *  the same GHL contact/opportunity/doc ids instead of push.ts creating
 *  duplicates. Pure: the caller does the actual `ghl_push_state` query and
 *  hands the results in as a plain id->row map. */
export function selectInheritedState<T>(
  chain: ChainVersionRef[],
  pushStatesByEstimateId: Record<string, T | null | undefined>,
  ownEstimateId: string,
): T | null {
  const ancestors = chain.filter((v) => v.id !== ownEstimateId).sort((a, b) => b.version - a.version);
  for (const v of ancestors) {
    const state = pushStatesByEstimateId[v.id];
    if (state) return state;
  }
  return null;
}
