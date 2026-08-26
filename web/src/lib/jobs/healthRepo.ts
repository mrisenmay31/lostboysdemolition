import "server-only";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane B: job health
// aggregate repository
//
// The single data-access boundary between raw Postgres rows and the two
// read functions the dashboard/detail UI tasks (3-4) consume. Everything
// numeric-over-the-wire is normalized here, either via Task 1's
// `normalize*` functions (JobRow, JobBudgetVersionRow, JobCostEntryRow,
// JobRevenueEntryRow) or, for the two row shapes Task 1 has no exported
// normalizer for (`job_forecast_overrides`, `job_alerts`), via local
// normalizers built the same way — see the module header note in
// jobs/map.ts's `coerceNullableNum` doc comment for why every numeric
// field on those two rows must be defensively coerced here rather than
// trusted to already be a number.
//
// `listJobHealthSummaries` performs NO writes — one `jobs` select per
// filter, then batched `.in("job_number", numbers)` parallel loads,
// never a per-job query loop. `getJobHealthDetail` is the only place in
// this module that writes, and only ever to `job_forecast_snapshots`
// (insert) and `jobs.last_forecast_at` (update) — both best-effort,
// console.error'd on failure, never surfaced to the caller. Snapshots
// are append-only by DB trigger (enforce_job_forecast_snapshots_immutability,
// 20260819151000_profitability_core_schema.sql) — this module never
// updates or deletes an existing snapshot row.
//
// Source: docs/superpowers/plans/2026-08-26-v2-task6-job-dashboard
// task-2-brief.md. Schema verified live 2026-08-26 (CLAUDE.md's `jobs`
// table entry plus 20260819151000_profitability_core_schema.sql).
// ============================================================

import { createAdminClient } from "@/lib/supabase/admin";
import type { CostCategory, ForecastConfidence, HealthStatus, JobHealthInput, JobHealthResult } from "@/lib/profitability/types";
import { calculateJobHealth } from "@/lib/profitability/calculateJobHealth";
import type { OpenScheduleException, PreviousSchedule } from "@/lib/jobs/exceptionActions";
import {
  buildFinancialComparison,
  buildJobHealthInput,
  crewDaysRemaining,
  isEngineScorable,
  normalizeBudgetRow,
  normalizeCostEntryRow,
  normalizeJobRow,
  normalizeRevenueEntryRow,
  rollupLedger,
  statusSortRank,
  toNullableNum,
  toNum,
  watermarksEqual,
  type ForecastOverrideRow,
  type FinancialComparison,
  type JobAlertRow,
  type JobBudgetVersionRow,
  type JobCostEntryRow,
  type JobRevenueEntryRow,
  type JobRow,
  type SnapshotWatermarks,
} from "@/lib/jobs/map";

// ------------------------------------------------------------
// Public types (Produces block — consumed verbatim by Tasks 3-4;
// do not rename or reshape).
// ------------------------------------------------------------

export type DashboardFilter =
  | "active" // status_v2 in (scheduled, in_progress)
  | "completed" // status_v2 in (completed, paid) AND financial_status NOT IN (financially_closed, reconciliation_required, invoice_review, invoice_sent, paid_reconciliation_pending)
  | "invoice_reconciliation" // financial_status in (invoice_review, invoice_sent, paid_reconciliation_pending)
  | "financially_closed" // financial_status = financially_closed
  | "reconciliation_required" // financial_status = reconciliation_required
  | "cancelled"; // status_v2 = cancelled

export interface JobHealthSummary {
  job: JobRow;
  health: HealthStatus | null;
  confidence: ForecastConfidence | null;
  forecastProfit: number | null;
  forecastProfitPct: number | null;
  approvedRevenue: number | null; // current budget; null when no budget row (defensive)
  forecastHours: number | null;
  budgetHours: number | null;
  crewDaysRemaining: number | null;
  leadingReason: string | null; // health.reasons[0]
  openAlertCount: number;
  openExceptionCount: number;
  nextAction: { label: string; href: string } | null;
  sortRank: number;
}

export interface JobHealthDetail {
  job: JobRow;
  originalBudget: JobBudgetVersionRow | null;
  currentBudget: JobBudgetVersionRow | null;
  healthInput: JobHealthInput | null;
  health: JobHealthResult | null;
  comparison: FinancialComparison | null; // null when budgets are missing
  costEntries: JobCostEntryRow[];
  revenueEntries: JobRevenueEntryRow[];
  openAlerts: JobAlertRow[];
  openExceptions: OpenScheduleException[]; // this job's only
  overrides: ForecastOverrideRow[];
  changeOrders: Array<{
    id: string;
    change_order_number: number;
    status: string;
    current_version: number;
    created_by_name: string;
    created_at: string;
  }>;
  jobEvents: Array<{
    id: number;
    stage_from: number | null;
    stage_to: number | null;
    function_name: string | null;
    action_summary: string | null;
    status: string | null;
    created_at: string;
  }>;
  // job_events live columns verified 2026-08-26: id bigint, stage_from/stage_to INTEGER
  // (pipeline stage numbers, not names), created_at timestamptz.
  estimateHref: string | null; // `/estimates/${original_estimate_id}` when linked
}

// ------------------------------------------------------------
// Shared constants / small helpers
// ------------------------------------------------------------

const JOB_NUMBER_RE = /^JOB-\d+$/;

/** Exact `JobRow` column set — no `select("*")` here, since selecting `*`
 *  would also pull in the legacy Airtable-era columns CLAUDE.md says not
 *  to write, and this repo only ever reads what `JobRow` declares. */
const JOB_COLUMNS =
  "job_number, status_v2, financial_status, client_name, client_contact_name, business_name, " +
  "client_type, client_phone, job_address, city, crew, start_date, end_date, start_time, " +
  "scope_summary, original_estimate_id, original_estimate_number, current_budget_version, " +
  "cancelled_at, cancellation_reason, last_forecast_at, updated_at";

const CHANGE_ORDER_COLUMNS = "id, change_order_number, status, current_version, created_by_name, created_at";

const JOB_EVENT_COLUMNS = "id, stage_from, stage_to, function_name, action_summary, status, created_at";

/** Severity ordering for `nextAction`'s highest-severity-open-alert pick:
 *  at_risk is most urgent (0), on_track least (2). Mirrors
 *  `statusSortRank`'s own health ordering in jobs/map.ts. */
const ALERT_SEVERITY_RANK: Record<HealthStatus, number> = {
  at_risk: 0,
  watch: 1,
  on_track: 2,
};

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/** Groups rows by `job_number`, dropping any row with a null job_number
 *  (job_cost_entries.job_number is nullable for unassigned expenses,
 *  which by construction never match a real `.in("job_number", numbers)`
 *  filter anyway — this guard is belt-and-suspenders for the type, not a
 *  behavior change). */
function groupByJobNumber<T extends { job_number: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (row.job_number === null) continue;
    const list = map.get(row.job_number);
    if (list) list.push(row);
    else map.set(row.job_number, [row]);
  }
  return map;
}

/** Latest ISO timestamp string in `values`, or `null` for an empty list —
 *  the "max(...)" half of `SnapshotWatermarks`'s cost/revenue/override
 *  watermarks. */
function maxTimestamp(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((latest, candidate) =>
    new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest,
  );
}

// ------------------------------------------------------------
// Local normalizers — jobs/map.ts exports no normalizer for these two
// row shapes (see that module's `coerceNullableNum` doc comment: "this
// module has no dedicated normalizer for override/checklist rows"), so
// every numeric field read from them for display (as opposed to being
// passed straight into `buildJobHealthInput`, which self-coerces) is
// coerced here with `toNullableNum`.
// ------------------------------------------------------------

function normalizeOverrideRow(raw: Record<string, unknown>): ForecastOverrideRow {
  return {
    id: raw.id as string,
    job_number: raw.job_number as string,
    category: (raw.category as CostCategory | null) ?? null,
    remaining_workdays: toNullableNum(raw.remaining_workdays),
    expected_crew_size: toNullableNum(raw.expected_crew_size),
    hours_per_day: toNullableNum(raw.hours_per_day),
    expected_remaining_cost: toNullableNum(raw.expected_remaining_cost),
    reason: raw.reason as string,
    created_by_name: raw.created_by_name as string,
    created_at: raw.created_at as string,
  };
}

function normalizeAlertRow(raw: Record<string, unknown>): JobAlertRow {
  return {
    id: raw.id as string,
    job_number: raw.job_number as string,
    fingerprint: raw.fingerprint as string,
    severity: raw.severity as HealthStatus,
    title: raw.title as string,
    message: raw.message as string,
    action_path: raw.action_path as string,
    opened_at: raw.opened_at as string,
  };
}

/** `job_schedule_exceptions` -> `OpenScheduleException`, mirroring the
 *  PRIVATE `normalizeOpenScheduleException`/`normalizePreviousSchedule`
 *  helpers in exceptionActions.ts (not exported, so duplicated here —
 *  same self-containment precedent that file's own UUID_RE/DATE_RE
 *  duplication follows). */
function normalizePreviousSchedule(raw: unknown): PreviousSchedule {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    crew: (r.crew as string | null) ?? null,
    start_date: (r.start_date as string | null) ?? null,
    end_date: (r.end_date as string | null) ?? null,
    gcal_main_event_id: (r.gcal_main_event_id as string | null) ?? null,
    gcal_crew_event_id: (r.gcal_crew_event_id as string | null) ?? null,
  };
}

function normalizeOpenScheduleException(raw: Record<string, unknown>): OpenScheduleException {
  return {
    id: raw.id as string,
    job_number: raw.job_number as string,
    external_event_id: (raw.external_event_id as string | null) ?? null,
    kind: raw.kind as string,
    previous_schedule: normalizePreviousSchedule(raw.previous_schedule),
    opened_at: raw.opened_at as string,
  };
}

/** Narrow read shape for the latest `job_checklists` row per job — only
 *  the fields `buildJobHealthInput`'s `latestChecklist` arg needs, plus
 *  `submitted_at` for the freshness watermark. Numeric fields coerced for
 *  the same reason as `normalizeOverrideRow` above. */
interface LatestChecklistRow {
  job_number: string;
  submitted_at: string;
  remaining_workdays: number | null;
  expected_crew_size: number | null;
  hours_per_day: number | null;
}

function normalizeChecklistRow(raw: Record<string, unknown>): LatestChecklistRow {
  return {
    job_number: raw.job_number as string,
    submitted_at: raw.submitted_at as string,
    remaining_workdays: toNullableNum(raw.remaining_workdays),
    expected_crew_size: toNullableNum(raw.expected_crew_size),
    hours_per_day: toNullableNum(raw.hours_per_day),
  };
}

interface ChangeOrderRow {
  id: string;
  change_order_number: number;
  status: string;
  current_version: number;
  created_by_name: string;
  created_at: string;
}

function normalizeChangeOrderRow(raw: Record<string, unknown>): ChangeOrderRow {
  return {
    id: raw.id as string,
    change_order_number: toNum(raw.change_order_number),
    status: raw.status as string,
    current_version: toNum(raw.current_version),
    created_by_name: raw.created_by_name as string,
    created_at: raw.created_at as string,
  };
}

interface JobEventRow {
  id: number;
  stage_from: number | null;
  stage_to: number | null;
  function_name: string | null;
  action_summary: string | null;
  status: string | null;
  created_at: string;
}

/** `id` is `bigint` — PostgREST/supabase-js returns bigint columns as
 *  STRINGS to avoid precision loss, so it needs the same `toNum` coercion
 *  as every other numeric-over-the-wire column in this app.
 *  `stage_from`/`stage_to` are plain `integer` (arrive as real numbers
 *  already) but are coerced anyway for consistency with the rest of this
 *  module's defensive posture. */
function normalizeJobEventRow(raw: Record<string, unknown>): JobEventRow {
  return {
    id: toNum(raw.id),
    stage_from: toNullableNum(raw.stage_from),
    stage_to: toNullableNum(raw.stage_to),
    function_name: (raw.function_name as string | null) ?? null,
    action_summary: (raw.action_summary as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    created_at: raw.created_at as string,
  };
}

// ------------------------------------------------------------
// listJobHealthSummaries
// ------------------------------------------------------------

/** Applies one `DashboardFilter`'s where-clause to a `jobs` query.
 *  Exhaustive `switch` — a `never`-typed default makes an unhandled
 *  filter value a compile error, not a silently-empty result set. */
function applyDashboardFilter(
  query: ReturnType<ReturnType<SupabaseAdmin["from"]>["select"]>,
  filter: DashboardFilter,
) {
  switch (filter) {
    case "active":
      return query.in("status_v2", ["scheduled", "in_progress"]);
    case "completed":
      return query
        .in("status_v2", ["completed", "paid"])
        .not(
          "financial_status",
          "in",
          "(financially_closed,reconciliation_required,invoice_review,invoice_sent,paid_reconciliation_pending)",
        );
    case "invoice_reconciliation":
      return query.in("financial_status", ["invoice_review", "invoice_sent", "paid_reconciliation_pending"]);
    case "financially_closed":
      return query.eq("financial_status", "financially_closed");
    case "reconciliation_required":
      return query.eq("financial_status", "reconciliation_required");
    case "cancelled":
      return query.eq("status_v2", "cancelled");
    default: {
      const exhaustive: never = filter;
      throw new Error(`applyDashboardFilter: unhandled filter ${String(exhaustive)}`);
    }
  }
}

/** Highest-severity open alert's `{title, action_path}` -> `{label, href}`,
 *  else an open exception's fixed queue link, else `null`. Severity order
 *  at_risk > watch > on_track; newest (`opened_at` desc) first within a
 *  tied severity. */
function pickNextAction(
  openAlerts: JobAlertRow[],
  openExceptionCount: number,
): { label: string; href: string } | null {
  if (openAlerts.length > 0) {
    const top = [...openAlerts].sort((a, b) => {
      const rankDiff = ALERT_SEVERITY_RANK[a.severity] - ALERT_SEVERITY_RANK[b.severity];
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime();
    })[0];
    return { label: top.title, href: top.action_path };
  }
  if (openExceptionCount > 0) {
    return { label: "Resolve schedule exception", href: "/jobs/exceptions" };
  }
  return null;
}

/**
 * One `jobs` select scoped by `filter`, then batched parallel loads for
 * the returned job numbers — never a per-job query loop. Performs NO
 * writes (snapshot persistence belongs to `getJobHealthDetail` alone, so
 * a dashboard render never fans out N inserts).
 *
 * `job_budget_versions` is fetched WITHOUT a version filter (one
 * `.in("job_number", numbers)` query can't apply a different `version`
 * value per job), so the batch naturally includes every version for
 * every job in view — "current+v1" per the brief, since v1 is always
 * among them. `currentBudget` is then picked in memory as the row whose
 * `version` matches the job's `current_budget_version`.
 */
export async function listJobHealthSummaries(filter: DashboardFilter): Promise<JobHealthSummary[]> {
  const admin = createAdminClient();

  const jobsQuery = applyDashboardFilter(admin.from("jobs").select(JOB_COLUMNS), filter);
  const { data: jobRows, error: jobsError } = await jobsQuery;
  if (jobsError) {
    throw new Error(`listJobHealthSummaries: jobs query failed: ${jobsError.message}`);
  }

  const jobs = ((jobRows as Record<string, unknown>[] | null) ?? []).map(normalizeJobRow);
  if (jobs.length === 0) return [];

  const jobNumbers = jobs.map((j) => j.job_number);

  const [budgetsResult, costEntriesResult, overridesResult, alertsResult, exceptionsResult, checklistsResult] =
    await Promise.all([
      admin.from("job_budget_versions").select("*").in("job_number", jobNumbers),
      admin.from("job_cost_entries").select("*").in("job_number", jobNumbers),
      admin
        .from("job_forecast_overrides")
        .select("*")
        .in("job_number", jobNumbers)
        .order("created_at", { ascending: false }),
      admin.from("job_alerts").select("*").in("job_number", jobNumbers).is("resolved_at", null),
      admin
        .from("job_schedule_exceptions")
        .select("id, job_number, external_event_id, kind, previous_schedule, opened_at")
        .in("job_number", jobNumbers)
        .eq("status", "open")
        .eq("kind", "calendar_deleted"),
      admin
        .from("job_checklists")
        .select("job_number, submitted_at, remaining_workdays, expected_crew_size, hours_per_day")
        .in("job_number", jobNumbers)
        .order("submitted_at", { ascending: false }),
    ]);

  if (budgetsResult.error) {
    throw new Error(`listJobHealthSummaries: budget versions query failed: ${budgetsResult.error.message}`);
  }
  if (costEntriesResult.error) {
    throw new Error(`listJobHealthSummaries: cost entries query failed: ${costEntriesResult.error.message}`);
  }
  if (overridesResult.error) {
    throw new Error(`listJobHealthSummaries: forecast overrides query failed: ${overridesResult.error.message}`);
  }
  if (alertsResult.error) {
    throw new Error(`listJobHealthSummaries: alerts query failed: ${alertsResult.error.message}`);
  }
  if (exceptionsResult.error) {
    throw new Error(`listJobHealthSummaries: schedule exceptions query failed: ${exceptionsResult.error.message}`);
  }
  if (checklistsResult.error) {
    throw new Error(`listJobHealthSummaries: checklists query failed: ${checklistsResult.error.message}`);
  }

  const budgetsByJob = groupByJobNumber(
    ((budgetsResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeBudgetRow),
  );
  const costEntriesByJob = groupByJobNumber(
    ((costEntriesResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeCostEntryRow),
  );
  const overridesByJob = groupByJobNumber(
    ((overridesResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeOverrideRow),
  );
  const alertsByJob = groupByJobNumber(
    ((alertsResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeAlertRow),
  );
  const exceptionsByJob = groupByJobNumber(
    ((exceptionsResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeOpenScheduleException),
  );
  // Sorted submitted_at desc, so the first row seen per job is the latest.
  const latestChecklistByJob = new Map<string, LatestChecklistRow>();
  for (const raw of (checklistsResult.data as Record<string, unknown>[] | null) ?? []) {
    const row = normalizeChecklistRow(raw);
    if (!latestChecklistByJob.has(row.job_number)) latestChecklistByJob.set(row.job_number, row);
  }

  const summaries: JobHealthSummary[] = jobs.map((job) => {
    const budgets = budgetsByJob.get(job.job_number) ?? [];
    const currentBudget = budgets.find((b) => b.version === job.current_budget_version) ?? null;
    const costEntries = costEntriesByJob.get(job.job_number) ?? [];
    const overrides = overridesByJob.get(job.job_number) ?? [];
    const openAlerts = alertsByJob.get(job.job_number) ?? [];
    const openExceptions = exceptionsByJob.get(job.job_number) ?? [];
    const latestChecklist = latestChecklistByJob.get(job.job_number) ?? null;
    const unresolvedScopeChange = openAlerts.some((a) => a.fingerprint.startsWith("scope-change:"));

    const ledger = rollupLedger(costEntries);

    let healthInput: JobHealthInput | null = null;
    let health: JobHealthResult | null = null;
    if (isEngineScorable(job.status_v2) && currentBudget !== null) {
      healthInput = buildJobHealthInput({
        job,
        currentBudget,
        ledger,
        overrides,
        latestChecklistSubmittedAt: latestChecklist?.submitted_at ?? null,
        latestChecklist: latestChecklist
          ? {
              remaining_workdays: latestChecklist.remaining_workdays,
              expected_crew_size: latestChecklist.expected_crew_size,
              hours_per_day: latestChecklist.hours_per_day,
            }
          : null,
        unresolvedScopeChange,
      });
      health = calculateJobHealth(healthInput);
    }

    return {
      job,
      health: health?.health ?? null,
      confidence: health?.confidence ?? null,
      forecastProfit: health?.forecastProfit ?? null,
      forecastProfitPct: health?.forecastProfitPct ?? null,
      approvedRevenue: currentBudget?.approved_revenue ?? null,
      forecastHours: health?.forecastHours ?? null,
      budgetHours: currentBudget?.productive_hours ?? null,
      crewDaysRemaining: crewDaysRemaining(health, healthInput),
      leadingReason: health?.reasons[0] ?? null,
      openAlertCount: openAlerts.length,
      openExceptionCount: openExceptions.length,
      nextAction: pickNextAction(openAlerts, openExceptions.length),
      sortRank: statusSortRank(job, health?.health ?? null),
    };
  });

  summaries.sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    const aDate = a.job.start_date;
    const bDate = b.job.start_date;
    if (aDate === bDate) return 0;
    if (aDate === null) return 1; // nulls last
    if (bDate === null) return -1;
    return aDate < bDate ? -1 : 1;
  });

  return summaries;
}

// ------------------------------------------------------------
// getJobHealthDetail
// ------------------------------------------------------------

/** Round-trips the `job_forecast_snapshots.input_watermarks` jsonb column
 *  back into a `SnapshotWatermarks`, defensively coercing `budgetVersion`
 *  (the one numeric field) the same way every other numeric-over-the-wire
 *  value in this app is coerced, even though a jsonb column round-trips
 *  numbers natively — belt and suspenders against any drift in how the
 *  value was originally written. */
function parseSnapshotWatermarks(raw: unknown): SnapshotWatermarks {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    budgetVersion: toNum(r.budgetVersion),
    costWatermark: (r.costWatermark as string | null) ?? null,
    revenueWatermark: (r.revenueWatermark as string | null) ?? null,
    checklistWatermark: (r.checklistWatermark as string | null) ?? null,
    overrideWatermark: (r.overrideWatermark as string | null) ?? null,
  };
}

/**
 * Best-effort forecast-snapshot persistence — the v2-doc Step 2 rule,
 * exactly: build the current watermark tuple, read the latest snapshot's
 * watermarks, and insert a new snapshot (+ bump `jobs.last_forecast_at`)
 * ONLY when they differ. Never updates or deletes an existing snapshot
 * (append-only by DB trigger). Any failure anywhere in this function is
 * caught and `console.error`'d — it must never fail the page read that
 * called it.
 *
 * Only called when the engine actually ran (`health`/`healthInput`/
 * `currentBudget` all non-null) — `getJobHealthDetail` gates the call
 * site, not this function, so the "AND the engine ran" half of the rule
 * is enforced by construction rather than re-checked here.
 */
async function persistForecastSnapshotIfStale(
  admin: SupabaseAdmin,
  jobNumber: string,
  currentBudget: JobBudgetVersionRow,
  health: JobHealthResult,
  costEntries: JobCostEntryRow[],
  revenueEntries: JobRevenueEntryRow[],
  overrides: ForecastOverrideRow[],
  latestChecklistSubmittedAt: string | null,
): Promise<void> {
  try {
    const currentWatermarks: SnapshotWatermarks = {
      budgetVersion: currentBudget.version,
      costWatermark: maxTimestamp(costEntries.map((e) => e.updated_at)),
      revenueWatermark: maxTimestamp(revenueEntries.map((e) => e.created_at)),
      checklistWatermark: latestChecklistSubmittedAt,
      overrideWatermark: maxTimestamp(overrides.map((o) => o.created_at)),
    };

    const { data: latestSnapshot, error: latestSnapshotError } = await admin
      .from("job_forecast_snapshots")
      .select("input_watermarks")
      .eq("job_number", jobNumber)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestSnapshotError) {
      throw new Error(`snapshot watermark read failed: ${latestSnapshotError.message}`);
    }

    const latestWatermarks = latestSnapshot ? parseSnapshotWatermarks(latestSnapshot.input_watermarks) : null;

    if (watermarksEqual(latestWatermarks, currentWatermarks)) {
      return; // Watermarks unchanged since the last snapshot — nothing to do.
    }

    const { error: insertError } = await admin.from("job_forecast_snapshots").insert({
      job_number: jobNumber,
      health: health.health,
      confidence: health.confidence,
      approved_revenue: currentBudget.approved_revenue,
      forecast_cost: health.forecastCost,
      forecast_profit: health.forecastProfit,
      forecast_profit_pct: health.forecastProfitPct,
      profit_retention_pct: health.profitRetentionPct,
      forecast_hours: health.forecastHours,
      reasons: health.reasons,
      input_watermarks: currentWatermarks,
    });
    if (insertError) {
      throw new Error(`snapshot insert failed: ${insertError.message}`);
    }

    const { error: updateError } = await admin
      .from("jobs")
      .update({ last_forecast_at: new Date().toISOString() })
      .eq("job_number", jobNumber);
    if (updateError) {
      throw new Error(`jobs.last_forecast_at update failed: ${updateError.message}`);
    }
  } catch (e) {
    console.error(`getJobHealthDetail: forecast snapshot persistence failed for ${jobNumber}:`, e);
  }
}

/**
 * All `JobHealthDetail` inputs for one job, loaded in parallel, plus
 * best-effort forecast-snapshot persistence (see
 * `persistForecastSnapshotIfStale`). Returns `null` when `jobNumber` is
 * malformed (fails `/^JOB-\d+$/`) or the job doesn't exist — both render
 * as the page's 404-style not-found, so neither is distinguished from
 * the other in the return value.
 */
export async function getJobHealthDetail(jobNumber: string): Promise<JobHealthDetail | null> {
  if (!JOB_NUMBER_RE.test(jobNumber)) return null;

  const admin = createAdminClient();

  const { data: jobRow, error: jobError } = await admin
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("job_number", jobNumber)
    .maybeSingle();

  if (jobError) {
    throw new Error(`getJobHealthDetail: job query failed: ${jobError.message}`);
  }
  if (!jobRow) return null;

  const job = normalizeJobRow(jobRow as unknown as Record<string, unknown>);

  const [
    budgetsResult,
    costEntriesResult,
    revenueEntriesResult,
    overridesResult,
    alertsResult,
    exceptionsResult,
    checklistResult,
    changeOrdersResult,
    jobEventsResult,
  ] = await Promise.all([
    admin.from("job_budget_versions").select("*").eq("job_number", jobNumber),
    admin.from("job_cost_entries").select("*").eq("job_number", jobNumber),
    admin.from("job_revenue_entries").select("*").eq("job_number", jobNumber),
    admin
      .from("job_forecast_overrides")
      .select("*")
      .eq("job_number", jobNumber)
      .order("created_at", { ascending: false }),
    admin.from("job_alerts").select("*").eq("job_number", jobNumber).is("resolved_at", null),
    admin
      .from("job_schedule_exceptions")
      .select("id, job_number, external_event_id, kind, previous_schedule, opened_at")
      .eq("job_number", jobNumber)
      .eq("status", "open")
      .eq("kind", "calendar_deleted"),
    admin
      .from("job_checklists")
      .select("job_number, submitted_at, remaining_workdays, expected_crew_size, hours_per_day")
      .eq("job_number", jobNumber)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("change_orders").select(CHANGE_ORDER_COLUMNS).eq("job_number", jobNumber).order("created_at", {
      ascending: false,
    }),
    admin
      .from("job_events")
      .select(JOB_EVENT_COLUMNS)
      .eq("job_number", jobNumber)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (budgetsResult.error) {
    throw new Error(`getJobHealthDetail: budget versions query failed: ${budgetsResult.error.message}`);
  }
  if (costEntriesResult.error) {
    throw new Error(`getJobHealthDetail: cost entries query failed: ${costEntriesResult.error.message}`);
  }
  if (revenueEntriesResult.error) {
    throw new Error(`getJobHealthDetail: revenue entries query failed: ${revenueEntriesResult.error.message}`);
  }
  if (overridesResult.error) {
    throw new Error(`getJobHealthDetail: forecast overrides query failed: ${overridesResult.error.message}`);
  }
  if (alertsResult.error) {
    throw new Error(`getJobHealthDetail: alerts query failed: ${alertsResult.error.message}`);
  }
  if (exceptionsResult.error) {
    throw new Error(`getJobHealthDetail: schedule exceptions query failed: ${exceptionsResult.error.message}`);
  }
  if (checklistResult.error) {
    throw new Error(`getJobHealthDetail: checklist query failed: ${checklistResult.error.message}`);
  }
  if (changeOrdersResult.error) {
    throw new Error(`getJobHealthDetail: change orders query failed: ${changeOrdersResult.error.message}`);
  }
  if (jobEventsResult.error) {
    throw new Error(`getJobHealthDetail: job events query failed: ${jobEventsResult.error.message}`);
  }

  const budgets = ((budgetsResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeBudgetRow);
  const originalBudget = budgets.find((b) => b.version === 1) ?? null;
  const currentBudget = budgets.find((b) => b.version === job.current_budget_version) ?? null;

  const costEntries = ((costEntriesResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeCostEntryRow);
  const revenueEntries = ((revenueEntriesResult.data as Record<string, unknown>[] | null) ?? []).map(
    normalizeRevenueEntryRow,
  );
  const overrides = ((overridesResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeOverrideRow);
  const openAlerts = ((alertsResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeAlertRow);
  const openExceptions = ((exceptionsResult.data as Record<string, unknown>[] | null) ?? []).map(
    normalizeOpenScheduleException,
  );
  const latestChecklist = checklistResult.data ? normalizeChecklistRow(checklistResult.data) : null;
  const changeOrders = ((changeOrdersResult.data as Record<string, unknown>[] | null) ?? []).map(
    normalizeChangeOrderRow,
  );
  const jobEvents = ((jobEventsResult.data as Record<string, unknown>[] | null) ?? []).map(normalizeJobEventRow);

  const unresolvedScopeChange = openAlerts.some((a) => a.fingerprint.startsWith("scope-change:"));
  const ledger = rollupLedger(costEntries);

  let healthInput: JobHealthInput | null = null;
  let health: JobHealthResult | null = null;
  if (isEngineScorable(job.status_v2) && currentBudget !== null) {
    healthInput = buildJobHealthInput({
      job,
      currentBudget,
      ledger,
      overrides,
      latestChecklistSubmittedAt: latestChecklist?.submitted_at ?? null,
      latestChecklist: latestChecklist
        ? {
            remaining_workdays: latestChecklist.remaining_workdays,
            expected_crew_size: latestChecklist.expected_crew_size,
            hours_per_day: latestChecklist.hours_per_day,
          }
        : null,
      unresolvedScopeChange,
    });
    health = calculateJobHealth(healthInput);
  }

  const comparison: FinancialComparison | null =
    originalBudget !== null && currentBudget !== null
      ? buildFinancialComparison({ originalBudget, currentBudget, ledger, revenueEntries, health })
      : null;

  // Snapshot persistence — best-effort, only when the engine actually
  // ran (health/currentBudget both non-null). Never blocks or fails this
  // read; see persistForecastSnapshotIfStale's own doc comment.
  if (health !== null && currentBudget !== null) {
    await persistForecastSnapshotIfStale(
      admin,
      jobNumber,
      currentBudget,
      health,
      costEntries,
      revenueEntries,
      overrides,
      latestChecklist?.submitted_at ?? null,
    );
  }

  return {
    job,
    originalBudget,
    currentBudget,
    healthInput,
    health,
    comparison,
    costEntries,
    revenueEntries,
    openAlerts,
    openExceptions,
    overrides,
    changeOrders,
    jobEvents,
    estimateHref: job.original_estimate_id ? `/estimates/${job.original_estimate_id}` : null,
  };
}
