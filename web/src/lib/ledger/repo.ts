import "server-only";

// ============================================================
// Lost Boys Demolition — web app — manual ledger repo
// (Profitability v2 Task 7, Lane B)
//
// Thin RPC wrappers, house shape of @/lib/jobs/scheduleActions.ts /
// @/lib/jobs/repo.ts: build snake_case args, `admin.rpc(...)`, normalize
// the numeric-over-the-wire-as-string columns via @/lib/jobs/map.ts's
// normalizers, classify any error into a typed `LedgerError`.
//
// The three RPCs this file wraps are owned by a sibling SQL lane (Lane M,
// still mid-flight at the time this file was written) — this module
// wires against the FIXED signatures the task brief specifies verbatim:
//
//   create_job_cost_entry(p_entry jsonb, p_actor uuid, p_actor_name text)
//     returns job_cost_entries
//   correct_job_cost_entry(p_id uuid, p_patch jsonb, p_reason text,
//     p_actor uuid, p_actor_name text) returns job_cost_entries
//   create_job_revenue_entry(p_entry jsonb, p_actor uuid, p_actor_name text)
//     returns job_revenue_entries
//
// `p_actor` is ALWAYS `null` under the no-login model (see
// @/lib/estimator.ts / CLAUDE.md "No-login estimate tool") — hardcoded
// here rather than taken as a parameter, matching scheduleActions.ts's
// precedent. `p_actor_name` carries the picker-declared estimator name.
//
// Trust-boundary validation (Zod, `@/lib/ledger/validate.ts`, Task 1) is
// the caller's job — this file assumes `CostEntryInput` /
// `CostCorrectionInput` / `RevenueEntryInput` already passed that gate,
// and does no re-validation of its own, matching the brief's "thin
// wrapper" framing (contrast with scheduleActions.ts/exceptionActions.ts,
// which inline their OWN Zod schema because those RPCs have no separate
// validate.ts upstream).
//
// The revenue SIGN RULE lives here, not in validate.ts or the form: a
// `credit`/`refund` entry is always entered POSITIVE by the user (see
// RevenueEntryInput's doc comment in ./types.ts) and negated on the way
// into `p_entry.amount` — `invoice`/`payment`/`approved_contract` pass
// through unchanged.
// ============================================================

import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeBudgetRow,
  normalizeCostEntryRow,
  normalizeJobRow,
  normalizeRevenueEntryRow,
  type JobBudgetVersionRow,
  type JobCostEntryRow,
  type JobRevenueEntryRow,
  type JobRow,
} from "@/lib/jobs/map";
import { LedgerError } from "./types";
import type {
  CostCorrectionInput,
  CostCorrectionPatch,
  CostEntryInput,
  LedgerErrorCode,
  RevenueEntryInput,
} from "./types";

// ------------------------------------------------------------
// Error classification
// ------------------------------------------------------------

/**
 * Exported for direct unit testing of the classification rules — same
 * pattern as @/lib/jobs/repo.ts's classifyScheduleError /
 * scheduleActions.ts's classifyCancelError, but a SEPARATE classifier
 * against Task 2's three RPCs' raise texts. Order matters: `not_found`
 * and `not_correctable` are checked before the broader `invalid_input`
 * substring set, since a specific match must win over a generic one.
 *
 * Matches Task 2's raise texts VERBATIM per the task-3 brief:
 *   - "job % not found" -> not_found
 *   - "only manual entries can be corrected" -> not_correctable
 *   - "must be a positive number" / "must be a non-zero number" /
 *     "must carry a negative amount" / "must carry a positive amount" /
 *     "quantity must be positive" / "unit cost cannot be negative" /
 *     "cannot be created as void" / "must change at least one field" /
 *     "unknown patch field" / "reason is required" / "note is required" /
 *     "date is required" / "actor name is required" -> invalid_input
 *   - anything else -> other
 */
export function classifyLedgerError(message: string): LedgerErrorCode {
  const m = message.toLowerCase();
  if (m.includes("not found")) return "not_found";
  if (m.includes("only manual entries can be corrected")) return "not_correctable";
  if (
    m.includes("must be a positive number") ||
    m.includes("must be a non-zero number") ||
    m.includes("must carry a negative amount") ||
    m.includes("must carry a positive amount") ||
    m.includes("quantity must be positive") ||
    m.includes("unit cost cannot be negative") ||
    m.includes("cannot be created as void") ||
    m.includes("must change at least one field") ||
    m.includes("unknown patch field") ||
    m.includes("reason is required") ||
    m.includes("note is required") ||
    m.includes("date is required") ||
    m.includes("actor name is required")
  ) {
    return "invalid_input";
  }
  return "other";
}

// ------------------------------------------------------------
// createCostEntry
// ------------------------------------------------------------

/**
 * Calls `create_job_cost_entry`. `incurredOn` passes through as the plain
 * `YYYY-MM-DD` string it already is on `CostEntryInput` — no timezone
 * math happens in TypeScript; the RPC owns the Denver-business-date
 * semantics.
 *
 * Throws `LedgerError` (never a bare Error) on any RPC-level rejection —
 * see `classifyLedgerError`'s doc comment for the exact raise-text
 * mapping. An RPC success with no returned row also throws, classified
 * `other`.
 */
export async function createCostEntry(
  input: CostEntryInput,
  actorName: string,
): Promise<JobCostEntryRow> {
  const admin = createAdminClient();

  const p_entry = {
    job_number: input.jobNumber,
    category: input.category,
    state: input.state,
    amount: input.amount,
    quantity: input.quantity,
    unit_cost: input.unitCost,
    employee_name: input.employeeName,
    vendor_name: input.vendorName,
    incurred_on: input.incurredOn,
    note: input.note,
  };

  const { data, error } = await admin.rpc("create_job_cost_entry", {
    p_entry,
    p_actor: null,
    p_actor_name: actorName,
  });

  if (error) {
    throw new LedgerError(error.message, classifyLedgerError(error.message));
  }
  if (!data) {
    throw new LedgerError("create_job_cost_entry returned no row", "other");
  }

  return normalizeCostEntryRow(data as Record<string, unknown>);
}

// ------------------------------------------------------------
// correctCostEntry
// ------------------------------------------------------------

/**
 * Maps a `CostCorrectionPatch`'s camelCase keys onto `correct_job_cost_
 * entry`'s snake_case `p_patch` shape, preserving absent-vs-null: a key
 * the caller never set is not present in `p_patch` at all (`"key" in
 * patch` presence checks, not `!== undefined`), while a key explicitly
 * set to `null` (e.g. clearing `vendorName`) reaches the RPC as JSON
 * `null`. `category`/`state`/`amount`/`quantity`/`incurredOn`/`note`
 * share their name across the camelCase/snake_case boundary except where
 * noted.
 */
function mapCostCorrectionPatch(patch: CostCorrectionPatch): Record<string, unknown> {
  const p_patch: Record<string, unknown> = {};
  if ("category" in patch) p_patch.category = patch.category;
  if ("state" in patch) p_patch.state = patch.state;
  if ("amount" in patch) p_patch.amount = patch.amount;
  if ("quantity" in patch) p_patch.quantity = patch.quantity;
  if ("unitCost" in patch) p_patch.unit_cost = patch.unitCost;
  if ("employeeName" in patch) p_patch.employee_name = patch.employeeName;
  if ("vendorName" in patch) p_patch.vendor_name = patch.vendorName;
  if ("incurredOn" in patch) p_patch.incurred_on = patch.incurredOn;
  if ("note" in patch) p_patch.note = patch.note;
  return p_patch;
}

/**
 * Calls `correct_job_cost_entry`. See `mapCostCorrectionPatch` for the
 * key-mapping/absent-vs-null contract. Throws `LedgerError` on any
 * RPC-level rejection or a no-row success, same as `createCostEntry`.
 */
export async function correctCostEntry(
  input: CostCorrectionInput,
  actorName: string,
): Promise<JobCostEntryRow> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("correct_job_cost_entry", {
    p_id: input.entryId,
    p_patch: mapCostCorrectionPatch(input.patch),
    p_reason: input.reason,
    p_actor: null,
    p_actor_name: actorName,
  });

  if (error) {
    throw new LedgerError(error.message, classifyLedgerError(error.message));
  }
  if (!data) {
    throw new LedgerError("correct_job_cost_entry returned no row", "other");
  }

  return normalizeCostEntryRow(data as Record<string, unknown>);
}

// ------------------------------------------------------------
// createRevenueEntry
// ------------------------------------------------------------

/** `credit`/`refund` are always entered POSITIVE by the user (per
 *  `RevenueEntryInput`'s doc comment in ./types.ts) and negated here on
 *  the way to the RPC — this IS the sign rule, applied exactly once, at
 *  the repo boundary. `invoice` / `payment` / `approved_contract` pass
 *  through unchanged. */
function signedRevenueAmount(input: RevenueEntryInput): number {
  return input.entryType === "credit" || input.entryType === "refund" ? -input.amount : input.amount;
}

/**
 * Calls `create_job_revenue_entry`. Throws `LedgerError` on any
 * RPC-level rejection or a no-row success, same as `createCostEntry`.
 */
export async function createRevenueEntry(
  input: RevenueEntryInput,
  actorName: string,
): Promise<JobRevenueEntryRow> {
  const admin = createAdminClient();

  const p_entry = {
    job_number: input.jobNumber,
    entry_type: input.entryType,
    amount: signedRevenueAmount(input),
    occurred_on: input.occurredOn,
    note: input.note,
  };

  const { data, error } = await admin.rpc("create_job_revenue_entry", {
    p_entry,
    p_actor: null,
    p_actor_name: actorName,
  });

  if (error) {
    throw new LedgerError(error.message, classifyLedgerError(error.message));
  }
  if (!data) {
    throw new LedgerError("create_job_revenue_entry returned no row", "other");
  }

  return normalizeRevenueEntryRow(data as Record<string, unknown>);
}

// ------------------------------------------------------------
// loadLedgerJobContext
// ------------------------------------------------------------

export interface LedgerJobContext {
  job: JobRow;
  /** version = jobs.current_budget_version; null when the job carries no
   *  current budget version (or the version pointed to has no row). */
  currentBudget: JobBudgetVersionRow | null;
  /** This job's cost entries, newest `incurred_at` first. */
  costEntries: JobCostEntryRow[];
  /** This job's revenue entries, newest `occurred_at` first. */
  revenueEntries: JobRevenueEntryRow[];
}

const JOB_NUMBER_RE = /^JOB-\d+$/;

/**
 * Assembles everything the manual-ledger UI (Tasks 4-5) needs for one
 * job: the job row itself, its current budget version (skipped entirely
 * when `current_budget_version` is null — no point querying a version
 * that doesn't exist), and its full cost/revenue entry history.
 *
 * Returns `null` when `jobNumber` fails the `/^JOB-\d+$/` gate (checked
 * BEFORE any query) or when no `jobs` row matches — both cases render as
 * the caller's not-found path, undistinguished from each other in the
 * return value, matching @/lib/jobs/healthRepo.ts's `getJobHealthDetail`
 * precedent.
 */
export async function loadLedgerJobContext(jobNumber: string): Promise<LedgerJobContext | null> {
  if (!JOB_NUMBER_RE.test(jobNumber)) return null;

  const admin = createAdminClient();

  const { data: jobRow, error: jobError } = await admin
    .from("jobs")
    .select("*")
    .eq("job_number", jobNumber)
    .maybeSingle();

  if (jobError) {
    throw new Error(`loadLedgerJobContext: jobs query failed: ${jobError.message}`);
  }
  if (!jobRow) return null;

  const job = normalizeJobRow(jobRow as unknown as Record<string, unknown>);

  const [budgetResult, costEntriesResult, revenueEntriesResult] = await Promise.all([
    job.current_budget_version !== null
      ? admin
          .from("job_budget_versions")
          .select("*")
          .eq("job_number", jobNumber)
          .eq("version", job.current_budget_version)
          .maybeSingle()
      : Promise.resolve<{ data: unknown; error: unknown }>({ data: null, error: null }),
    admin
      .from("job_cost_entries")
      .select("*")
      .eq("job_number", jobNumber)
      .order("incurred_at", { ascending: false }),
    admin
      .from("job_revenue_entries")
      .select("*")
      .eq("job_number", jobNumber)
      .order("occurred_at", { ascending: false }),
  ]);

  if (budgetResult.error) {
    throw new Error(
      `loadLedgerJobContext: job_budget_versions query failed: ${(budgetResult.error as { message: string }).message}`,
    );
  }
  if (costEntriesResult.error) {
    throw new Error(`loadLedgerJobContext: job_cost_entries query failed: ${costEntriesResult.error.message}`);
  }
  if (revenueEntriesResult.error) {
    throw new Error(
      `loadLedgerJobContext: job_revenue_entries query failed: ${revenueEntriesResult.error.message}`,
    );
  }

  const currentBudget = budgetResult.data
    ? normalizeBudgetRow(budgetResult.data as Record<string, unknown>)
    : null;
  const costEntries = ((costEntriesResult.data as Record<string, unknown>[] | null) ?? []).map(
    normalizeCostEntryRow,
  );
  const revenueEntries = ((revenueEntriesResult.data as Record<string, unknown>[] | null) ?? []).map(
    normalizeRevenueEntryRow,
  );

  return { job, currentBudget, costEntries, revenueEntries };
}
