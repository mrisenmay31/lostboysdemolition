# v2 Task 7 — Manual Cost, Commitment, and Revenue Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Dane/office the manual ledger — cost entries (all 7 categories, provisional/committed/approved/void), audited corrections through `correct_job_cost_entry`, and revenue entries (approved contract/invoice/credit/refund/payment) — feeding the already-live health engine and comparison table, completing v2 Phase 2.

**Architecture:** Three new service-role-only Postgres RPCs own every ledger write so `mark_job_reconciliation_required` and the category-overrun alert run inside the same transaction as the write (one migration, runbook-validated). A pure `web/src/lib/ledger/` lane (types + Zod validation) fronts a thin RPC-wrapper repo; three new server actions in the existing `jobs/actions.ts` gate everything behind the estimator allowlist; two new routes nest under Task 6's `/jobs/[jobNumber]` directory and reuse `map.ts`'s normalizers/rollup.

**Tech Stack:** Next.js 16 App Router (server components + server actions), React 19, TypeScript 5 strict, Tailwind CSS 4, Zod 4, Vitest 4, Supabase Postgres via `createAdminClient()`, plpgsql + pgTAP.

**Spec:** `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` → Task 7 (lines 1475–1519), bound by the Task 6 plan's Global Constraints (`docs/superpowers/plans/2026-08-26-v2-task6-job-dashboard.md` — the locked `payment_processing` presentation above all).

## Design decisions this plan makes (present to Matt with the plan)

1. **All ledger writes are RPCs, not bare `.insert()`s.** The v2 doc's Task 1 says "ledger … RPCs invoke `mark_job_reconciliation_required` within their server-controlled transactions", and Task 7 Step 4's overrun alert needs the same atomicity — a plain insert followed by a separate alert call could leave a late cost on a closed job without its reconciliation flag. So this plan adds `create_job_cost_entry` and `create_job_revenue_entry` alongside the spec-named `correct_job_cost_entry`.
2. **Sign convention (locked to `map.ts`'s live math):** `buildFinancialComparison` computes economic revenue as a plain signed Σ over invoice + credit + refund entries. Forms therefore capture **positive** amounts for every type; the repo negates credit/refund before the RPC; the RPC **enforces** the sign (credit/refund < 0, the other three > 0). Cost amounts are strictly positive — adjustments go through correction, removal through void.
3. **Corrections are restricted to `source_system='manual'` for now.** Task 14 (BILL) defines its own reconciliation flow; widening `correct_job_cost_entry` to other sources is a Task 14 decision, not a default.
4. **Category-overrun alert lives in the two cost RPCs** (fingerprint `category_overrun:<category>`, severity `watch`, dedup via the existing partial-unique open-fingerprint index, reopens after resolution). **No Slack outbox event** — Slack profitability alerts are v2 Task 12; the in-app alert queue is authoritative (v2 decision ledger).
5. **Dates are business dates.** Forms capture `YYYY-MM-DD`; the RPC stores Denver **noon** (`(date::timestamp + interval '12 hours') at time zone 'America/Denver'`) so the Denver-rendered date (house pattern since the Task 6 fix wave) always round-trips to the entered date — a bare `::timestamptz` midnight-UTC cast would render as the previous day in Denver.
6. **Actor attribution:** `job_cost_entries`/`job_revenue_entries` have no `created_by_name` column; the RPCs stamp `metadata.entered_by = p_actor_name` (audit rows and correction reasons carry `actor_name` natively). `p_actor` is always `null` under no-login.
7. **The Task-6-final-review carry applies here first:** Zod rejects empty-string numeric inputs at the boundary (`z.number()` only — no string coercion), and requires positive amounts/quantities.
8. **No revenue correction path** (spec offers none; `job_revenue_entries` has no state column and no audit table). A wrong revenue entry is corrected by an offsetting credit/refund — the revenue page says so.

## Global Constraints

- **Locked `payment_processing` presentation** (ratified 2026-08-21): a capture-only category, EXCLUDED from Total Direct Costs, rendered below Gross Profit as "Processing Fees". Task 7's category pickers and budget-vs-actual table label it "Payment Processing" with the footnote "Captured below Gross Profit — never counted in direct costs."
- **No "portfolio" terminology anywhere.**
- **No login.** Every server action re-validates the picker name with `isEstimatorName()` before any lib call; `p_actor` is always `null`; the name is the durable attribution.
- All money math through `roundToCent()` from `@/lib/pricing`; money display via `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`.
- Postgres `numeric` arrives as strings — every read normalizes via `map.ts`'s normalizers (never re-implement).
- Every data-reading route sets `export const dynamic = "force-dynamic"`. Tailwind zinc palette with `dark:` variants. Mobile-first `max-w-lg` single column; timestamps rendered in `America/Denver`.
- **Do not touch:** `jobs.status` (legacy enum), legacy tables, `_shared/pricing.ts`, estimate tables, any edge function. No function deploys this task.
- **Migration workflow:** `docs/runbooks/profitability-schema-validation.md` — disposable branch, red pgTAP, apply, green pgTAP, full suites, commit identical SQL; **production apply only at Task 6 (verification) with Matt's explicit yes**. Never `db reset`/`db push`.
- **RPC raise texts are a cross-lane API** (Session 3 lesson): `web/src/lib/ledger/repo.ts` classifies errors by substring of the exact raise messages written in Task 2 — neither side may reword without the other.
- Suites gate: `cd web && npm test -- --run` (650 + this plan's additions), `npm run lint`, `npm run build`, repo-root `deno task test` (411, golden-321 intact — any deno delta is a defect in a web+SQL task).
- Each task ends in a focused commit; adversarial review per task + whole-branch review before merge; merge/prod-apply are Matt's calls. Delete nothing without Matt's per-item approval; never `git add -A`.
- Branch: `claude/v2-task7-manual-ledger` from `main`.

## Existing interfaces this plan consumes (verbatim, already on main)

```ts
// @/lib/profitability/types
export type CostCategory = "direct_labor" | "materials" | "rentals" | "dump"
  | "subcontractors" | "other_direct" | "payment_processing";
export const COST_CATEGORIES: readonly CostCategory[];
export interface CategoryAmounts { /* one number per CostCategory key */ }

// @/lib/jobs/map.ts (pure)
export interface JobRow { job_number: string; status_v2: string; /* … */ }
export interface JobBudgetVersionRow { /* per-category budget columns, overhead_rate, labor_rate */ }
export interface JobCostEntryRow {
  id: string; job_number: string | null; category: CostCategory;
  state: "provisional" | "committed" | "approved" | "void";
  reconciliation_state: string; amount: number; quantity: number | null;
  employee_name: string | null; vendor_name: string | null;
  incurred_at: string; source_system: string; updated_at: string;
}
export interface JobRevenueEntryRow {
  id: string; job_number: string;
  entry_type: "approved_contract" | "invoice" | "credit" | "refund" | "payment";
  amount: number; occurred_at: string; source_system: string; created_at: string;
}
export function normalizeJobRow(raw: Record<string, unknown>): JobRow;
export function normalizeBudgetRow(raw: Record<string, unknown>): JobBudgetVersionRow;
export function normalizeCostEntryRow(raw: Record<string, unknown>): JobCostEntryRow;
export function normalizeRevenueEntryRow(raw: Record<string, unknown>): JobRevenueEntryRow;
export function rollupLedger(entries: JobCostEntryRow[]): LedgerRollup;   // skips void + excluded
export function budgetToCategoryAmounts(budget: JobBudgetVersionRow): CategoryAmounts;

// @/lib/estimator (pure)
export function isEstimatorName(v: unknown): v is "Dane" | "Jackson" | "Matt";

// @/lib/supabase/admin (server-only)
export function createAdminClient(): SupabaseClient;

// @/app/(app)/EstimatorChip
export function useEstimator(): { estimator: string | null; /* … */ };
```

Live DB facts (migration `20260819151000_profitability_core_schema.sql`, applied): `job_cost_entries` (unique `(source_system, source_record_id)`, `source_revision int default 1`, `metadata jsonb`, NO immutability trigger), `job_cost_entry_audit` (append-only shape: old/new jsonb + actor + reason), `job_revenue_entries` (unique `(source_system, source_record_id, entry_type)`, no `updated_at`, no audit table), `job_alerts` (partial unique `(job_number, fingerprint) where resolved_at is null`), `mark_job_reconciliation_required(text,text,text)` (no-ops without a closure snapshot; flips `financial_status`, opens `reconcile:<kind>:<id>` alert, queues one Slack outbox event per newly opened alert). `job_budget_versions` check: `(version = 1 and source_estimate_id is not null) or version > 1` — test fixtures use version 2 to avoid needing an estimates row.

Snapshot-watermark interplay (already live in `healthRepo.ts`): cost corrections bump `job_cost_entries.updated_at` and revenue inserts add `created_at` rows, so the next detail-page read sees changed watermarks and persists a fresh `job_forecast_snapshots` row — Task 7 needs no snapshot code of its own; `revalidatePath` is enough.

## Concurrency map (Matt's standing directive — lanes designed in up front)

| Lane | Task | Owns (exclusive) | Can run alongside |
|---|---|---|---|
| A — pure ledger lane | Task 1 | `web/src/lib/ledger/types.ts`, `web/src/lib/ledger/validate.ts`, `web/src/lib/ledger/__tests__/validate.test.ts` | M |
| M — migration | Task 2 | `supabase/migrations/20260826150000_manual_ledger_rpcs.sql`, `supabase/tests/manual_ledger_rpcs_test.sql` | A, and B/C/D once they start |
| B — repo | Task 3 | `web/src/lib/ledger/repo.ts`, `web/src/lib/ledger/__tests__/repo.test.ts` | M, C, D (after A lands — imports A's types; wires the RPC contract verbatim from this plan, not from M's landed SQL) |
| C — actions | Task 4 | `web/src/app/(app)/jobs/actions.ts`, `web/src/app/(app)/jobs/__tests__/actions.test.ts` | M, B, D (after A lands — mocks B's module against the signatures below) |
| D — UI | Task 5 | `web/src/app/(app)/jobs/[jobNumber]/costs/**`, `web/src/app/(app)/jobs/[jobNumber]/revenue/**`, `web/src/app/(app)/jobs/[jobNumber]/page.tsx` (two-line stub swap), `web/src/lib/jobs/map.ts` (one-line `export` on `CATEGORY_LABELS`) | M, B, C (after A lands — wires against C's action signatures as fixed contracts) |
| — | Task 6 | integration verification + Matt gates (orchestrator, serial at the end) | — |

Wave 1: Tasks 1 + 2 concurrently. Wave 2: Tasks 3 + 4 + 5 concurrently. Task 6 serial. Each lane runs only its own tests while siblings are mid-flight; the orchestrator runs full `tsc`/suites once at Task 6 (Lane D imports Lane C's actions mid-flight — same pattern Task 6's Lanes C/D used).

---

### Task 1 (Lane A): Pure ledger types and trust-boundary validation

**Files:**
- Create: `web/src/lib/ledger/types.ts`
- Create: `web/src/lib/ledger/validate.ts`
- Test: `web/src/lib/ledger/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: `CostCategory`, `COST_CATEGORIES` from `@/lib/profitability/types`. Nothing else — both files are PURE (no `server-only`, no I/O, no supabase import; same pattern as `@/lib/jobs/validate.ts`).
- Produces (Tasks 3–5 rely on these exact names):

```ts
// types.ts
export type LedgerEntryState = "provisional" | "committed" | "approved" | "void";
export type CreatableLedgerState = Exclude<LedgerEntryState, "void">;
export type RevenueEntryType = "approved_contract" | "invoice" | "credit" | "refund" | "payment";

export interface CostEntryInput {
  jobNumber: string;            // ^JOB-\d+$
  category: CostCategory;
  state: CreatableLedgerState;  // void is never creatable
  amount: number;               // > 0, finite; cents precision
  quantity: number | null;      // hours for direct_labor, loads for dump; > 0 when set
  unitCost: number | null;      // >= 0 when set
  employeeName: string | null;
  vendorName: string | null;
  incurredOn: string;           // YYYY-MM-DD real calendar date (Denver business date)
  note: string | null;
}

export interface CostCorrectionPatch {
  category?: CostCategory;
  state?: LedgerEntryState;     // void IS reachable here — that's how entries are removed
  amount?: number;              // > 0
  quantity?: number | null;
  unitCost?: number | null;
  employeeName?: string | null;
  vendorName?: string | null;
  incurredOn?: string;
  note?: string | null;
}
export interface CostCorrectionInput {
  entryId: string;              // uuid
  reason: string;               // nonblank
  patch: CostCorrectionPatch;   // at least one key present
}

export interface RevenueEntryInput {
  jobNumber: string;
  entryType: RevenueEntryType;
  amount: number;               // > 0 as entered; repo applies the credit/refund sign
  occurredOn: string;           // YYYY-MM-DD real calendar date
  note: string;                 // required source note (spec)
}

export type LedgerErrorCode = "not_found" | "invalid_input" | "not_correctable" | "other";
export class LedgerError extends Error {
  readonly code: LedgerErrorCode;
  constructor(message: string, code: LedgerErrorCode);
}

// validate.ts — safeParse → discriminated result, house pattern of @/lib/jobs/validate.ts
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };
export function validateCostEntryInput(input: unknown): ValidationResult<CostEntryInput>;
export function validateCostCorrectionInput(input: unknown): ValidationResult<CostCorrectionInput>;
export function validateRevenueEntryInput(input: unknown): ValidationResult<RevenueEntryInput>;
```

- [ ] **Step 1: Write the failing tests**

`web/src/lib/ledger/__tests__/validate.test.ts` (vitest, house style of `web/src/lib/jobs/__tests__` — literal fixtures, one behavior per `it`). Cover:

```ts
import { describe, expect, it } from "vitest";
import {
  validateCostCorrectionInput, validateCostEntryInput, validateRevenueEntryInput,
} from "../validate";

const validCost = {
  jobNumber: "JOB-1107", category: "direct_labor", state: "approved",
  amount: 460, quantity: 20, unitCost: 23, employeeName: "Nick",
  vendorName: null, incurredOn: "2026-08-20", note: "week 1 crew hours",
};

// validateCostEntryInput
// - happy path passes; strings trimmed (jobNumber " JOB-1107 " → "JOB-1107";
//   blank-after-trim employeeName/vendorName/note → null)
// - THE TASK-6 CARRY: amount "" (empty string) → rejected (z.number, no coercion);
//   amount "460" (numeric string) → rejected; NaN → rejected; Infinity → rejected
// - amount 0 and amount -5 → rejected ("amount must be a positive number")
// - quantity 0 → rejected; quantity null → ok; unitCost -1 → rejected; unitCost 0 → ok
// - state "void" → rejected (closed enum excludes it on create)
// - category "overhead" (not a cost_category) → rejected
// - jobNumber "1107" and "JOB-" → rejected (^JOB-\d+$)
// - incurredOn "2026-02-30" → rejected (real-calendar-date check, isRealCalendarDate
//   technique from @/lib/jobs/validate.ts); "08/20/2026" → rejected
// validateCostCorrectionInput
// - happy path: entryId uuid + reason + { amount: 500 } passes
// - patch {} → rejected ("at least one field"); reason "  " → rejected;
//   entryId "abc" → rejected (uuid)
// - patch { state: "void" } → ok (void reachable via correction)
// - patch { amount: "" } → rejected (the carry again); unknown patch key → rejected
//   by Zod .strict()
// validateRevenueEntryInput
// - happy invoice passes; note "" → rejected; entryType "deposit" → rejected;
//   amount -100 → rejected (forms always send positive; sign is the repo's job);
//   occurredOn bad date → rejected
```

Write each commented case as a real `it()` with literal expected error-substring assertions (e.g. `expect(result.errors.join(" ")).toContain("amount")`).

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npx vitest run src/lib/ledger/__tests__/validate.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement `types.ts` and `validate.ts`**

`types.ts`: the exact surface above; `LedgerError` sets `this.name = "LedgerError"` and carries `code` (mirror `ScheduleEstimateError` in `@/lib/jobs/types.ts`). `validate.ts`: Zod schemas built from `z.number()` (never `z.coerce`), `.positive()` on amounts, `.strict()` on the patch object, closed `z.enum` sets derived from `COST_CATEGORIES` for category, the `isRealCalendarDate` round-trip check copied from `@/lib/jobs/validate.ts` (duplicated, not imported — that file's own documented precedent for keeping pure modules self-contained), `z.preprocess` trim on strings, blank-after-trim optional strings → null. Module header comments name this as v2 Task 7 Lane A and state the purity rule and the empty-string-numeric carry.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/ledger/__tests__/validate.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/ledger/types.ts web/src/lib/ledger/validate.ts \
  web/src/lib/ledger/__tests__/validate.test.ts
git commit -m "feat: add pure ledger types and trust-boundary validation"
```

---

### Task 2 (Lane M): Manual-ledger RPCs migration + pgTAP

**Files:**
- Create: `supabase/migrations/20260826150000_manual_ledger_rpcs.sql`
- Test: `supabase/tests/manual_ledger_rpcs_test.sql`

**Interfaces:**
- Consumes: live `job_cost_entries`, `job_cost_entry_audit`, `job_revenue_entries`, `job_alerts`, `job_budget_versions`, `jobs`, `mark_job_reconciliation_required(text,text,text)`.
- Produces (Task 3 wires against these EXACT signatures and raise texts):
  - `public.create_job_cost_entry(p_entry jsonb, p_actor uuid, p_actor_name text) returns public.job_cost_entries`
  - `public.correct_job_cost_entry(p_id uuid, p_patch jsonb, p_reason text, p_actor uuid, p_actor_name text) returns public.job_cost_entries`
  - `public.create_job_revenue_entry(p_entry jsonb, p_actor uuid, p_actor_name text) returns public.job_revenue_entries`
  - private helper `public.open_category_overrun_alert(p_job_number text, p_category public.cost_category) returns void`

**Runbook applies** (`docs/runbooks/profitability-schema-validation.md`): every DB step below runs against a disposable branch cloned from live. **Production apply happens only in Task 6 with Matt's explicit yes.**

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/manual_ledger_rpcs_test.sql`. Fixture ranges: jobs `JOB-9400xx` (940001 ledger fixture, 940002 non-manual-source fixture, 940003 closure fixture) — ranges 92xxxx/93xxxx are taken by sibling suites. Full content:

```sql
-- v2 Task 7 — manual ledger RPCs (create/correct cost, create revenue,
-- overrun alert, reconciliation hook). Fixture jobs: JOB-9400xx.
begin;
select plan(41);

-- ---------- 1-12: existence + EXECUTE posture ----------
select has_function('public', 'create_job_cost_entry', array['jsonb','uuid','text']);
select has_function('public', 'correct_job_cost_entry', array['uuid','jsonb','text','uuid','text']);
select has_function('public', 'create_job_revenue_entry', array['jsonb','uuid','text']);
select function_privs_are('public','create_job_cost_entry',array['jsonb','uuid','text'],'authenticated',array[]::text[]);
select function_privs_are('public','create_job_cost_entry',array['jsonb','uuid','text'],'anon',array[]::text[]);
select function_privs_are('public','create_job_cost_entry',array['jsonb','uuid','text'],'service_role',array['EXECUTE']);
select function_privs_are('public','correct_job_cost_entry',array['uuid','jsonb','text','uuid','text'],'authenticated',array[]::text[]);
select function_privs_are('public','correct_job_cost_entry',array['uuid','jsonb','text','uuid','text'],'anon',array[]::text[]);
select function_privs_are('public','correct_job_cost_entry',array['uuid','jsonb','text','uuid','text'],'service_role',array['EXECUTE']);
select function_privs_are('public','create_job_revenue_entry',array['jsonb','uuid','text'],'authenticated',array[]::text[]);
select function_privs_are('public','create_job_revenue_entry',array['jsonb','uuid','text'],'anon',array[]::text[]);
select function_privs_are('public','create_job_revenue_entry',array['jsonb','uuid','text'],'service_role',array['EXECUTE']);

-- ---------- fixtures ----------
insert into public.jobs (job_number, job_name, status_v2, crew)
values ('JOB-940001', 'JOB-940001 - Ledger Fixture', 'scheduled'::public.job_lifecycle, 'Crew 1'),
       ('JOB-940003', 'JOB-940003 - Closure Fixture', 'completed'::public.job_lifecycle, 'Crew 2');
-- Budget as version 2 (version-1 rows require a source estimate; the check
-- constraint allows version > 1 without one). dump budget deliberately small
-- so the overrun tests can cross it cheaply.
insert into public.job_budget_versions (
  job_number, version, approved_revenue, productive_hours,
  direct_labor_cost, materials_cost, rentals_cost, dump_cost,
  subcontractors_cost, other_direct_cost, allocated_overhead,
  payment_processing_cost, planned_economic_profit, planned_profit_pct,
  overhead_rate, labor_rate, created_by_name
) values (
  'JOB-940001', 2, 5000.00, 40,
  1040.00, 200.00, 0, 130.00,
  0, 0, 920.00,
  86.01, 1500.00, 30.00,
  23.00, 26.00, 'Test Fixture'
);
update public.jobs set current_budget_version = 2 where job_number = 'JOB-940001';

-- ---------- 13-17: create_job_cost_entry happy path ----------
create temporary table t_cost1 as
select * from public.create_job_cost_entry(
  jsonb_build_object(
    'job_number','JOB-940001','category','direct_labor','state','approved',
    'amount',460.00,'quantity',20,'employee_name','Nick',
    'incurred_on','2026-08-20','note','week 1 crew hours'
  ), null, 'Test Fixture');
select is((select source_system from t_cost1), 'manual', 'cost entry source_system is manual');
select matches((select source_record_id from t_cost1),
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'cost entry source_record_id is a server-generated uuid');
select is((select amount from t_cost1), 460.00::numeric(12,2), 'amount stored to the cent');
select is((select metadata ->> 'entered_by' from t_cost1), 'Test Fixture', 'actor stamped into metadata');
select is((select (incurred_at at time zone 'America/Denver')::date from t_cost1),
  date '2026-08-20', 'incurred_at renders back to the entered Denver business date');

-- ---------- 18-21: create_job_cost_entry rejections ----------
select throws_like(
  $$select public.create_job_cost_entry(jsonb_build_object('job_number','JOB-999999','category','dump','state','approved','amount',65,'incurred_on','2026-08-20'), null, 'Test Fixture')$$,
  '%job JOB-999999 not found%', 'unknown job raises');
select throws_like(
  $$select public.create_job_cost_entry(jsonb_build_object('job_number','JOB-940001','category','dump','state','void','amount',65,'incurred_on','2026-08-20'), null, 'Test Fixture')$$,
  '%cannot be created as void%', 'void on create raises');
select throws_like(
  $$select public.create_job_cost_entry(jsonb_build_object('job_number','JOB-940001','category','dump','state','approved','amount',-65,'incurred_on','2026-08-20'), null, 'Test Fixture')$$,
  '%amount must be a positive number%', 'negative amount raises');
select throws_like(
  $$select public.create_job_cost_entry(jsonb_build_object('job_number','JOB-940001','category','dump','state','approved','amount',65,'quantity',0,'incurred_on','2026-08-20'), null, 'Test Fixture')$$,
  '%quantity must be positive%', 'zero quantity raises');

-- ---------- 22-25: category-overrun alert ----------
-- dump budget is 130.00. First entry (65) stays under: no alert.
select public.create_job_cost_entry(jsonb_build_object(
  'job_number','JOB-940001','category','dump','state','approved','amount',65.00,
  'quantity',1,'incurred_on','2026-08-21'), null, 'Test Fixture');
select is((select count(*) from public.job_alerts where job_number='JOB-940001' and fingerprint='category_overrun:dump'),
  0::bigint, 'no overrun alert while under budget');
-- Second entry (130) pushes the dump sum to 195 > 130: alert opens.
create temporary table t_cost2 as
select * from public.create_job_cost_entry(jsonb_build_object(
  'job_number','JOB-940001','category','dump','state','committed','amount',130.00,
  'quantity',2,'incurred_on','2026-08-22'), null, 'Test Fixture');
select is((select count(*) from public.job_alerts where job_number='JOB-940001' and fingerprint='category_overrun:dump' and resolved_at is null),
  1::bigint, 'overrun alert opens when actual+committed crosses the budget');
select is((select severity from public.job_alerts where job_number='JOB-940001' and fingerprint='category_overrun:dump' and resolved_at is null),
  'watch'::public.job_health_status, 'overrun severity is watch');
-- Third over-budget entry while the alert is open: dedup, still one row.
select public.create_job_cost_entry(jsonb_build_object(
  'job_number','JOB-940001','category','dump','state','provisional','amount',10.00,
  'incurred_on','2026-08-23'), null, 'Test Fixture');
select is((select count(*) from public.job_alerts where job_number='JOB-940001' and fingerprint='category_overrun:dump'),
  1::bigint, 'open overrun alert deduplicates');

-- ---------- 26-33: correct_job_cost_entry ----------
create temporary table t_corr1 as
select * from public.correct_job_cost_entry(
  (select id from t_cost1), jsonb_build_object('amount', 520.00),
  'hours recount', null, 'Test Fixture');
select is((select amount from t_corr1), 520.00::numeric(12,2), 'correction updates the amount');
select is((select source_revision from t_corr1), 2, 'correction bumps source_revision');
select is((select count(*) from public.job_cost_entry_audit a
           where a.job_cost_entry_id = (select id from t_cost1)
             and a.reason = 'hours recount'
             and a.old_record ->> 'amount' = '460.00'
             and a.new_record ->> 'amount' = '520.00'
             and a.actor_name = 'Test Fixture'),
  1::bigint, 'audit row records old/new/reason/actor in the same transaction');
select throws_like(
  $$select public.correct_job_cost_entry((select id from t_cost1), jsonb_build_object('amount',600), '  ', null, 'Test Fixture')$$,
  '%correction reason is required%', 'blank reason raises');
select throws_like(
  $$select public.correct_job_cost_entry((select id from t_cost1), jsonb_build_object('flavor','spicy'), 'why', null, 'Test Fixture')$$,
  '%unknown patch field flavor%', 'unknown patch key raises');
select throws_like(
  $$select public.correct_job_cost_entry((select id from t_cost1), '{}'::jsonb, 'why', null, 'Test Fixture')$$,
  '%must change at least one field%', 'empty patch raises');
insert into public.job_cost_entries (job_number, category, state, amount, incurred_at, source_system, source_record_id)
values ('JOB-940001', 'materials', 'approved', 50.00, now(), 'bill', 'bill-fixture-1');
select throws_like(
  $$select public.correct_job_cost_entry((select id from public.job_cost_entries where source_record_id='bill-fixture-1'), jsonb_build_object('amount',60), 'why', null, 'Test Fixture')$$,
  '%only manual entries can be corrected%', 'non-manual source raises');
create temporary table t_void1 as
select * from public.correct_job_cost_entry(
  (select id from t_cost2), jsonb_build_object('state','void'),
  'entered twice', null, 'Test Fixture');
select is((select state from t_void1), 'void'::public.ledger_state, 'void reachable via correction');

-- ---------- 34: void excluded from overrun sums ----------
-- Resolve the open overrun alert, then add a small dump entry. With t_cost2
-- (130) voided the dump sum is 65+10+15 = 90 < 130, so NO new alert opens —
-- proving void rows are excluded from the overrun computation.
update public.job_alerts set resolved_at = now(), resolution_note = '[Test Fixture] test'
 where job_number='JOB-940001' and fingerprint='category_overrun:dump' and resolved_at is null;
select public.create_job_cost_entry(jsonb_build_object(
  'job_number','JOB-940001','category','dump','state','approved','amount',15.00,
  'incurred_on','2026-08-24'), null, 'Test Fixture');
select is((select count(*) from public.job_alerts where job_number='JOB-940001' and fingerprint='category_overrun:dump' and resolved_at is null),
  0::bigint, 'voided entries are excluded from the overrun sum');

-- ---------- 35-40: create_job_revenue_entry ----------
create temporary table t_rev1 as
select * from public.create_job_revenue_entry(
  jsonb_build_object('job_number','JOB-940001','entry_type','invoice','amount',2543.51,
    'occurred_on','2026-08-25','note','Stripe draft 0001'), null, 'Test Fixture');
select is((select source_system from t_rev1), 'manual', 'revenue source_system is manual');
select is((select metadata ->> 'note' from t_rev1), 'Stripe draft 0001', 'revenue note stored');
select throws_like(
  $$select public.create_job_revenue_entry(jsonb_build_object('job_number','JOB-940001','entry_type','credit','amount',100,'occurred_on','2026-08-25','note','x'), null, 'Test Fixture')$$,
  '%credit entries must carry a negative amount%', 'positive credit raises');
select throws_like(
  $$select public.create_job_revenue_entry(jsonb_build_object('job_number','JOB-940001','entry_type','invoice','amount',-100,'occurred_on','2026-08-25','note','x'), null, 'Test Fixture')$$,
  '%invoice entries must carry a positive amount%', 'negative invoice raises');
select throws_like(
  $$select public.create_job_revenue_entry(jsonb_build_object('job_number','JOB-940001','entry_type','invoice','amount',100,'occurred_on','2026-08-25'), null, 'Test Fixture')$$,
  '%source note is required%', 'missing note raises');
select lives_ok(
  $$select public.create_job_revenue_entry(jsonb_build_object('job_number','JOB-940001','entry_type','credit','amount',-50,'occurred_on','2026-08-25','note','goodwill'), null, 'Test Fixture')$$,
  'negative credit inserts');

-- ---------- 41: reconciliation hook fires on a financially closed job ----------
insert into public.job_financial_closure_snapshots (
  job_number, closure_version, budget_version, financials, closed_by, closed_by_name
) values (
  'JOB-940003', 1, 1, '{"note":"test closure"}'::jsonb,
  (select id from auth.users limit 1), 'Test Fixture'
);
update public.jobs set financial_status = 'financially_closed' where job_number = 'JOB-940003';
select public.create_job_cost_entry(jsonb_build_object(
  'job_number','JOB-940003','category','materials','state','approved','amount',25.00,
  'incurred_on','2026-08-25'), null, 'Test Fixture');
select is(
  (select (j.financial_status = 'reconciliation_required')
      and exists (select 1 from public.job_alerts a where a.job_number='JOB-940003' and a.fingerprint like 'reconcile:cost_entry:%' and a.resolved_at is null)
      and exists (select 1 from public.integration_outbox o where o.event_type='slack_reconciliation_required' and o.aggregate_id='JOB-940003')
   from public.jobs j where j.job_number='JOB-940003'),
  true, 'late cost on a closed job flips financial_status, opens the reconcile alert, and queues the Slack outbox event in one transaction');

select * from finish();
rollback;
```

- [ ] **Step 2: Create/refresh the disposable branch and verify RED**

Per the runbook: create a disposable database branch from live, record migration head + row counts of `job_cost_entries`, `job_cost_entry_audit`, `job_revenue_entries`, `job_alerts`, `jobs`. Run the test file on the branch (MCP TAP-capture recipe from the Session 3 memory). Expected: FAIL from assertion 1 (`create_job_cost_entry` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260826150000_manual_ledger_rpcs.sql`. Header comment: v2 Task 7 — the three manual-ledger writer RPCs plus the overrun helper; every write path invokes `mark_job_reconciliation_required` in-transaction; raise texts are a cross-lane API consumed by `web/src/lib/ledger/repo.ts` — do not reword one side alone. Full content:

```sql
-- ============================================================
-- v2 Task 7 — manual ledger RPCs.
-- All ledger writes go through these (never bare inserts from the app):
-- the reconciliation hook and the category-overrun alert must share the
-- write's transaction. service_role-only, search_path pinned.
-- Raise texts below are matched by substring in web/src/lib/ledger/repo.ts
-- (cross-lane API — Session 3 precedent): do not reword without updating
-- the classifier and its tests.
-- ============================================================

-- ------------------------------------------------------------
-- open_category_overrun_alert — v2 Task 7 Step 4: "Open an alert when a
-- category's approved+provisional+committed amount exceeds current
-- budget." Mirrors map.ts's rollupLedger inclusion rules exactly (void
-- states and reconciliation_state='excluded' rows are skipped). One open
-- alert per (job, category) via the existing partial unique index;
-- reopens after resolution. Deliberately NO integration_outbox event —
-- Slack profitability alerts are v2 Task 12; the in-app queue is
-- authoritative (v2 decision ledger).
-- ------------------------------------------------------------
create function public.open_category_overrun_alert(
  p_job_number text,
  p_category public.cost_category
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_budget numeric(12,2);
  v_actual numeric(12,2);
begin
  select case p_category
           when 'direct_labor'       then b.direct_labor_cost
           when 'materials'          then b.materials_cost
           when 'rentals'            then b.rentals_cost
           when 'dump'               then b.dump_cost
           when 'subcontractors'     then b.subcontractors_cost
           when 'other_direct'       then b.other_direct_cost
           when 'payment_processing' then b.payment_processing_cost
         end
    into v_budget
    from public.job_budget_versions b
    join public.jobs j on j.job_number = b.job_number
   where b.job_number = p_job_number
     and b.version = j.current_budget_version;

  if v_budget is null then
    return; -- no current budget: nothing to compare against
  end if;

  select coalesce(sum(amount), 0)
    into v_actual
    from public.job_cost_entries
   where job_number = p_job_number
     and category = p_category
     and state in ('provisional', 'committed', 'approved')
     and reconciliation_state <> 'excluded';

  if v_actual <= v_budget then
    return;
  end if;

  insert into public.job_alerts (job_number, fingerprint, severity, title, message, action_path)
  values (
    p_job_number,
    'category_overrun:' || p_category,
    'watch',
    'Category over budget',
    format('%s actuals plus committed ($%s) exceed the current budget ($%s).',
      initcap(replace(p_category::text, '_', ' ')),
      to_char(v_actual, 'FM999,999,990.00'),
      to_char(v_budget, 'FM999,999,990.00')),
    '/jobs/' || p_job_number
  )
  on conflict (job_number, fingerprint) where resolved_at is null do nothing;
end;
$$;

-- ------------------------------------------------------------
-- create_job_cost_entry — manual cost capture (v2 Task 7 Step 2).
-- source_system='manual', server-generated uuid source_record_id.
-- Amounts strictly positive: adjustments are corrections, removal is
-- void-via-correction. incurred_on is a Denver business date stored as
-- Denver NOON so the Denver-rendered date always round-trips.
-- p_actor is null under no-login; attribution is metadata.entered_by.
-- ------------------------------------------------------------
create function public.create_job_cost_entry(
  p_entry jsonb,
  p_actor uuid,
  p_actor_name text
) returns public.job_cost_entries
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job_number text := p_entry ->> 'job_number';
  v_category   public.cost_category;
  v_state      public.ledger_state;
  v_amount     numeric(12,2);
  v_quantity   numeric(10,2);
  v_unit_cost  numeric(12,4);
  v_incurred_on date;
  v_note       text := nullif(btrim(coalesce(p_entry ->> 'note', '')), '');
  v_row        public.job_cost_entries;
begin
  if p_actor_name is null or btrim(p_actor_name) = '' then
    raise exception 'create_job_cost_entry: actor name is required';
  end if;
  if v_job_number is null
     or not exists (select 1 from public.jobs where job_number = v_job_number) then
    raise exception 'create_job_cost_entry: job % not found', coalesce(v_job_number, '(null)');
  end if;

  v_category := (p_entry ->> 'category')::public.cost_category;
  v_state    := (p_entry ->> 'state')::public.ledger_state;
  if v_state = 'void' then
    raise exception 'create_job_cost_entry: an entry cannot be created as void';
  end if;

  v_amount := (p_entry ->> 'amount')::numeric(12,2);
  if v_amount is null or v_amount <= 0 then
    raise exception 'create_job_cost_entry: amount must be a positive number';
  end if;
  v_quantity := (p_entry ->> 'quantity')::numeric(10,2);
  if v_quantity is not null and v_quantity <= 0 then
    raise exception 'create_job_cost_entry: quantity must be positive when provided';
  end if;
  v_unit_cost := (p_entry ->> 'unit_cost')::numeric(12,4);
  if v_unit_cost is not null and v_unit_cost < 0 then
    raise exception 'create_job_cost_entry: unit cost cannot be negative';
  end if;
  v_incurred_on := (p_entry ->> 'incurred_on')::date;
  if v_incurred_on is null then
    raise exception 'create_job_cost_entry: incurred_on date is required';
  end if;

  insert into public.job_cost_entries (
    job_number, category, state, amount, quantity, unit_cost,
    employee_name, vendor_name, incurred_at,
    source_system, source_record_id, metadata
  ) values (
    v_job_number, v_category, v_state, v_amount, v_quantity, v_unit_cost,
    nullif(btrim(coalesce(p_entry ->> 'employee_name', '')), ''),
    nullif(btrim(coalesce(p_entry ->> 'vendor_name', '')), ''),
    (v_incurred_on::timestamp + interval '12 hours') at time zone 'America/Denver',
    'manual',
    gen_random_uuid()::text,
    jsonb_strip_nulls(jsonb_build_object('entered_by', p_actor_name, 'note', v_note))
  )
  returning * into v_row;

  perform public.mark_job_reconciliation_required(v_job_number, 'cost_entry', v_row.id::text);
  perform public.open_category_overrun_alert(v_job_number, v_category);
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- correct_job_cost_entry — the ONLY correction path (v2 Task 7 Step 2's
-- named signature). Locks the row, applies a whitelisted patch, bumps
-- source_revision/updated_at (the updated_at bump is what moves the
-- forecast-snapshot watermark), writes job_cost_entry_audit in the same
-- transaction, then runs the reconciliation hook and overrun check.
-- Restricted to source_system='manual' — widening to BILL/provider rows
-- is a Task 14/13 decision, not a default.
-- Patch semantics: jsonb `?` distinguishes "set to null" from "absent"
-- for the nullable fields; state 'void' is reachable here (that is how
-- entries are removed — there is no delete path, by design).
-- ------------------------------------------------------------
create function public.correct_job_cost_entry(
  p_id uuid,
  p_patch jsonb,
  p_reason text,
  p_actor uuid,
  p_actor_name text
) returns public.job_cost_entries
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old public.job_cost_entries;
  v_new public.job_cost_entries;
  v_key text;
  v_category public.cost_category;
  v_state public.ledger_state;
  v_amount numeric(12,2);
  v_quantity numeric(10,2);
  v_unit_cost numeric(12,4);
  v_incurred_at timestamptz;
  v_employee_name text;
  v_vendor_name text;
  v_metadata jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'correct_job_cost_entry: a correction reason is required';
  end if;
  if p_actor_name is null or btrim(p_actor_name) = '' then
    raise exception 'correct_job_cost_entry: actor name is required';
  end if;
  if p_patch is null or p_patch = '{}'::jsonb then
    raise exception 'correct_job_cost_entry: the patch must change at least one field';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('category','state','amount','quantity','unit_cost',
                     'employee_name','vendor_name','incurred_on','note') then
      raise exception 'correct_job_cost_entry: unknown patch field %', v_key;
    end if;
  end loop;

  select * into v_old from public.job_cost_entries where id = p_id for update;
  if not found then
    raise exception 'correct_job_cost_entry: entry % not found', p_id;
  end if;
  if v_old.source_system <> 'manual' then
    raise exception 'correct_job_cost_entry: only manual entries can be corrected (entry % came from %)',
      p_id, v_old.source_system;
  end if;

  v_category := case when p_patch ? 'category'
    then (p_patch ->> 'category')::public.cost_category else v_old.category end;
  v_state := case when p_patch ? 'state'
    then (p_patch ->> 'state')::public.ledger_state else v_old.state end;
  v_amount := case when p_patch ? 'amount'
    then (p_patch ->> 'amount')::numeric(12,2) else v_old.amount end;
  if v_amount is null or v_amount <= 0 then
    raise exception 'correct_job_cost_entry: amount must be a positive number';
  end if;
  v_quantity := case when p_patch ? 'quantity'
    then (p_patch ->> 'quantity')::numeric(10,2) else v_old.quantity end;
  if v_quantity is not null and v_quantity <= 0 then
    raise exception 'correct_job_cost_entry: quantity must be positive when provided';
  end if;
  v_unit_cost := case when p_patch ? 'unit_cost'
    then (p_patch ->> 'unit_cost')::numeric(12,4) else v_old.unit_cost end;
  if v_unit_cost is not null and v_unit_cost < 0 then
    raise exception 'correct_job_cost_entry: unit cost cannot be negative';
  end if;
  v_incurred_at := case when p_patch ? 'incurred_on'
    then (((p_patch ->> 'incurred_on')::date)::timestamp + interval '12 hours') at time zone 'America/Denver'
    else v_old.incurred_at end;
  v_employee_name := case when p_patch ? 'employee_name'
    then nullif(btrim(coalesce(p_patch ->> 'employee_name', '')), '') else v_old.employee_name end;
  v_vendor_name := case when p_patch ? 'vendor_name'
    then nullif(btrim(coalesce(p_patch ->> 'vendor_name', '')), '') else v_old.vendor_name end;
  v_metadata := case when p_patch ? 'note'
    then jsonb_strip_nulls(v_old.metadata
           || jsonb_build_object('note', nullif(btrim(coalesce(p_patch ->> 'note', '')), '')))
    else v_old.metadata end;

  update public.job_cost_entries
     set category = v_category, state = v_state, amount = v_amount,
         quantity = v_quantity, unit_cost = v_unit_cost,
         employee_name = v_employee_name, vendor_name = v_vendor_name,
         incurred_at = v_incurred_at, metadata = v_metadata,
         source_revision = v_old.source_revision + 1,
         updated_at = now()
   where id = p_id
  returning * into v_new;

  insert into public.job_cost_entry_audit (
    job_cost_entry_id, old_record, new_record, actor_id, actor_name, reason
  ) values (
    p_id, to_jsonb(v_old), to_jsonb(v_new), p_actor, p_actor_name, btrim(p_reason)
  );

  perform public.mark_job_reconciliation_required(v_new.job_number, 'cost_entry_correction', p_id::text);
  perform public.open_category_overrun_alert(v_new.job_number, v_new.category);
  return v_new;
end;
$$;

-- ------------------------------------------------------------
-- create_job_revenue_entry — manual revenue capture (v2 Task 7 Step 3).
-- SIGN CONVENTION (locked to map.ts's buildFinancialComparison, which
-- computes economic revenue as a plain signed sum over invoice + credit
-- + refund): credit/refund must be NEGATIVE; approved_contract, invoice,
-- payment must be POSITIVE. The web form captures positive numbers and
-- the repo negates credit/refund before calling — this function is the
-- trust boundary that makes the convention non-optional.
-- No correction path by design: job_revenue_entries has no state column
-- and no audit table; a wrong entry is corrected by an offsetting
-- credit/refund.
-- ------------------------------------------------------------
create function public.create_job_revenue_entry(
  p_entry jsonb,
  p_actor uuid,
  p_actor_name text
) returns public.job_revenue_entries
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job_number  text := p_entry ->> 'job_number';
  v_entry_type  public.revenue_entry_type;
  v_amount      numeric(12,2);
  v_occurred_on date;
  v_note        text := nullif(btrim(coalesce(p_entry ->> 'note', '')), '');
  v_row         public.job_revenue_entries;
begin
  if p_actor_name is null or btrim(p_actor_name) = '' then
    raise exception 'create_job_revenue_entry: actor name is required';
  end if;
  if v_job_number is null
     or not exists (select 1 from public.jobs where job_number = v_job_number) then
    raise exception 'create_job_revenue_entry: job % not found', coalesce(v_job_number, '(null)');
  end if;

  v_entry_type := (p_entry ->> 'entry_type')::public.revenue_entry_type;
  v_amount := (p_entry ->> 'amount')::numeric(12,2);
  if v_amount is null or v_amount = 0 then
    raise exception 'create_job_revenue_entry: amount must be a non-zero number';
  end if;
  if v_entry_type in ('credit', 'refund') and v_amount > 0 then
    raise exception 'create_job_revenue_entry: % entries must carry a negative amount', v_entry_type;
  end if;
  if v_entry_type in ('approved_contract', 'invoice', 'payment') and v_amount < 0 then
    raise exception 'create_job_revenue_entry: % entries must carry a positive amount', v_entry_type;
  end if;
  if v_note is null then
    raise exception 'create_job_revenue_entry: a source note is required';
  end if;
  v_occurred_on := (p_entry ->> 'occurred_on')::date;
  if v_occurred_on is null then
    raise exception 'create_job_revenue_entry: occurred_on date is required';
  end if;

  insert into public.job_revenue_entries (
    job_number, entry_type, amount, source_system, source_record_id, occurred_at, metadata
  ) values (
    v_job_number, v_entry_type, v_amount, 'manual', gen_random_uuid()::text,
    (v_occurred_on::timestamp + interval '12 hours') at time zone 'America/Denver',
    jsonb_build_object('entered_by', p_actor_name, 'note', v_note)
  )
  returning * into v_row;

  perform public.mark_job_reconciliation_required(v_job_number, 'revenue_entry', v_row.id::text);
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- EXECUTE posture — house standard (2026-08-17 hardening pass):
-- clients never call these; server actions reach them via service_role.
-- ------------------------------------------------------------
revoke all on function public.open_category_overrun_alert(text, public.cost_category)
  from public, anon, authenticated;
grant execute on function public.open_category_overrun_alert(text, public.cost_category)
  to service_role;
revoke all on function public.create_job_cost_entry(jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_job_cost_entry(jsonb, uuid, text)
  to service_role;
revoke all on function public.correct_job_cost_entry(uuid, jsonb, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.correct_job_cost_entry(uuid, jsonb, text, uuid, text)
  to service_role;
revoke all on function public.create_job_revenue_entry(jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_job_revenue_entry(jsonb, uuid, text)
  to service_role;
```

- [ ] **Step 4: Apply to the branch and verify GREEN**

Apply the migration to the disposable branch via Supabase migration tooling/MCP, re-run `manual_ledger_rpcs_test.sql`. Expected: **41/41 pass.** Also re-run the sibling pgTAP suites touched-adjacent tables (`profitability_core_schema_test.sql`) on the branch — expected unchanged green. Confirm branch row counts for `jobs`, `job_cost_entries`, `job_revenue_entries` match the pre-apply record outside the rolled-back test transaction.

- [ ] **Step 5: Commit the identical SQL**

```bash
git add supabase/migrations/20260826150000_manual_ledger_rpcs.sql \
  supabase/tests/manual_ledger_rpcs_test.sql
git commit -m "feat: add manual ledger writer RPCs with audit, reconciliation hook, and overrun alert"
```

---

### Task 3 (Lane B): Ledger repo — RPC wrappers with error classification

**Files:**
- Create: `web/src/lib/ledger/repo.ts`
- Test: `web/src/lib/ledger/__tests__/repo.test.ts`

**Interfaces:**
- Consumes: Task 1's types; `createAdminClient` from `@/lib/supabase/admin`; `normalizeCostEntryRow`, `normalizeRevenueEntryRow`, `normalizeJobRow`, `normalizeBudgetRow` and row types from `@/lib/jobs/map`; the Task 2 RPC signatures + raise texts verbatim from this plan (Lane M may still be mid-flight).
- Produces (Tasks 4–5 rely on these exact names):

```ts
import "server-only";

export async function createCostEntry(input: CostEntryInput, actorName: string): Promise<JobCostEntryRow>;
export async function correctCostEntry(input: CostCorrectionInput, actorName: string): Promise<JobCostEntryRow>;
export async function createRevenueEntry(input: RevenueEntryInput, actorName: string): Promise<JobRevenueEntryRow>;
// All three throw LedgerError. p_actor is ALWAYS null (no-login).

export interface LedgerJobContext {
  job: JobRow;
  currentBudget: JobBudgetVersionRow | null;   // version = jobs.current_budget_version
  costEntries: JobCostEntryRow[];              // this job, newest incurred_at first
  revenueEntries: JobRevenueEntryRow[];        // this job, newest occurred_at first
}
export async function loadLedgerJobContext(jobNumber: string): Promise<LedgerJobContext | null>;
// null when the job doesn't exist; validates /^JOB-\d+$/ before querying.
```

- [ ] **Step 1: Write the failing tests**

`web/src/lib/ledger/__tests__/repo.test.ts`, house mocking pattern from `web/src/lib/jobs/__tests__/alertActions.test.ts` (vi.mock `@/lib/supabase/admin`, capture `.rpc()` args). Cases:

```ts
// createCostEntry
// - calls rpc("create_job_cost_entry", { p_entry, p_actor: null, p_actor_name: "Dane" })
//   with snake_case p_entry keys: job_number, category, state, amount, quantity,
//   unit_cost, employee_name, vendor_name, incurred_on, note — incurredOn passes
//   through as the plain date string (no timezone math in TS; the RPC owns it)
// - normalizes the returned row's numeric strings ("460.00" → 460) via normalizeCostEntryRow
// createRevenueEntry — THE SIGN RULE:
// - entryType "credit" amount 50 → p_entry.amount === -50
// - entryType "refund" amount 25 → p_entry.amount === -25
// - entryType "invoice" amount 100 → p_entry.amount === 100 (unchanged)
// correctCostEntry
// - calls rpc("correct_job_cost_entry", { p_id, p_patch, p_reason, p_actor: null, p_actor_name })
// - patch key mapping: unitCost → unit_cost, employeeName → employee_name,
//   vendorName → vendor_name, incurredOn → incurred_on; ABSENT keys stay absent
//   (patch { amount: 500 } produces p_patch with exactly one key)
// error classification (raise-text substrings — the cross-lane API):
// - "create_job_cost_entry: job JOB-9 not found" → LedgerError code "not_found"
// - "correct_job_cost_entry: only manual entries can be corrected…" → "not_correctable"
// - "…amount must be a positive number" → "invalid_input"
// - "…must carry a negative amount" → "invalid_input"
// - "…unknown patch field flavor" → "invalid_input"
// - unrecognized message → "other"
// loadLedgerJobContext
// - "not-a-job" → returns null without querying (regex gate)
// - unknown job (jobs select returns no row) → null
```

Run: `cd web && npx vitest run src/lib/ledger/__tests__/repo.test.ts`
Expected: FAIL — `repo.ts` does not exist.

- [ ] **Step 2: Implement `repo.ts`**

Thin wrappers, house shape of `@/lib/jobs/scheduleActions.ts`/`repo.ts`: build snake_case args, `admin.rpc(...)`, normalize via `map.ts` normalizers, classify errors. Classifier (module-level, documented as matching Task 2's raise texts):

```ts
function classifyLedgerError(message: string): LedgerErrorCode {
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
  ) return "invalid_input";
  return "other";
}
```

`loadLedgerJobContext`: `/^JOB-\d+$/` gate → `Promise.all` of four queries (`jobs` single row; `job_budget_versions` where `version = job.current_budget_version` — skipped when null; `job_cost_entries` ordered `incurred_at desc`; `job_revenue_entries` ordered `occurred_at desc`) → normalize everything. Patch mapping uses explicit `if ("amount" in patch)`-style presence checks so absent and null stay distinct (null must reach the RPC as JSON null for nullable fields).

- [ ] **Step 3: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/ledger`
Expected: PASS (Task 1's suite + this one).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/ledger/repo.ts web/src/lib/ledger/__tests__/repo.test.ts
git commit -m "feat: add ledger repo wrapping the manual writer RPCs"
```

---

### Task 4 (Lane C): Ledger server actions

**Files:**
- Modify: `web/src/app/(app)/jobs/actions.ts`
- Test: `web/src/app/(app)/jobs/__tests__/actions.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `validate*` + types; Task 3's `createCostEntry`/`correctCostEntry`/`createRevenueEntry` (mocked in tests; signatures fixed by this plan); `isEstimatorName`; `revalidatePath`.
- Produces (Task 5 wires against these exact signatures):

```ts
export type LedgerActionResult<T> =
  | { ok: true; entry: T }
  | { ok: false; error: string; code?: LedgerErrorCode; fieldErrors?: string[] };

export async function createCostEntryAction(
  input: unknown, estimatorName: string,
): Promise<LedgerActionResult<JobCostEntryRow>>;
export async function correctCostEntryAction(
  input: unknown, estimatorName: string,
): Promise<LedgerActionResult<JobCostEntryRow>>;
export async function createRevenueEntryAction(
  input: unknown, estimatorName: string,
): Promise<LedgerActionResult<JobRevenueEntryRow>>;
```

- [ ] **Step 1: Write the failing action tests**

Extend `actions.test.ts` (house mocking pattern already in the file — mock `@/lib/ledger/repo` alongside the existing mocks). Cases:

```ts
// all three actions
// - estimatorName "nobody" → { ok:false, error:"Pick who's estimating first." },
//   mocked repo fn NEVER called
// - invalid input (amount: "" on create; empty patch on correct; blank note on
//   revenue) → { ok:false, fieldErrors } and repo NEVER called (validation runs
//   in the action, house scheduleEstimateAction pattern)
// createCostEntryAction happy path
// - forwards (validatedInput, "Dane"); revalidates "/jobs",
//   `/jobs/${jobNumber}`, `/jobs/${jobNumber}/costs`
// correctCostEntryAction happy path
// - forwards (validatedInput, "Dane"); revalidates "/jobs",
//   `/jobs/${row.job_number}`, `/jobs/${row.job_number}/costs` — the job number
//   comes from the RETURNED row (the client input carries only the entry id)
// createRevenueEntryAction happy path
// - revalidates "/jobs", `/jobs/${jobNumber}`, `/jobs/${jobNumber}/revenue`
// error mapping
// - repo throws LedgerError("…not found", "not_found") → { ok:false, code:"not_found" }
// - repo throws plain Error → { ok:false } without code
```

Run: `cd web && npx vitest run 'src/app/(app)/jobs/__tests__/actions.test.ts'`
Expected: FAIL — actions don't exist.

- [ ] **Step 2: Implement the three actions**

Append to `jobs/actions.ts`, following `scheduleEstimateAction`'s exact shape: `isEstimatorName` gate → `validate*` (fieldErrors on failure) → repo call in try/catch with `LedgerError` mapping → `revalidatePath` set per the tests above. Section comment mirrors the existing "Cancel / resolve-exception / resolve-alert" block header, noting these are v2 Task 7 Lane C and that `estimatorName` is never taken from the client input object.

- [ ] **Step 3: Run tests to verify pass**

Run: `cd web && npx vitest run 'src/app/(app)/jobs/__tests__/actions.test.ts'`
Expected: PASS including all pre-existing cases.

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/(app)/jobs/actions.ts' 'web/src/app/(app)/jobs/__tests__/actions.test.ts'
git commit -m "feat: add estimator-gated ledger server actions"
```

---

### Task 5 (Lane D): Cost and revenue entry screens

**Files:**
- Create: `web/src/app/(app)/jobs/[jobNumber]/costs/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/costs/CostEntryForm.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/revenue/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/revenue/RevenueEntryForm.tsx`
- Modify: `web/src/app/(app)/jobs/[jobNumber]/page.tsx` (swap the two "Add entries — ships with v2 Task 7" disabled texts, lines ~261 and ~293, for real `<Link>`s to `costs`/`revenue`)
- Modify: `web/src/lib/jobs/map.ts` (one line: `export` the existing `CATEGORY_LABELS` const so the form reuses the canonical labels instead of forking them)

**Interfaces:**
- Consumes: `loadLedgerJobContext` (Task 3), `createCostEntryAction`/`correctCostEntryAction`/`createRevenueEntryAction` (Task 4's fixed signatures — Lane C may be mid-flight), `rollupLedger`/`budgetToCategoryAmounts`/`CATEGORY_LABELS` from `@/lib/jobs/map`, `COST_CATEGORIES` from `@/lib/profitability/types`, `useEstimator` from `@/app/(app)/EstimatorChip`.
- Produces: the `/jobs/[jobNumber]/costs` and `/jobs/[jobNumber]/revenue` routes.

- [ ] **Step 1: Build `costs/page.tsx`**

Server component, `export const dynamic = "force-dynamic"`. `notFound()` when `loadLedgerJobContext` returns null. Layout (mobile-first `max-w-lg`, zinc + `dark:`):

1. Header: "Costs — JOB-XXXX", client name, back link to `/jobs/${jobNumber}`.
2. **Budget vs. entered table** (when `currentBudget` exists): 7 rows iterated via `COST_CATEGORIES` with `CATEGORY_LABELS`, columns Budget (`budgetToCategoryAmounts`) and Entered (`rollupLedger(costEntries)` — approved+provisional+committed summed per category via `roundToCent`), over-budget cells `text-red-600 dark:text-red-400`. The `payment_processing` row carries the footnote "Captured below Gross Profit — never counted in direct costs." No budget → one line: "No current budget version — entries still record."
3. `<CostEntryForm jobNumber={jobNumber} />`.
4. **Entries list**, newest first: category label, state chip (void struck through + muted), amount, quantity, employee/vendor, incurred date in `America/Denver` (house `Intl.DateTimeFormat` pattern from `exceptions/page.tsx`), source system. Each `source_system === "manual"` non-void entry gets a `<details>` "Correct / void" disclosure rendering the correction section of `CostEntryForm` (see Step 2).

- [ ] **Step 2: Build `CostEntryForm.tsx`**

`"use client"`. Exports two components (one file, Lane D's own): `CostEntryForm` (create) and `CostCorrectionForm` (per-entry, receives `entryId` and current values as initial state). Shared conventions, mirroring `CancelJobPanel.tsx`'s structure (pending state, error rendering, `router.refresh()` on success):

- `useEstimator()`; unpicked → submit disabled with "Pick who's estimating first."
- Create fields: category `<select>` (7, `CATEGORY_LABELS`; the `payment_processing` option text appends " — processing fees"), state `<select>` (Provisional / Committed / Approved with one-line explainers: "Provisional — estimated, not yet invoiced/confirmed", "Committed — ordered or contracted, amount known", "Approved — verified actual"), amount (`<input type="number" step="0.01" min="0.01">`), quantity (label switches by category: "Hours" for `direct_labor`, "Loads" for `dump`, else "Quantity (optional)"), unit cost (optional), employee name (shown for `direct_labor`), vendor name (otherwise), date (`<input type="date">`, default today), note.
- Numeric fields convert `""` → `undefined` before submitting so Zod's `z.number()` rejects them as missing, never coerces (the Task-6 carry); values parsed with `Number()` and passed as numbers.
- Correction fields: amount, state (including **Void — remove this entry from all totals**), quantity, incurred date, note, and a **required reason** textarea ("Why is this being corrected? Recorded permanently in the audit history.").
- On `{ ok:false }` render `error` (and `fieldErrors` as a list); `code === "not_correctable"` message text: "Only manually entered costs can be corrected here."
- Success: reset form, `router.refresh()`.

- [ ] **Step 3: Build `revenue/page.tsx` and `RevenueEntryForm.tsx`**

Page mirrors costs (server, force-dynamic, notFound, header "Revenue — JOB-XXXX", back link). Above the form, the locked explainer block:

> Economic revenue = invoices − credits − refunds. **Payments affect collection status, not job profit** — they are recorded here but excluded from the profitability revenue. Approved-contract entries are informational; the budget's approved revenue is authoritative. There is no edit for revenue entries — correct a mistake with an offsetting credit or refund.

Form (`"use client"`, same estimator/pending/error conventions): entry type radio group with one-line explainers (Approved contract / Invoice / Credit / Refund / Payment; credit and refund labeled "entered as a positive number, recorded as a reduction"), amount (positive, `step="0.01" min="0.01"`), date, required source note ("Where does this number come from? e.g. 'Stripe invoice 0042'"). Entries list below, newest first: type, signed amount (credits/refunds render negative), occurred date (Denver), source system, note from `metadata` when the row carries one — `loadLedgerJobContext`'s revenue rows come from `normalizeRevenueEntryRow`, which does not expose `metadata`; render type/amount/date/source only (the note lives in the DB for audit; surfacing it is a Task 11 concern).

- [ ] **Step 4: Swap the detail-page stubs and export `CATEGORY_LABELS`**

In `[jobNumber]/page.tsx`, replace both "Add entries — ships with v2 Task 7" spans with `<Link href={`/jobs/${jobNumber}/costs`}>Add cost entries</Link>` / `<Link href={`/jobs/${jobNumber}/revenue`}>Add revenue entries</Link>` (house link styling used elsewhere on the page). In `map.ts`, change `const CATEGORY_LABELS` to `export const CATEGORY_LABELS` and note in its comment that the ledger forms consume it (single source for category display names).

- [ ] **Step 5: Verify compile and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean compile, build green, both new routes dynamic.

- [ ] **Step 6: Commit**

```bash
git add 'web/src/app/(app)/jobs/[jobNumber]/costs' 'web/src/app/(app)/jobs/[jobNumber]/revenue' \
  'web/src/app/(app)/jobs/[jobNumber]/page.tsx' web/src/lib/jobs/map.ts
git commit -m "feat: add manual cost and revenue entry screens"
```

---

### Task 6 (serial, orchestrator): Integration verification, production apply, live smoke

**Files:** none new — full-tree gates + docs.

- [ ] **Step 1: Full suites**

```bash
cd web && npm test -- --run && npm run lint && npm run build
cd .. && deno task test
```

Expected: web green (650 + this plan's additions), lint 0 errors, build green, deno 411/411 with golden-321 intact (nothing here touches Deno code — any delta is a defect).

- [ ] **Step 2: Whole-branch adversarial review**

Standing model: strongest-model adversarial review of the whole branch (each task already gated on its own review). Fix round + scoped re-reviews as needed.

- [ ] **Step 3: MATT GATE — production migration apply**

Present the branch-validated migration to Matt. On his explicit yes, apply `20260826150000_manual_ledger_rpcs.sql` to production per the runbook (record migration head + row counts before; re-run read-only assertions after: the three functions exist, EXECUTE posture correct, zero rows changed in `job_cost_entries`/`job_revenue_entries`/`job_alerts`). **The web code must not deploy before this apply** — the actions 500 against missing RPCs.

- [ ] **Step 4: Live smoke against production (post-apply, pre-merge)**

Standing lesson (`project_live_probe_lesson`): mocks can't see the database — probe the deploy. Local `npm run dev` against production env, on cancelled TEST job **JOB-1107**:

1. Create one cost entry (dump, approved, $65, 1 load, dated today) → appears on `/jobs/JOB-1107/costs` and in the detail page's cost section; the comparison table's Actual + Committed column moves by exactly $65.
2. Correct it to $80 with a reason → `job_cost_entry_audit` gains one row (verify by SQL), `source_revision` = 2.
3. Void it via correction → drops out of every rollup; comparison returns to $0.
4. Create one invoice entry (+$100, note) and one credit (−$100 net effect, entered as 100) → economic revenue nets to $0 on the detail page.
5. Verify `job_forecast_snapshots` gained **zero** rows throughout (JOB-1107 is cancelled — never engine-scored; the snapshot invariant from Task 6 must hold).
6. Verify no `category_overrun` alert opened falsely, and no `reconcile:*` alert (no closure snapshot exists).

Residue note for Matt: the voided cost entry and the two net-zero revenue rows remain on JOB-1107 permanently (no delete path, by design). Flag them in the session close; removal only with Matt's per-item OK via SQL.

- [ ] **Step 5: MATT GATE — merge + deploy**

On Matt's yes: merge the branch to `main`, push, verify the production Vercel deploy (routes 200: `/jobs/JOB-1107/costs`, `/jobs/JOB-1107/revenue`).

- [ ] **Step 6: Docs + BUILD_LOG + handoff**

Update `CLAUDE.md` (Supabase Tables rows for `job_cost_entries`/`job_revenue_entries` gaining their writers; Phase Roadmap v2 row: Task 7 shipped; sync_log/function tables unchanged), `BUILD_PLAN.md` if any decision shifted, append the session's `BUILD_LOG.md` entry, regenerate `NEXT_SESSION_PROMPT.md` (next: the Phase 2 gate E2E, then v2 Phase 3 / Task 8). Commit docs separately:

```bash
git add CLAUDE.md BUILD_LOG.md NEXT_SESSION_PROMPT.md
git commit -m "docs: record v2 Task 7 build"
```

**Task 7 acceptance (feeding the Phase 2 gate):** manual cost entries in all four states and all seven categories, audited corrections, and all five revenue types write through the estimator gate; entries land in the live comparison table and health engine with the locked `payment_processing` presentation intact; overrun and reconciliation alerts open transactionally; both suites green.

**The Phase 2 gate itself runs as its own Matt-attended session step after merge:** stage a fresh TEST estimate (burns estimate ≥1430, pushing first-real to ≥1431 — Matt's call), schedule it into a real scheduled job, enter the gate's full fact list (labor/materials/rental/dump/subcontractor/other-direct/processing/invoice/credit/refund/payment), and verify Dane's four-column view, health/confidence, leading variance, and audit detail — with existing quote golden tests unchanged.

---

## Explicitly out of scope (deferred, not dropped)

- Forecast override entry UI — v2 Task 9 (its brief carries the empty-string-numeric and positive crew/hours Zod requirements, plus the `hours_per_day=0` divisor guard).
- Change-order creation — v2 Task 10. Revenue's `approved_contract` stays manual-informational until then.
- Financial closure / reopen — v2 Task 11 (first real writer of `job_financial_closure_snapshots`; until it ships, `mark_job_reconciliation_required` no-ops in production by design).
- BILL ingestion and widening `correct_job_cost_entry` beyond `source_system='manual'` — v2 Task 14.
- Slack delivery of overrun/reconciliation alerts — v2 Task 12 (the dispatcher's `slack_reconciliation_required` handler is the standing Phase-3 obligation at first dispatcher touch).
- Surfacing revenue-entry notes in the UI — Task 11's invoice-review surface.

## Self-review notes

- Spec coverage: Task 7 Step 1 → Task 1 (+ pgTAP rejections in Task 2); Step 2 → Tasks 2–3 (server UUID, `source_system='manual'`, `correct_job_cost_entry` + same-transaction audit); Step 3 → Task 5 (all states incl. void, all five revenue types, the payments explainer); Step 4 → Task 4 (revalidates) + Task 2 (overrun alert, in-transaction). The Phase 2 gate is quoted verbatim in Task 6.
- Type consistency: `CostEntryInput`/`CostCorrectionInput`/`RevenueEntryInput`/`LedgerError` names match across Tasks 1/3/4; RPC names and raise texts match between Task 2's SQL and Task 3's classifier tests; `LedgerJobContext` matches between Tasks 3 and 5.
- Deviations from the v2 doc's file list, recorded: `types.ts`+`validate.ts` split per house pattern (the doc names both); `repo.test.ts` added (the doc names only `validate.test.ts` — the sign-negation and patch-mapping logic warrant direct tests); two extra RPCs beyond the spec-named one (design decision 1); `CATEGORY_LABELS` export is a one-word change to Task 6's `map.ts` owned by Lane D.
