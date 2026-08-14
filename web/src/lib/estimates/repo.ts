import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadRatesConfig } from "@/lib/rates";
import { computeEstimate, type EstimateInputs } from "@/lib/pricing";
import { validateEstimateDraft, validateQuoteOverride } from "./validate";
import { mapDraftToEstimatePayload, type VersionInfo } from "./map";
import type {
  EstimateActor,
  EstimateDetail,
  EstimateDraft,
  EstimateLineItemRow,
  EstimateMutationAuditRow,
  EstimateRow,
  EstimateStatus,
  EstimateSummary,
  GhlPushStateRow,
} from "./types";

/**
 * Thrown by createEstimate/createNewVersion/updateQuote when the app-layer
 * validation (zod draft schema, itemized reconciliation, override-reason
 * rule) rejects the input BEFORE it ever reaches Postgres. Carries the full
 * list of field-level messages so actions.ts can surface them without
 * re-parsing an Error's `.message` string.
 */
export class EstimateValidationError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super(errors.join("; "));
    this.name = "EstimateValidationError";
    this.errors = errors;
  }
}

export interface ListEstimatesOptions {
  q?: string;
  includeSuperseded?: boolean;
  limit?: number;
}

// ---------------------------------------------------------------
// Numeric coercion
// ---------------------------------------------------------------
// Postgres `numeric(*,*)` columns come back over the wire as JSON STRINGS,
// not numbers — verified directly against the live 1414 test chain (e.g.
// total_bid arrives as the string "1022.06", not the number 1022.06). This
// is the exact gotcha @/lib/rates already documents and guards against for
// pricing_variables ("Supabase may return `numeric` columns as strings —
// coerce explicitly"). estimates/estimate_line_items/
// estimate_mutations_audit all use `numeric` for every dollar/quantity
// column, so every row that crosses this file's boundary (RPC returns AND
// plain selects) is normalized here — EstimateRow/EstimateSummary/etc.'s
// `number` typing is only true at runtime because of this step. Skipping
// it would hand Task 11/11b UI code values that silently string-concatenate
// instead of adding.
function toNum(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : toNum(value);
}

function normalizeEstimateRow(raw: Record<string, unknown>): EstimateRow {
  return {
    ...(raw as unknown as EstimateRow),
    total_job_hours: toNullableNum(raw.total_job_hours),
    days_at_job: toNullableNum(raw.days_at_job),
    num_employees: toNullableNum(raw.num_employees),
    dump_count: toNum(raw.dump_count),
    job_specific_costs: toNum(raw.job_specific_costs),
    markup_pct: toNum(raw.markup_pct),
    labor_rate: toNum(raw.labor_rate),
    overhead_rate: toNum(raw.overhead_rate),
    dump_rate: toNum(raw.dump_rate),
    cc_fee_rate: toNum(raw.cc_fee_rate),
    labor_cost: toNum(raw.labor_cost),
    dump_fees: toNum(raw.dump_fees),
    total_direct: toNum(raw.total_direct),
    overhead: toNum(raw.overhead),
    profit: toNum(raw.profit),
    cc_fee: toNum(raw.cc_fee),
    total_bid: toNum(raw.total_bid),
    true_margin_pct: toNum(raw.true_margin_pct),
    quoted_price: toNullableNum(raw.quoted_price),
  };
}

function normalizeEstimateSummary(raw: Record<string, unknown>): EstimateSummary {
  return {
    ...(raw as unknown as EstimateSummary),
    total_bid: toNum(raw.total_bid),
    quoted_price: toNullableNum(raw.quoted_price),
  };
}

function normalizeLineItemRow(raw: Record<string, unknown>): EstimateLineItemRow {
  return {
    ...(raw as unknown as EstimateLineItemRow),
    labor_hours: toNum(raw.labor_hours),
    dump_count: toNum(raw.dump_count),
    materials_cost: toNum(raw.materials_cost),
  };
}

function normalizeAuditRow(raw: Record<string, unknown>): EstimateMutationAuditRow {
  return {
    ...(raw as unknown as EstimateMutationAuditRow),
    old_quoted_price: toNullableNum(raw.old_quoted_price),
    new_quoted_price: toNullableNum(raw.new_quoted_price),
  };
}

/** Builds the pricing engine's input shape from a validated draft. Pure,
 *  but not exported — it's an implementation detail of the two create
 *  pipelines below, not a public interface downstream tasks need. */
function buildEstimateInputs(draft: EstimateDraft): EstimateInputs {
  if (draft.laborMethod === "total_hours") {
    return {
      laborMethod: "total_hours",
      totalJobHours: draft.totalJobHours ?? undefined,
      dumpCount: draft.dumpCount,
      jobSpecificCosts: draft.jobSpecificCosts,
      markupPct: draft.markupPct,
    };
  }
  return {
    laborMethod: "days_employees",
    daysAtJob: draft.daysAtJob ?? undefined,
    numEmployees: draft.numEmployees ?? undefined,
    dumpCount: draft.dumpCount,
    jobSpecificCosts: draft.jobSpecificCosts,
    markupPct: draft.markupPct,
  };
}

/** Shared pipeline tail for both create paths: compute -> override-reason
 *  check -> map -> RPC. `versionInfo` absent means a version-1 create. */
async function computeAndCreate(
  draft: EstimateDraft,
  user: EstimateActor,
  versionInfo?: VersionInfo,
): Promise<EstimateRow> {
  const ratesConfig = await loadRatesConfig();
  const inputs = buildEstimateInputs(draft);
  const outputs = computeEstimate(inputs, ratesConfig.rates);

  const quoteCheck = validateQuoteOverride(
    draft.quotedPrice ?? null,
    outputs.totalBid,
    draft.quoteOverrideReason ?? null,
  );
  if (!quoteCheck.ok) {
    throw new EstimateValidationError([quoteCheck.error ?? "quote_override_reason is required"]);
  }

  const { estimate, lineItems } = mapDraftToEstimatePayload(
    draft,
    outputs,
    ratesConfig,
    user,
    versionInfo,
  );

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_estimate_with_items", {
    p_estimate: estimate,
    p_line_items: lineItems,
  });

  if (error) {
    throw new Error(`create_estimate_with_items failed: ${error.message}`);
  }

  return normalizeEstimateRow(data as Record<string, unknown>);
}

/**
 * Creates a version-1 estimate: loadRatesConfig() -> validate(draft) ->
 * build EstimateInputs -> computeEstimate(inputs, rates) -> map to payload
 * -> rpc('create_estimate_with_items'). Returns the created row.
 *
 * `draftInput` is `unknown` deliberately — this IS the trust boundary
 * where zod validation happens (validateEstimateDraft), whether the caller
 * is a server action fed a client object or a script.
 */
export async function createEstimate(
  draftInput: unknown,
  user: EstimateActor,
): Promise<EstimateRow> {
  const validated = validateEstimateDraft(draftInput);
  if (!validated.success) {
    throw new EstimateValidationError(validated.errors);
  }
  return computeAndCreate(validated.data, user);
}

/**
 * Creates a new version of an existing estimate chain: fetches the parent
 * row's (estimate_number, version, id), then runs the same
 * validate -> compute -> map -> rpc pipeline as createEstimate, but with
 * `versionInfo` set so map.ts takes the version>1 branch of the writer
 * contract (explicit estimate_number, version = parent+1,
 * supersedes_estimate_id = parent.id). The RPC flips the parent to
 * 'superseded' atomically in the same transaction.
 */
export async function createNewVersion(
  parentId: string,
  draftInput: unknown,
  user: EstimateActor,
): Promise<EstimateRow> {
  const validated = validateEstimateDraft(draftInput);
  if (!validated.success) {
    throw new EstimateValidationError(validated.errors);
  }

  const admin = createAdminClient();
  const { data: parent, error: parentError } = await admin
    .from("estimates")
    .select("id, estimate_number, version")
    .eq("id", parentId)
    .single();

  if (parentError || !parent) {
    throw new Error(
      `createNewVersion: parent estimate ${parentId} not found: ${parentError?.message ?? "no row"}`,
    );
  }

  const versionInfo: VersionInfo = {
    estimateNumber: Number(parent.estimate_number),
    version: Number(parent.version) + 1,
    supersedesEstimateId: parent.id as string,
  };

  return computeAndCreate(validated.data, user, versionInfo);
}

/** rpc('update_estimate_status', {p_id, p_status, p_actor, p_actor_name}) */
export async function updateStatus(
  id: string,
  status: EstimateStatus,
  user: EstimateActor,
): Promise<EstimateRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("update_estimate_status", {
    p_id: id,
    p_status: status,
    p_actor: user.id,
    p_actor_name: user.name,
  });

  if (error) {
    throw new Error(`update_estimate_status failed: ${error.message}`);
  }

  return normalizeEstimateRow(data as Record<string, unknown>);
}

/**
 * rpc('update_estimate_quote', ...). Checks the override-reason rule
 * app-side first (fetching the row's current total_bid) for a friendly
 * error message; the RPC's own CHECK-constraint-backed raise is the
 * backstop if this app-side check is ever bypassed.
 */
export async function updateQuote(
  id: string,
  quotedPrice: number | null,
  reason: string | null,
  user: EstimateActor,
): Promise<EstimateRow> {
  const admin = createAdminClient();

  if (quotedPrice !== null) {
    const { data: existing, error: fetchError } = await admin
      .from("estimates")
      .select("total_bid")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      throw new Error(
        `updateQuote: estimate ${id} not found: ${fetchError?.message ?? "no row"}`,
      );
    }

    const check = validateQuoteOverride(quotedPrice, Number(existing.total_bid), reason);
    if (!check.ok) {
      throw new EstimateValidationError([check.error ?? "quote_override_reason is required"]);
    }
  }

  const { data, error } = await admin.rpc("update_estimate_quote", {
    p_id: id,
    p_quoted_price: quotedPrice,
    p_reason: reason,
    p_actor: user.id,
    p_actor_name: user.name,
  });

  if (error) {
    throw new Error(`update_estimate_quote failed: ${error.message}`);
  }

  return normalizeEstimateRow(data as Record<string, unknown>);
}

/**
 * rpc('update_estimate_job_number', ...) — the fourth write RPC (added by
 * the phase_b2_rpcs_fixups migration). Not called by any Task 8 action yet
 * (no page promotes an estimate to a job in this slice), but exposed here
 * since it's part of the repo.ts surface downstream tasks were told to
 * expect.
 */
export async function updateJobNumber(
  id: string,
  jobNumber: string | null,
  user: EstimateActor,
): Promise<EstimateRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("update_estimate_job_number", {
    p_id: id,
    p_job_number: jobNumber,
    p_actor: user.id,
    p_actor_name: user.name,
  });

  if (error) {
    throw new Error(`update_estimate_job_number failed: ${error.message}`);
  }

  return normalizeEstimateRow(data as Record<string, unknown>);
}

/**
 * List-view query: summary columns, newest first, optional `ilike` search
 * across job_name/client_name, superseded rows hidden unless
 * `includeSuperseded` is set.
 */
export async function listEstimates(
  options: ListEstimatesOptions = {},
): Promise<EstimateSummary[]> {
  const { q, includeSuperseded = false, limit = 50 } = options;
  const admin = createAdminClient();

  let query = admin
    .from("estimates")
    .select(
      "id, estimate_number, version, status, job_number, job_name, client_name, total_bid, quoted_price, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeSuperseded) {
    query = query.neq("status", "superseded");
  }

  const trimmed = q?.trim();
  if (trimmed) {
    const pattern = `%${trimmed}%`;
    query = query.or(`job_name.ilike.${pattern},client_name.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`listEstimates: query failed: ${error.message}`);
  }

  return (data ?? []).map((raw) => normalizeEstimateSummary(raw as Record<string, unknown>));
}

/**
 * Detail-view query: header + line items (sort_order asc) + version chain
 * (every row sharing this estimate_number, version asc) + audit trail
 * (newest first) + push state (null if never pushed). Four follow-up
 * queries run in parallel via Promise.all once the header's estimate_number
 * is known.
 */
export async function getEstimate(id: string): Promise<EstimateDetail> {
  const admin = createAdminClient();

  const { data: estimate, error: estimateError } = await admin
    .from("estimates")
    .select("*")
    .eq("id", id)
    .single();

  if (estimateError || !estimate) {
    throw new Error(`getEstimate: estimate ${id} not found: ${estimateError?.message ?? "no row"}`);
  }

  const row = normalizeEstimateRow(estimate as Record<string, unknown>);

  const [lineItemsResult, versionChainResult, auditResult, pushStateResult] = await Promise.all([
    admin
      .from("estimate_line_items")
      .select("*")
      .eq("estimate_id", id)
      .order("sort_order", { ascending: true }),
    admin
      .from("estimates")
      .select("*")
      .eq("estimate_number", row.estimate_number)
      .order("version", { ascending: true }),
    admin
      .from("estimate_mutations_audit")
      .select("*")
      .eq("estimate_id", id)
      .order("changed_at", { ascending: false }),
    admin.from("ghl_push_state").select("*").eq("estimate_id", id).maybeSingle(),
  ]);

  if (lineItemsResult.error) {
    throw new Error(`getEstimate: line items query failed: ${lineItemsResult.error.message}`);
  }
  if (versionChainResult.error) {
    throw new Error(`getEstimate: version chain query failed: ${versionChainResult.error.message}`);
  }
  if (auditResult.error) {
    throw new Error(`getEstimate: audit query failed: ${auditResult.error.message}`);
  }
  if (pushStateResult.error) {
    throw new Error(`getEstimate: push state query failed: ${pushStateResult.error.message}`);
  }

  return {
    estimate: row,
    lineItems: (lineItemsResult.data ?? []).map((raw) =>
      normalizeLineItemRow(raw as Record<string, unknown>),
    ),
    versionChain: (versionChainResult.data ?? []).map((raw) =>
      normalizeEstimateRow(raw as Record<string, unknown>),
    ),
    auditTrail: (auditResult.data ?? []).map((raw) =>
      normalizeAuditRow(raw as Record<string, unknown>),
    ),
    pushState: (pushStateResult.data ?? null) as GhlPushStateRow | null,
  };
}
