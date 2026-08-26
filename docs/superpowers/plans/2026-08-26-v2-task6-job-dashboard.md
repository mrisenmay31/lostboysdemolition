# v2 Task 6 — Job Dashboard and Live Job Profitability Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Job Dashboard at `/jobs` and the per-job profitability detail at `/jobs/[jobNumber]` — Dane's live original-vs-current-vs-actual-vs-forecast view — plus the Task-6-assigned deferred fixes (server-action consolidation, cancel/postpone UI with the estimator gate, exception-list filter, alert resolution path).

**Architecture:** Pure mapping/normalization/presentation math lives in a new `web/src/lib/jobs/map.ts` (unit-tested, no I/O). A new `web/src/lib/jobs/healthRepo.ts` runs the service-role aggregate queries, feeds the existing pure `calculateJobHealth()` engine (v2 Task 3), and persists `job_forecast_snapshots` rows only when input watermarks change. Two new server-rendered routes consume it. All mutations stay behind server actions in `web/src/app/(app)/jobs/actions.ts` that re-validate the picker name against the fixed estimator allowlist before anything reaches a service-role client.

**Tech Stack:** Next.js 16 App Router (server components, server actions), React 19, TypeScript 5 strict, Tailwind CSS 4, Zod 4, Vitest 4, Supabase Postgres via `createAdminClient()`. **No new migrations — this task is web-only.** No edge-function changes.

**Spec:** `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` → Task 6 (as amended 2026-08-25 home-surface decision and 2026-08-26 ported prototype decisions), plus the Session 10 deferral ledger items assigned "For v2 Task 6 specifically" (`BUILD_LOG.md` 2026-08-25 Session 10 entry / `NEXT_SESSION_PROMPT.md` Deferred section).

## Global Constraints

- **No "portfolio" terminology anywhere** — user-facing copy, code identifiers, comments, commit messages. The surface is the **Job Dashboard** (ratified 2026-08-21).
- **`payment_processing` is a capture-only category.** It is EXCLUDED from the Total Direct Costs subtotal and rendered below Gross Profit as "Processing Fees" (ratified 2026-08-21; presentation block in v2 doc Task 6 → Step 4). The locked presentation:
  ```
  Total Revenue
    − Total Direct Costs   (direct_labor, materials, rentals, dump, subcontractors, other_direct)
    = Gross Profit
    − Overhead Allocation  (productive hours × overhead rate)
    − Processing Fees      (payment_processing, its own line)
    = Job Profit
    Job Profit Margin = Job Profit ÷ Total Revenue
  ```
- **The `/` redirect to `/estimates` stays untouched** — the `/` flip to the dashboard is v2 Task 8 (owner auth). This task adds `/jobs` and a nav link only (`BUILD_PLAN.md` 2026-08-25 amendment).
- **No login exists.** Every server action re-validates the picker-declared name with `isEstimatorName()` from `@/lib/estimator` before calling any lib function; `p_actor`/`actor_id` is always `null`; the name is the durable attribution.
- **No pricing on crew-facing surfaces.** Everything this task builds is a Dane/office surface — but `_components` under `(app)/jobs` must not be structured for reuse by the future `/ops` routes (v2 doc: "Never render sensitive financial values in components reused by `/ops`"). Keep them under `(app)/jobs/[jobNumber]/_components/`, never in a shared components dir.
- Money display via `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` (house pattern, `estimates/page.tsx:18`). All money math through `roundToCent()` from `@/lib/pricing` where new arithmetic is introduced.
- Postgres `numeric` columns arrive as **strings** over supabase-js — every read normalizes them (house `toNum`/`toNullableNum` pattern, `lib/jobs/repo.ts:68-74`).
- Every data-reading route sets `export const dynamic = "force-dynamic"` (house pattern).
- Mobile-first: `max-w-lg` single column baseline like the estimate routes, verified at 390×844; the comparison table stacks into category cards at mobile width, no horizontal page scrolling. Desktop verified at 1440×900 (the dashboard grid may widen to `max-w-5xl`).
- Tailwind zinc palette with `dark:` variants throughout (house style).
- **Do not touch:** `jobs.status` (legacy enum — the live `trigger_push_to_airtable_on_archive` watches it), legacy tables (`users`/`crews`/`time_entries`), `_shared/pricing.ts`, any estimate table, any edge function.
- Suites gate: `cd web && npm test -- --run` (all, currently 604), `npm run lint`, `npm run build`, and repo-root `deno task test` (411, golden-321 intact — must be untouched by a web-only task).
- Each task ends in a focused commit; adversarial review per task plus a whole-branch review before merge (standing execution model). Merge to main / production deploy is Matt's call.

## Existing interfaces this plan consumes (verbatim, already on main)

```ts
// @/lib/profitability/types
export type CostCategory = "direct_labor" | "materials" | "rentals" | "dump"
  | "subcontractors" | "other_direct" | "payment_processing";
export type HealthStatus = "on_track" | "watch" | "at_risk";
export type ForecastConfidence = "high" | "medium" | "low";
export interface CategoryAmounts { /* one number per CostCategory key */ }
export interface JobHealthInput { /* see file — 25 fields */ }
export interface JobHealthResult {
  health: HealthStatus; confidence: ForecastConfidence; forecastHours: number;
  forecastCategoryCost: CategoryAmounts; forecastAllocatedOverhead: number;
  forecastCost: number; forecastProfit: number; forecastProfitPct: number;
  profitRetentionPct: number; reasons: string[];
}
export const COST_CATEGORIES: readonly CostCategory[];

// @/lib/profitability/calculateJobHealth
export function calculateJobHealth(input: JobHealthInput, now?: Date): JobHealthResult;

// @/lib/jobs/scheduleActions (server-only)
export type CancelResolution = "postponed" | "closed_lost";
export interface CancelScheduledJobInput { jobNumber: string; resolution: CancelResolution; reason: string; actorName: string; }
export type CancelJobErrorCode = "not_found" | "not_cancellable" | "invalid_input" | "other";
export interface CancelledJob { job_number: string; status_v2: string; cancelled_at: string | null; cancellation_reason: string | null; crew: string | null; start_date: string | null; end_date: string | null; }
export async function cancelScheduledJob(input: CancelScheduledJobInput): Promise<CancelledJob>; // throws CancelScheduledJobError

// @/lib/jobs/exceptionActions (server-only)
export interface OpenScheduleException { id: string; job_number: string; external_event_id: string | null; kind: string; previous_schedule: PreviousSchedule; opened_at: string; }
export async function listOpenScheduleExceptions(): Promise<OpenScheduleException[]>;
export async function resolveDeletedCalendarEvent(input: ResolveDeletedCalendarEventInput): Promise<ResolvedException>; // throws ResolveExceptionError
export function friendlyResolveErrorMessage(code: ResolveExceptionErrorCode | undefined, rawMessage: string): string;

// @/lib/estimator (pure)
export function isEstimatorName(v: unknown): v is "Dane" | "Jackson" | "Matt";

// @/lib/supabase/admin (server-only)
export function createAdminClient(): SupabaseClient;
```

Relevant live tables (migration `20260819151000_profitability_core_schema.sql`, applied to production): `job_budget_versions` (v1 = original, `current_budget_version` on `jobs` points at current), `job_cost_entries`, `job_revenue_entries`, `job_forecast_overrides`, `job_forecast_snapshots` (append-only, `input_watermarks jsonb`), `job_alerts` (partial-unique open fingerprint, `resolved_at/resolved_by/resolution_note`), `job_schedule_exceptions`, `job_checklists`, `change_orders`/`change_order_versions`/`change_order_approvals`, plus `jobs` columns `original_estimate_id`, `original_estimate_number` (the estimate-family key), `current_budget_version`, `financial_status`, `last_forecast_at`, `cancelled_at`, `cancellation_reason`. All RLS-enabled with no policies — reads/writes go through `createAdminClient()` only.

**Current data reality:** `jobs` holds 5 cancelled TEST rows; `job_cost_entries`/`job_revenue_entries` are empty until Task 7 ships the manual ledger. Every screen must render correctly with zero actuals and with zero jobs in a filter (honest empty states, no fake numbers — see `feedback_fix_known_wrong_numbers_before_review`).

## Concurrency map (Matt's standing directive — lanes designed in up front)

| Lane | Tasks | Owns (exclusive) | Can run alongside |
|---|---|---|---|
| A — pure mapping | Task 1 | `web/src/lib/jobs/map.ts`, `web/src/lib/jobs/__tests__/map.test.ts` | D |
| B — data layer | Task 2 | `web/src/lib/jobs/healthRepo.ts` | C, D (after A lands — consumes A's types) |
| C — UI | Tasks 3–4 | `web/src/app/(app)/jobs/page.tsx`, `web/src/app/(app)/jobs/[jobNumber]/**`, `web/src/app/(app)/layout.tsx` | B, D (after A lands — wires against A/B/D signatures specified verbatim below) |
| D — actions + deferred fixes | Task 5 | `web/src/app/(app)/jobs/actions.ts`, `web/src/app/(app)/jobs/__tests__/actions.test.ts`, `web/src/app/(app)/jobs/exceptions/page.tsx`, `web/src/app/(app)/jobs/exceptions/ResolveExceptionForm.tsx`, `web/src/lib/jobs/exceptionActions.ts`, `web/src/lib/jobs/alertActions.ts`, `web/src/lib/jobs/__tests__/alertActions.test.ts` | A, B, C |
| — | Task 6 | integration verification (orchestrator, serial at the end) | — |

Serialization boundaries honored: A defines the types B and C consume (interface-first, then fan out). D never touches A/B/C files; C consumes D's server-action signatures as fixed contracts written in this plan. Each lane runs only its own tests while siblings are mid-flight; the orchestrator runs the full suites once at Task 6.

---

### Task 1 (Lane A): Pure mapping, rollup, comparison, and sorting — `map.ts`

**Files:**
- Create: `web/src/lib/jobs/map.ts`
- Test: `web/src/lib/jobs/__tests__/map.test.ts`

**Interfaces:**
- Consumes: `CategoryAmounts`, `CostCategory`, `COST_CATEGORIES`, `HealthStatus`, `JobHealthInput`, `JobHealthResult` from `@/lib/profitability/types`; `roundToCent` from `@/lib/pricing`. Nothing else — this module is PURE, no `server-only`, no I/O, no supabase import.
- Produces (Tasks 2–4 rely on these exact names):

```ts
export function toNum(value: unknown): number;                    // numeric-string coercion
export function toNullableNum(value: unknown): number | null;

export interface JobRow {                    // normalized `jobs` row (superset of what pages render)
  job_number: string;
  status_v2: string;
  financial_status: string;
  client_name: string | null;
  client_contact_name: string | null;
  business_name: string | null;
  client_type: string | null;
  client_phone: string | null;
  job_address: string | null;
  city: string | null;
  crew: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  scope_summary: string | null;
  original_estimate_id: string | null;
  original_estimate_number: number | null;
  current_budget_version: number | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  last_forecast_at: string | null;
  updated_at: string;
}
export function normalizeJobRow(raw: Record<string, unknown>): JobRow;

export interface JobBudgetVersionRow {
  id: string; job_number: string; version: number;
  source_estimate_id: string | null; source_change_order_version_id: string | null;
  approved_revenue: number; productive_hours: number;
  direct_labor_cost: number; materials_cost: number; rentals_cost: number;
  dump_cost: number; subcontractors_cost: number; other_direct_cost: number;
  allocated_overhead: number; payment_processing_cost: number;
  planned_economic_profit: number; planned_profit_pct: number;
  overhead_rate: number; labor_rate: number;
  created_by_name: string; created_at: string;
}
export function normalizeBudgetRow(raw: Record<string, unknown>): JobBudgetVersionRow;

export interface JobCostEntryRow {
  id: string; job_number: string | null; category: CostCategory;
  state: "provisional" | "committed" | "approved" | "void";
  reconciliation_state: string;
  amount: number; quantity: number | null;
  employee_name: string | null; vendor_name: string | null;
  incurred_at: string; source_system: string; updated_at: string;
}
export function normalizeCostEntryRow(raw: Record<string, unknown>): JobCostEntryRow;

export interface JobRevenueEntryRow {
  id: string; job_number: string;
  entry_type: "approved_contract" | "invoice" | "credit" | "refund" | "payment";
  amount: number; occurred_at: string; source_system: string; created_at: string;
}
export function normalizeRevenueEntryRow(raw: Record<string, unknown>): JobRevenueEntryRow;

export interface JobAlertRow {
  id: string; job_number: string; fingerprint: string; severity: HealthStatus;
  title: string; message: string; action_path: string; opened_at: string;
}
export interface ForecastOverrideRow {
  id: string; job_number: string; category: CostCategory | null;
  remaining_workdays: number | null; expected_crew_size: number | null;
  hours_per_day: number | null; expected_remaining_cost: number | null;
  reason: string; created_by_name: string; created_at: string;
}

export function emptyCategoryAmounts(): CategoryAmounts;   // fresh object, all 7 keys 0

export interface LedgerRollup {
  approved: CategoryAmounts;
  provisional: CategoryAmounts;
  committed: CategoryAmounts;
  approvedHours: number;        // Σ quantity of approved direct_labor entries (null quantity → 0)
  provisionalHours: number;     // Σ quantity of provisional direct_labor entries
  timeUpdatedAt: string | null;     // max updated_at across direct_labor entries
  expenseUpdatedAt: string | null;  // max updated_at across non-labor entries
  needsReviewCount: number;         // entries with reconciliation_state === "needs_review"
}
export function rollupLedger(entries: JobCostEntryRow[]): LedgerRollup;
// Rules: state "void" and reconciliation_state "excluded" rows are skipped entirely.
// Everything else buckets by state into the three CategoryAmounts.

export function budgetToCategoryAmounts(budget: JobBudgetVersionRow): CategoryAmounts;
// direct_labor_cost→direct_labor, materials_cost→materials, rentals_cost→rentals,
// dump_cost→dump, subcontractors_cost→subcontractors, other_direct_cost→other_direct,
// payment_processing_cost→payment_processing.  allocated_overhead is NOT a category (engine rule).

export interface BuildHealthInputArgs {
  job: JobRow;
  currentBudget: JobBudgetVersionRow;
  ledger: LedgerRollup;
  overrides: ForecastOverrideRow[];          // all rows for the job, newest first
  latestChecklistSubmittedAt: string | null; // null until Phase 3
  latestChecklist: { remaining_workdays: number | null; expected_crew_size: number | null; hours_per_day: number | null } | null;
  unresolvedScopeChange: boolean;            // open alert with fingerprint starting "scope-change:"
}
export function buildJobHealthInput(args: BuildHealthInputArgs): JobHealthInput;
// Locked mappings:
//   approvedRevenue/plannedProfit/plannedProfitPct/budgetHours(=productive_hours)/
//   overheadRate/expectedRemainingLaborRate(=labor_rate)/categoryBudget ← currentBudget
//   approvedActual/provisionalActual/committed/approvedHours/provisionalHours/
//   timeUpdatedAt/expenseUpdatedAt ← ledger; unassignedExpenseCount ← ledger.needsReviewCount
//   remainingCostOverrides ← latest override PER category (rows where category != null)
//   remainingWorkdays/expectedCrewSize/hoursPerDay ← the latest labor override
//     (category == null) if one is newer than the latest checklist, else the latest
//     checklist values, else null/null/8 (hoursPerDay defaults 8 when unset)
//   checklistUpdatedAt ← latestChecklistSubmittedAt; jobStatus ← job.status_v2;
//   financialStatus ← job.financial_status; unresolvedScopeChange passed through.

export function statusSortRank(job: Pick<JobRow, "status_v2" | "financial_status">, health: HealthStatus | null): number;
// v2 doc Step 1 ordering, extended for the two terminal buckets:
//   0 at_risk, 1 watch, 2 on_track      (jobs scored by the engine: scheduled/in_progress,
//                                        and completed jobs not yet financially closed keep
//                                        their health rank ONLY while active — see below)
//   3 operationally completed (status_v2 in completed/paid, financial_status != financially_closed)
//   4 financially_closed
//   5 cancelled
// Active (scheduled/in_progress) uses health rank; null health on an active job ranks 2.

export function isEngineScorable(statusV2: string): boolean;
// true for "scheduled" | "in_progress" | "completed" | "paid"; false for "cancelled"
// (the engine accepts all values, but scoring cancelled jobs is the caller's choice to skip —
//  see calculateJobHealth.ts module header)

export interface ComparisonColumnSet {
  original: number; current: number; actualPlusCommitted: number; forecast: number;
}
export interface ComparisonRow extends ComparisonColumnSet { key: string; label: string; }
export interface FinancialComparison {
  totalRevenue: ComparisonRow;
  directRows: ComparisonRow[];       // 6 rows, payment_processing EXCLUDED, engine category order
  totalDirect: ComparisonRow;
  grossProfit: ComparisonRow;
  overheadAllocation: ComparisonRow;
  processingFees: ComparisonRow;     // the payment_processing line, below Gross Profit
  jobProfit: ComparisonRow;
  jobProfitMarginPct: ComparisonColumnSet;  // percentages, 0 when the column's revenue is 0
}
export function buildFinancialComparison(args: {
  originalBudget: JobBudgetVersionRow;
  currentBudget: JobBudgetVersionRow;
  ledger: LedgerRollup;
  revenueEntries: JobRevenueEntryRow[];
  health: JobHealthResult | null;    // null for cancelled jobs → forecast column mirrors actual
}): FinancialComparison;
// Column semantics (locked):
//   original  ← budget v1 columns; revenue = approved_revenue
//   current   ← current budget columns; revenue = approved_revenue
//   actualPlusCommitted ← per category approved+provisional+committed;
//     revenue = Σ invoice + credit + refund entries (economic revenue — payments EXCLUDED);
//     overhead = (approvedHours + provisionalHours) × currentBudget.overhead_rate
//   forecast  ← health.forecastCategoryCost / forecastAllocatedOverhead;
//     revenue = currentBudget.approved_revenue; when health is null, mirror actualPlusCommitted
// Derived rows per column: totalDirect = Σ the 6 non-processing categories;
//   grossProfit = revenue − totalDirect;
//   jobProfit = grossProfit − overheadAllocation − processingFees;
//   marginPct = revenue === 0 ? 0 : roundToCent(jobProfit / revenue × 100).
// All sums via roundToCent.

export interface SnapshotWatermarks {
  budgetVersion: number;
  costWatermark: string | null;      // max job_cost_entries.updated_at
  revenueWatermark: string | null;   // max job_revenue_entries.created_at
  checklistWatermark: string | null; // max job_checklists.submitted_at
  overrideWatermark: string | null;  // max job_forecast_overrides.created_at
}
export function watermarksEqual(a: SnapshotWatermarks | null, b: SnapshotWatermarks): boolean;
// null a (no prior snapshot) → false. Field-by-field strict equality.

export function crewDaysRemaining(health: JobHealthResult | null, input: JobHealthInput | null): number | null;
// null when health is null. Otherwise remainingHours = max(0, forecastHours −
// (input.approvedHours + input.provisionalHours)); divide by
// (expectedCrewSize × hoursPerDay) when both set, else by 40 (ratified prototype
// convention: 1 crew-day = 40 productive hours); round to 1 decimal.
```

- [ ] **Step 1: Write the failing tests**

`web/src/lib/jobs/__tests__/map.test.ts` (vitest, house style of `repo.test.ts`). Cover, with literal fixtures:

```ts
import { describe, expect, it } from "vitest";
import {
  budgetToCategoryAmounts, buildFinancialComparison, buildJobHealthInput,
  crewDaysRemaining, emptyCategoryAmounts, normalizeBudgetRow, normalizeCostEntryRow,
  rollupLedger, statusSortRank, watermarksEqual,
} from "../map";

// 1. Numeric strings: normalizeBudgetRow({ approved_revenue: "2543.51", ... }) → 2543.51 (number),
//    normalizeCostEntryRow quantity "34.00" → 34, null stays null.
// 2. rollupLedger: mixed fixture of 8 entries — approved/provisional/committed across
//    direct_labor (with quantity hours), dump, materials; one "void" state entry and one
//    reconciliation_state "excluded" entry that MUST NOT appear in any bucket; one
//    needs_review entry counted in needsReviewCount; watermarks pick the max updated_at
//    separately for labor vs non-labor.
// 3. budgetToCategoryAmounts maps all 7 columns and does NOT include allocated_overhead anywhere.
// 4. buildJobHealthInput: labor override (category null) newer than checklist wins the
//    remainingWorkdays/expectedCrewSize/hoursPerDay triple; per-category override rows fill
//    remainingCostOverrides with only the LATEST row per category; no checklist + no override
//    → remainingWorkdays null, hoursPerDay 8.
// 5. buildFinancialComparison — THE payment_processing EXCLUSION PROOF:
//    fixture where payment_processing budget = 86.01 and actual = 90;
//    assert totalDirect.original excludes it (equals the sum of the 6 category columns),
//    grossProfit = revenue − totalDirect, processingFees row carries 86.01/90,
//    jobProfit = grossProfit − overheadAllocation − processingFees, margin division-by-zero
//    guard (revenue 0 → 0). Assert directRows has exactly 6 rows and none is payment_processing.
// 6. actualPlusCommitted revenue sums invoice + credit + refund and EXCLUDES payment entries.
// 7. statusSortRank ordering: at_risk(0) < watch(1) < on_track(2) < completed(3)
//    < financially_closed(4) < cancelled(5); active job with null health → 2.
// 8. watermarksEqual: null prior → false; identical → true; one field differing → false.
// 9. crewDaysRemaining: (forecastHours 120, actual 40, crew 2 × 8h) → 5.0;
//    fallback divisor 40 when crew size unset → 2.0; null health → null.
```

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npx vitest run src/lib/jobs/__tests__/map.test.ts`
Expected: FAIL — `map.ts` does not exist.

- [ ] **Step 3: Implement `map.ts`**

Implement exactly the exported surface above. Module header comment names this file as v2 Task 6 Lane A and states the purity rule (no `server-only`, no I/O — imported by both the repo layer and, for types, client components). Iterate categories via `COST_CATEGORIES`, never hand-typed key lists. All money arithmetic through `roundToCent`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/jobs/__tests__/map.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/jobs/map.ts web/src/lib/jobs/__tests__/map.test.ts
git commit -m "feat: add pure job health mapping, ledger rollup, and comparison math"
```

---

### Task 2 (Lane B): Aggregate repository — `healthRepo.ts`

**Files:**
- Create: `web/src/lib/jobs/healthRepo.ts`

**Interfaces:**
- Consumes: everything Task 1 produces; `calculateJobHealth` from `@/lib/profitability/calculateJobHealth`; `createAdminClient` from `@/lib/supabase/admin`; `OpenScheduleException`/`listOpenScheduleExceptions` types from `@/lib/jobs/exceptionActions`.
- Produces (Tasks 3–4 rely on these exact names):

```ts
import "server-only";

export type DashboardFilter =
  | "active"                  // status_v2 in (scheduled, in_progress)
  | "completed"               // status_v2 in (completed, paid) AND financial_status NOT IN (financially_closed, reconciliation_required, invoice_review, invoice_sent, paid_reconciliation_pending)
  | "invoice_reconciliation"  // financial_status in (invoice_review, invoice_sent, paid_reconciliation_pending)
  | "financially_closed"      // financial_status = financially_closed
  | "reconciliation_required" // financial_status = reconciliation_required
  | "cancelled";              // status_v2 = cancelled

export interface JobHealthSummary {
  job: JobRow;
  health: HealthStatus | null;
  confidence: ForecastConfidence | null;
  forecastProfit: number | null;
  forecastProfitPct: number | null;
  approvedRevenue: number | null;      // current budget; null when no budget row (defensive)
  forecastHours: number | null;
  budgetHours: number | null;
  crewDaysRemaining: number | null;
  leadingReason: string | null;        // health.reasons[0]
  openAlertCount: number;
  openExceptionCount: number;
  nextAction: { label: string; href: string } | null;
  sortRank: number;
}
export async function listJobHealthSummaries(filter: DashboardFilter): Promise<JobHealthSummary[]>;

export interface JobHealthDetail {
  job: JobRow;
  originalBudget: JobBudgetVersionRow | null;
  currentBudget: JobBudgetVersionRow | null;
  healthInput: JobHealthInput | null;
  health: JobHealthResult | null;
  comparison: FinancialComparison | null;   // null when budgets are missing
  costEntries: JobCostEntryRow[];
  revenueEntries: JobRevenueEntryRow[];
  openAlerts: JobAlertRow[];
  openExceptions: OpenScheduleException[];  // this job's only
  overrides: ForecastOverrideRow[];
  changeOrders: Array<{ id: string; change_order_number: number; status: string; current_version: number; created_by_name: string; created_at: string }>;
  jobEvents: Array<{ id: number; stage_from: number | null; stage_to: number | null; function_name: string | null; action_summary: string | null; status: string | null; created_at: string }>;
  // job_events live columns verified 2026-08-26: id bigint, stage_from/stage_to INTEGER
  // (pipeline stage numbers, not names), created_at timestamptz.
  estimateHref: string | null;              // `/estimates/${original_estimate_id}` when linked
}
export async function getJobHealthDetail(jobNumber: string): Promise<JobHealthDetail | null>;
```

- [ ] **Step 1: Implement `listJobHealthSummaries`**

One `jobs` select with the filter's where-clause, then **batched** parallel loads for the returned job numbers (`Promise.all` of `.in("job_number", numbers)` queries): current+v1 `job_budget_versions`, `job_cost_entries`, `job_forecast_overrides`, open `job_alerts` (`resolved_at is null`), open `job_schedule_exceptions`, latest `job_checklists` per job. Group in memory, normalize via Task 1's normalizers, run `calculateJobHealth` per job where `isEngineScorable(status_v2)` and a current budget exists, assemble summaries, sort by `statusSortRank` then `start_date` ascending nulls-last. `nextAction`: highest-severity open alert's `{title, action_path}`, else open exception → `{label: "Resolve schedule exception", href: "/jobs/exceptions"}`, else null. **This function performs no writes** — snapshot persistence belongs to the detail read only, so a dashboard render never fans out N inserts.

- [ ] **Step 2: Implement `getJobHealthDetail` with snapshot persistence**

Load all `JobHealthDetail` inputs for one job in parallel (`Promise.all`), including `job_events` (by `job_number`, newest first, limit 50) and `change_orders`. Compute `healthInput`/`health`/`comparison` via Task 1 + the engine. Then the v2-doc Step 2 rule, exactly:

1. Build `SnapshotWatermarks` from the loaded rows plus `current_budget_version`.
2. Read the latest `job_forecast_snapshots` row for the job (`order by calculated_at desc limit 1`), parse its `input_watermarks`.
3. If `!watermarksEqual(latest, current)` **and** the engine ran: insert one `job_forecast_snapshots` row (`health`, `confidence`, `approved_revenue`, `forecast_cost`, `forecast_profit`, `forecast_profit_pct`, `profit_retention_pct`, `forecast_hours`, `reasons` (jsonb array), `input_watermarks`) and update `jobs.last_forecast_at = now()` for the job. Never update or delete an existing snapshot (the table is append-only by trigger). A snapshot-write failure is logged (`console.error`) and does not fail the page read.

Return null (page renders 404-style not-found) when the job number doesn't exist. Both functions validate `jobNumber` against `/^JOB-\d+$/` before querying.

- [ ] **Step 3: Type-check and run lane tests**

Run: `cd web && npx tsc --noEmit && npx vitest run src/lib/jobs`
Expected: clean compile; Task 1's tests still pass (this module's correctness is proven through Task 1's pure functions plus Task 6's integration pass — no supabase-mock test file is added, matching the house decision for `repo.ts`).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/jobs/healthRepo.ts
git commit -m "feat: add job health aggregate repository with forecast snapshot persistence"
```

---

### Task 3 (Lane C): Job Dashboard at `/jobs` + navigation

**Files:**
- Create: `web/src/app/(app)/jobs/page.tsx`
- Modify: `web/src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `listJobHealthSummaries`, `DashboardFilter`, `JobHealthSummary` from `@/lib/jobs/healthRepo` (Task 2's verbatim signatures).
- Produces: the `/jobs` route; the shared nav gains a "Jobs" destination.

- [ ] **Step 1: Add the nav link**

In `layout.tsx`, change the bottom nav to `grid-cols-3`: **Jobs** → `/jobs`, **Estimates** → `/estimates`, **New** → `/estimates/new` (same `h-16` link styling). Update the module doc comment: the nav now reflects the 2026-08-25 home-surface decision's Task 6 slice — dashboard reachable at `/jobs`, `/` still redirecting to `/estimates` until Task 8.

- [ ] **Step 2: Build the dashboard page**

`export const dynamic = "force-dynamic"`. Filter from `?filter=` search param, validated against the `DashboardFilter` union, default `"active"`. Filter bar: six `<Link>` chips (Active, Job Completed, Invoice / Reconciliation, Financially Closed, Reconciliation Required, Canceled) — the active chip visually distinct; each chip navigates with its `filter` value (server-rendered, no client state).

Each summary renders as a card (`<Link href={`/jobs/${s.job.job_number}`}>`), showing per v2 doc Step 3: job number + client name, crew, schedule window (`start_date` – `end_date`), health pill (At Risk red / Watch amber / On Track green; omitted when `health` null) + confidence, forecast profit `$` and `%` vs. the original expectation, forecast vs. budget hours, crew-days remaining, `leadingReason`, and `nextAction` rendered as a small link when present. Cancelled cards show `cancellation_reason` instead of health. Empty state per filter: plain "No jobs in this view." A count line ("N jobs") mirrors `estimates/page.tsx`. Page container `max-w-lg` on mobile widening to a 2-column card grid at `md:` within `max-w-5xl`.

When any summary has `openExceptionCount > 0`, render one banner link at the top: "Open schedule exceptions need resolution → /jobs/exceptions".

- [ ] **Step 3: Verify render**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: compiles and builds; `/jobs` prerender skipped (dynamic).

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/(app)/jobs/page.tsx' 'web/src/app/(app)/layout.tsx'
git commit -m "feat: add the Job Dashboard route and Jobs navigation"
```

---

### Task 4 (Lane C): Job detail page and components

**Files:**
- Create: `web/src/app/(app)/jobs/[jobNumber]/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/HealthBanner.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/FinancialComparisonTable.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/LaborVarianceCard.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/ActionQueue.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/AuditTimeline.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/CancelJobPanel.tsx`

**Interfaces:**
- Consumes: `getJobHealthDetail` (Task 2); `cancelScheduledJobAction` and `resolveJobAlertAction` from `@/app/(app)/jobs/actions` (Task 5's verbatim signatures below — Lane C wires against them as a fixed contract; both lanes may be mid-flight simultaneously); `useEstimator` from `@/app/(app)/EstimatorChip`'s hook module (same import the estimate forms use).
- Produces: the `/jobs/[jobNumber]` route.

- [ ] **Step 1: Build the page in the locked order**

Server component, `dynamic = "force-dynamic"`. `notFound()` when `getJobHealthDetail` returns null. Render order exactly per v2 doc Step 4:

1. **Identity/status header** — job number, client (contact + business per the `clientLabel` semantics: show `client_contact_name` and `business_name` when present, else `client_name`), address/city, crew, schedule window, `status_v2` + `financial_status` chips, link to the source estimate (`estimateHref`, "Estimate #<original_estimate_number>").
2. **`<HealthBanner health confidence leadingReason />`** — full-width tinted banner (red/amber/green), plain-language leading reason, confidence label ("Confidence: High/Medium/Low"). When `health` null (cancelled): neutral banner with "Cancelled — <cancellation_reason>".
3. **Forecast profit vs. original expectation** — two stat tiles: "Forecast profit" (`health.forecastProfit`, with `forecastProfitPct`) and "Original plan" (`originalBudget.planned_economic_profit`, with `planned_profit_pct`), plus profit-retention line ("Retaining N% of planned profit").
4. **`<FinancialComparisonTable comparison />`**.
5. **`<LaborVarianceCard />`** — collapsed by default (`<details>`), summary row "Labor: forecast X h vs budget Y h". Expanded: productivity view (approved+provisional hours vs budget hours, remaining-hours derivation) and cost view (actual+committed labor cost vs budget labor cost, forecast labor cost). Rate variance is labeled "Rate variance — available when approved time carries employee rates (Phase 5)"; render the productivity numbers only, no fabricated rate math (there is no per-employee rate data until Task 13).
6. **Change orders** — list `changeOrders` (number, status, created by/at); empty state "No change orders. Creation ships with v2 Task 10."
7. **`<ActionQueue openAlerts openExceptions jobNumber />`**.
8. **Expandable sections** (`<details>` each): Cost entries (table: category, state, amount, vendor/employee, incurred at, source), Revenue entries (type, amount, occurred at — with the note "Payments affect collection, not job profit"), Forecast overrides, Audit (`<AuditTimeline jobEvents />`). Cost/revenue sections link to "Add entries — ships with v2 Task 7" as disabled text (no dead links).

Below the sections, for `status_v2 === "scheduled"` or `"in_progress"`: `<CancelJobPanel jobNumber />`.

- [ ] **Step 2: Implement `FinancialComparisonTable`**

Server component (pure props → markup). Four columns: Original, Current, Actual + Committed, Forecast. Rows in the locked presentation order: Total Revenue; the 6 direct-cost category rows (labels: Direct Labor, Materials, Rentals, Dump, Subcontractors, Other Direct); **Total Direct Costs**; **Gross Profit**; Overhead Allocation; **Processing Fees**; **Job Profit**; Job Profit Margin (percent row). Subtotal/total rows visually distinct (font-medium, top border). Desktop: a real `<table>` inside an `overflow-x-auto` wrapper. Mobile (`sm:` breakpoint down): stacked category cards — one card per row rendering the four column values as labeled pairs — no horizontal page scroll (v2 doc Step 5). A caption footnote: "Processing fees are captured below Gross Profit and never counted in direct costs."

- [ ] **Step 3: Implement `ActionQueue` and `CancelJobPanel` (client components)**

`ActionQueue` (`"use client"`): renders open alerts (severity pill, title, message, `action_path` link) and this job's open exceptions (link to `/jobs/exceptions`). Each alert gets a "Resolve" affordance opening an inline note field; submit calls `resolveJobAlertAction({ alertId, note }, estimatorName)` with the picker name from `useEstimator()`; unpicked estimator disables submit with "Pick who's estimating first."; on success `router.refresh()`. This is the resolution path that closes the "`calendar_watch:*` alerts have no resolution path" deferral.

`CancelJobPanel` (`"use client"`): collapsed "Cancel / postpone…" disclosure. Radio: "Postpone — client will reschedule (returns to Quote Accepted)" / "Closed lost — work is not happening". Required reason textarea. Submits `cancelScheduledJobAction({ jobNumber, resolution, reason }, estimatorName)`; renders returned error by `code` (`not_cancellable` → "This job's status changed — refresh."); success → `router.refresh()`. Mirrors `ResolveExceptionForm.tsx`'s structure (pending state, error rendering).

- [ ] **Step 4: Implement `HealthBanner` and `AuditTimeline`**

Both server components, pure props. `AuditTimeline`: newest-first list of job events — `action_summary` (fallback `stage_from → stage_to`), `function_name`, status dot (success/error/skipped), timestamp in `America/Denver` (house pattern from `exceptions/page.tsx:128-132`).

- [ ] **Step 5: Verify and commit**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean.

```bash
git add 'web/src/app/(app)/jobs/[jobNumber]'
git commit -m "feat: add live job profitability detail page"
```

---

### Task 5 (Lane D): Server-action consolidation and the Task-6 deferral fixes

**Files:**
- Modify: `web/src/app/(app)/jobs/actions.ts`
- Modify: `web/src/app/(app)/jobs/__tests__/actions.test.ts`
- Modify: `web/src/app/(app)/jobs/exceptions/page.tsx`
- Modify: `web/src/app/(app)/jobs/exceptions/ResolveExceptionForm.tsx` (import path/type source only)
- Modify: `web/src/lib/jobs/exceptionActions.ts` (one-line filter)
- Create: `web/src/lib/jobs/alertActions.ts`
- Test: `web/src/lib/jobs/__tests__/alertActions.test.ts`

**Interfaces:**
- Consumes: `cancelScheduledJob`/`CancelScheduledJobError` from `@/lib/jobs/scheduleActions`; `resolveDeletedCalendarEvent`/`friendlyResolveErrorMessage`/`ResolveExceptionError` from `@/lib/jobs/exceptionActions`; `isEstimatorName`.
- Produces (Task 4 wires against these exact signatures):

```ts
// web/src/app/(app)/jobs/actions.ts  ("use server")
export type CancelJobActionResult =
  | { ok: true; job: CancelledJob }
  | { ok: false; error: string; code?: CancelJobErrorCode };
export async function cancelScheduledJobAction(
  input: { jobNumber: string; resolution: "postponed" | "closed_lost"; reason: string },
  estimatorName: string,
): Promise<CancelJobActionResult>;

export type ResolveExceptionActionInput = {
  exceptionId: string;
  resolution: "reschedule" | "postponed" | "closed_lost" | "dismiss";
  reason: string;
  startDate?: string;
  endDate?: string;
};
export type ResolveExceptionActionResult =
  | { ok: true; result: ResolvedException }
  | { ok: false; error: string; code?: ResolveExceptionErrorCode };
export async function resolveExceptionAction(
  input: ResolveExceptionActionInput,
  estimatorName: string,
): Promise<ResolveExceptionActionResult>;

export type ResolveAlertActionResult = { ok: true } | { ok: false; error: string };
export async function resolveJobAlertAction(
  input: { alertId: string; note: string },
  estimatorName: string,
): Promise<ResolveAlertActionResult>;

// web/src/lib/jobs/alertActions.ts  (server-only)
export async function resolveJobAlert(input: {
  alertId: string;   // uuid
  note: string;      // nonblank
  actorName: string; // nonblank
}): Promise<void>;
```

- [ ] **Step 1: Write the failing action tests**

Extend `actions.test.ts` (house mocking pattern already in that file). Cases:

```ts
// cancelScheduledJobAction
// - estimatorName "nobody" → { ok:false, error:"Pick who's estimating first." } and the
//   mocked cancelScheduledJob is NEVER called   ← the deferred estimator-allowlist gate
// - valid name "Dane" → forwards { ...input, actorName: "Dane" } (actorName comes from the
//   validated picker argument, NEVER from the client input object) and revalidates
//   "/jobs" and `/jobs/${jobNumber}`
// - CancelScheduledJobError("...cannot be cancelled...", "not_cancellable") → ok:false with code
// resolveExceptionAction
// - identical behavior to the previous inline action: gate, actorName injection,
//   friendlyResolveErrorMessage mapping on ResolveExceptionError, revalidate "/jobs/exceptions"
//   (assert against mocks — this proves the fold-in changed location, not behavior)
// resolveJobAlertAction
// - gate rejection; happy path forwards { alertId, note, actorName: estimatorName } and
//   revalidates "/jobs" + "/jobs/[jobNumber]"?  → revalidatePath("/jobs") only (alertId does
//   not carry a job number; the detail page refresh comes from router.refresh() client-side)
```

New `alertActions.test.ts`: Zod rejection of blank note / non-uuid alertId; update call shape (`resolved_at` set, `resolution_note` = `[actorName] note`, `.is("resolved_at", null)` guard); already-resolved row (0 rows updated) → throws "already resolved".

Run: `cd web && npx vitest run 'src/app/(app)/jobs/__tests__/actions.test.ts' src/lib/jobs/__tests__/alertActions.test.ts`
Expected: FAIL — actions don't exist yet.

- [ ] **Step 2: Implement `alertActions.ts`**

`server-only` module, house structure (inline Zod, `createAdminClient()`). Update `job_alerts` set `resolved_at = now()`, `resolution_note = '[' + actorName + '] ' + note` where `id = alertId` **and** `resolved_at is null`, selecting the updated row; zero rows → throw `Error("alert not found or already resolved")`. `resolved_by` stays null under the no-login model — the actor name is stamped into `resolution_note` (this is the deliberate answer to the deferred "`job_alerts.resolved_by` stamp" item until owner auth exists; say so in the module comment). This gives every open alert — including `calendar_watch:*` renewal-failure alerts, which today have no resolution path anywhere — an owner acknowledgment path.

- [ ] **Step 3: Implement the three actions in `jobs/actions.ts`**

All three follow `scheduleEstimateAction`'s exact shape: `isEstimatorName` gate first, lib call in try/catch, typed-error mapping, `revalidatePath`. `resolveExceptionAction` is the **verbatim body** of the current inline action in `exceptions/page.tsx` (gate → `resolveDeletedCalendarEvent({...input, actorName: estimatorName})` → `friendlyResolveErrorMessage` mapping → `revalidatePath("/jobs/exceptions")`) — moved, not rewritten. `cancelScheduledJobAction` revalidates `/jobs`, `/jobs/${input.jobNumber}`, and `/estimates` (the estimate detail's scheduled-state display depends on it).

- [ ] **Step 4: Fold the exceptions page onto the shared action and add the kind filter**

- `exceptions/page.tsx`: delete the inline action; import `resolveExceptionAction` from `../actions`; pass it down unchanged. Move the `ResolveExceptionActionInput`/`ResolveExceptionActionResult` type declarations out of `ResolveExceptionForm.tsx` and into `actions.ts` (form imports the types from there). Update both files' doc comments — the "file ownership scoped to exactly four files" rationale for the inline action is obsolete now that `jobs/actions.ts` is in-lane.
- `exceptionActions.ts` → `listOpenScheduleExceptions`: add `.eq("kind", "calendar_deleted")` with a comment: `resolve_schedule_exception` pairs alerts only under `calendar_deleted:` fingerprints (Session 10 deferral ledger), so other kinds — which have no writer today — must not be offered this resolution form.

- [ ] **Step 5: Run lane tests and verify pass**

Run: `cd web && npx vitest run 'src/app/(app)/jobs/__tests__/actions.test.ts' src/lib/jobs/__tests__/alertActions.test.ts src/lib/jobs/__tests__/exceptionActions.test.ts`
Expected: PASS (including the pre-existing exceptionActions tests — the filter change must not break them; adjust the list-query mock assertion for the added `.eq`).

- [ ] **Step 6: Commit**

```bash
git add 'web/src/app/(app)/jobs/actions.ts' 'web/src/app/(app)/jobs/__tests__/actions.test.ts' \
  'web/src/app/(app)/jobs/exceptions' web/src/lib/jobs/exceptionActions.ts \
  web/src/lib/jobs/alertActions.ts web/src/lib/jobs/__tests__/alertActions.test.ts
git commit -m "feat: consolidate job server actions, gate cancel behind the estimator allowlist, add alert resolution"
```

---

### Task 6 (serial, orchestrator): Integration verification

**Files:** none new — full-tree gates.

- [ ] **Step 1: Full suites**

```bash
cd web && npm test -- --run && npm run lint && npm run build
cd .. && deno task test
```

Expected: web suite green (604 existing + this plan's additions), lint clean, build green, deno 411/411 with the golden-321 gate intact (nothing in this plan touches Deno code — any deno delta is a defect).

- [ ] **Step 2: Live render check against production data**

`cd web && npm run dev` with production env. Verify: `/jobs?filter=cancelled` lists the 5 TEST jobs (JOB-1102/1104/1105/1106/1107) with cancellation reasons and no health pills; `/jobs` (Active) shows the honest empty state; `/jobs/JOB-1107` renders the detail page with budget v1 figures in Original/Current, zero-actuals columns rendered as `$0.00` (not blank, not fabricated), and the neutral cancelled banner; `/jobs/exceptions` still lists nothing (0 open). Confirm exactly one `job_forecast_snapshots` behavior: cancelled jobs are not engine-scored, so **no** snapshot rows are inserted by these renders (check the table count before/after).

- [ ] **Step 3: Responsive verification (v2 doc Step 5)**

390×844 and 1440×900 on `/jobs` and `/jobs/JOB-1107`: comparison table stacks to category cards at mobile width; no horizontal page scrolling anywhere.

- [ ] **Step 4: Docs + BUILD_LOG + commit**

Update `CLAUDE.md` (Phase Roadmap v2 row: Task 6 shipped-to-branch state) and append the session's `BUILD_LOG.md` entry per the standing rule. Commit docs separately:

```bash
git add CLAUDE.md BUILD_LOG.md
git commit -m "docs: record v2 Task 6 build"
```

**Task 6 acceptance (this plan's gate, feeding the Phase 2 gate):** Dane-facing dashboard and detail render live production data correctly with zero actuals; sorting/filtering per spec; the payment_processing presentation rule proven by unit test; cancel/postpone and alert resolution reachable only through the estimator gate; the exceptions queue serves only `calendar_deleted`; both full suites green. The Phase 2 gate itself (manual facts entered and visible end-to-end) is attempted only after Task 7 ships the manual ledger.

---

## Explicitly out of scope (deferred, not dropped)

- The `/` flip to the dashboard and any auth — v2 Task 8.
- Manual cost/revenue entry forms — v2 Task 7 (next task; its `costs/`/`revenue/` routes nest under this task's `[jobNumber]` directory).
- Forecast override entry UI — v2 Task 9 (`getJobHealthDetail` already loads overrides; Task 9 adds the panel).
- Change-order creation — v2 Task 10.
- Labor **rate** variance math — needs employee-rate-bearing approved time (v2 Task 13).
- `google-calendar-webhook` fixes, RPC prosrc re-applies, pgTAP M5 additions — next touch of each area per the Session 10 ledger.
- Dane's prototype feedback — **not yet received** (artifact has zero comments as of 2026-08-26). Whatever arrives reconciles into the v2 plan first and may amend this plan before or during execution; the two already-ratified decisions are honored throughout.

## Self-review notes

- Spec coverage: v2 Task 6 Steps 1–6 map to Tasks 1/2/3–4/6; the four "For v2 Task 6 specifically" ledger items map to Task 5; the 2026-08-25 amendment maps to Task 3 (nav, no `/` change); the payment_processing rule maps to Tasks 1 (math + test) and 4 (rendering).
- Deviation from the v2 doc's file list, recorded: `healthRepo.ts` carries no dedicated test file (correctness proven through `map.ts` units + integration pass — house precedent `repo.ts`); `CancelJobPanel.tsx` and `alertActions.ts` are additions the deferral ledger requires; `map.test.ts` is the doc's named test file.
- Type consistency: `JobRow`/`JobBudgetVersionRow`/`LedgerRollup`/`FinancialComparison` names used in Tasks 2–4 match Task 1's exports; action signatures in Task 4 match Task 5's exports.
