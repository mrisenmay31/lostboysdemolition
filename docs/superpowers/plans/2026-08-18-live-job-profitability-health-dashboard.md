# Live Job Profitability Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a launch-date workflow in which an accepted estimate is scheduled into a canonical `JOB-XXXX`, operated through foreman checklists, continuously forecast from labor and job costs, reconciled by Dane, and displayed as original-versus-current-versus-actual economic profitability.

**Architecture:** Extend the existing immutable estimate model and shared TypeScript pricing engine. Supabase remains the canonical job and financial ledger; the Next.js App Router application owns scheduling, dashboards, checklists, change orders, and reconciliation. External systems are projections or source feeds connected through an idempotent outbox and provider-neutral adapters, so the first usable release works with manual/imported actuals before BILL and timekeeping automation is enabled.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5 strict mode, Tailwind CSS 4, Zod 4, Vitest 4, Supabase Postgres/Auth/Storage/Edge Functions, Deno 2 tests, Google Calendar API, Slack API, GoHighLevel API, BILL Spend & Expense, selected construction timekeeping provider, Gusto payroll.

**Approved design:** `docs/superpowers/specs/2026-08-18-live-job-profitability-health-dashboard-design.md`

## Global Constraints

- Supabase and the estimator application own estimates, jobs, budgets, actual-cost attribution, forecasts, change orders, profitability, and audits.
- Scheduling in the estimator application is the only primary action that creates `JOB-XXXX`; Google Calendar is a synchronized projection.
- Estimate acceptance creates `Ready to schedule`, never a job.
- Existing estimate versions remain immutable. Corrections create a new estimate version.
- Existing customer prices do not change merely because operational costs and pricing allowances are separated.
- Existing quote math remains cost-plus markup: labor `$26/hr`, overhead `$23/hr`, dump pricing `$300/load`, card allowance `3.5%`, default markup `25%`, advisory floor `15%`.
- Economic profit, not entered markup, is the primary dashboard profit metric.
- Current approved revenue equals accepted quote plus customer-authorized and internally approved change orders.
- Final actual revenue equals final invoiced revenue net of credits and refunds; collected cash is separate.
- Actual job overhead is allocated from productive hours. Crew and company overhead remain separate analytical pools but feed one blended rate.
- Actual labor uses employee-specific burdened rates effective on the work date.
- Actual costs stay at job/category granularity; no operational phase attribution is required.
- A medium/low-confidence forecast cannot display On Track.
- Dane is the change-order internal approver, forecast reviewer, Slack alert recipient, and initial financial-close approver.
- Foreman financial visibility is deferred; operational routes must not expose price, burden rates, markup, overhead dollars, or profit.
- No full historical job migration. New workflow applies to jobs scheduled after the launch timestamp.
- Timekeeping providers are disqualified unless they accept `JOB-XXXX` automatically and return corrected/approved job-coded time.
- All external writes are idempotent and retryable. External failure never rolls back a canonical job or approved financial record.
- RLS is enabled on every new table. Service-role access remains server-only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, GHL credentials, Google service-account JSON, Slack tokens, BILL tokens, or webhook secrets to client components.
- Money is stored as `numeric(12,2)` and normalized to JavaScript numbers at repository boundaries. Percentages are stored as whole-number percentages unless the column name ends in `_rate`, which stores a decimal fraction.
- All money calculations use `roundToCent()` from the shared pricing engine or the same decimal half-up convention.
- Each task uses TDD and ends in a focused commit.

## Delivery map

| Phase | Working outcome | Tasks |
|---|---|---|
| 1 — Foundation | Schedule a new official job and calculate a correct health result from manual facts | 1–5 |
| 2 — Core experience | Dane dashboard, mobile checklists, change orders, reconciliation, Slack alerts | 6–11 |
| 3 — Automation | Provider-neutral time, BILL, GHL revenue, and Google/Slack delivery adapters | 12–15 |
| 4 — Launch and learning substrate | One real job completes end to end; rate feedback facts accumulate without auto-changing prices | 16–17 |

---

## Phase 1 — Financial and job foundation

### Task 1: Canonical profitability schema

**Files:**
- Create: `supabase/migrations/20260818150000_profitability_lifecycle_values.sql`
- Create: `supabase/migrations/20260818151000_profitability_core_schema.sql`
- Create: `supabase/tests/profitability_core_schema_test.sql`

**Interfaces:**
- Consumes: existing `jobs(job_number)`, `estimates(id, job_number)`, `auth.users(id)`, and `next_job_number()`.
- Produces: enums and tables named below; Tasks 2–17 depend on these exact names.

- [ ] **Step 1: Write the schema smoke test**

Create `supabase/tests/profitability_core_schema_test.sql`:

```sql
begin;
select plan(17);

select has_enum('public', 'job_health_status');
select has_enum('public', 'forecast_confidence');
select has_enum('public', 'cost_category');
select has_enum('public', 'ledger_state');
select has_enum('public', 'reconciliation_state');
select has_enum('public', 'checklist_type');
select has_enum('public', 'change_order_status');
select has_table('public', 'estimate_financial_details');
select has_table('public', 'job_budget_versions');
select has_table('public', 'change_orders');
select has_table('public', 'change_order_versions');
select has_table('public', 'change_order_approvals');
select has_table('public', 'job_checklists');
select has_table('public', 'job_cost_entries');
select has_table('public', 'job_revenue_entries');
select has_table('public', 'overhead_expense_entries');
select has_table('public', 'integration_outbox');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `supabase db reset && supabase test db supabase/tests/profitability_core_schema_test.sql`

Expected: FAIL because the new enums and tables do not exist.

- [ ] **Step 3: Add lifecycle enum values in their own migration**

Create `supabase/migrations/20260818150000_profitability_lifecycle_values.sql`:

```sql
alter type public.job_lifecycle add value if not exists 'fieldwork_complete' after 'in_progress';
alter type public.job_lifecycle add value if not exists 'financially_reconciled' after 'fieldwork_complete';
```

Keep this migration separate because Postgres cannot safely consume a newly added enum value in the same transaction that adds it.

- [ ] **Step 4: Create the financial schema**

Create `supabase/migrations/20260818151000_profitability_core_schema.sql` with these exact public types:

```sql
create type public.job_health_status as enum ('on_track','watch','at_risk');
create type public.forecast_confidence as enum ('high','medium','low');
create type public.cost_category as enum (
  'direct_labor','materials','rentals','dump','subcontractors',
  'other_direct','payment_processing'
);
create type public.ledger_state as enum ('provisional','committed','approved','void');
create type public.reconciliation_state as enum ('unreviewed','matched','needs_review','reconciled','excluded');
create type public.checklist_type as enum ('start','daily','completion');
create type public.change_order_status as enum ('draft','issued','work_authorized','approved','declined','cancelled');
create type public.approval_kind as enum ('customer','internal');
create type public.customer_authorization_method as enum ('signature','email','text','verbal','other');
create type public.revenue_entry_type as enum ('approved_contract','invoice','credit','refund','payment');
create type public.overhead_pool as enum ('crew','company');
create type public.integration_event_status as enum ('pending','processing','succeeded','failed','dead_letter');
```

Add these columns without touching legacy job columns:

```sql
alter table public.jobs
  add column if not exists original_estimate_id uuid references public.estimates(id),
  add column if not exists current_budget_version integer,
  add column if not exists financially_reconciled_at timestamptz,
  add column if not exists financially_reconciled_by uuid references auth.users(id),
  add column if not exists financially_reconciled_by_name text,
  add column if not exists launch_workflow boolean not null default false,
  add column if not exists last_forecast_at timestamptz;
```

Create these tables. Do not collapse them into JSON columns; their constraints and auditability are intentional.

```sql
create table public.estimate_financial_details (
  estimate_id uuid primary key references public.estimates(id),
  formula_version text not null default 'economic-v1',
  productive_hours numeric(8,2) not null check (productive_hours >= 0),
  operational_labor_cost numeric(12,2) not null check (operational_labor_cost >= 0),
  materials_cost numeric(12,2) not null default 0 check (materials_cost >= 0),
  rentals_cost numeric(12,2) not null default 0 check (rentals_cost >= 0),
  expected_dump_cost numeric(12,2) not null default 0 check (expected_dump_cost >= 0),
  subcontractors_cost numeric(12,2) not null default 0 check (subcontractors_cost >= 0),
  other_direct_cost numeric(12,2) not null default 0 check (other_direct_cost >= 0),
  allocated_overhead numeric(12,2) not null check (allocated_overhead >= 0),
  expected_processing_cost numeric(12,2) not null default 0 check (expected_processing_cost >= 0),
  risk_pricing_allowance numeric(12,2) not null default 0,
  markup_amount numeric(12,2) not null check (markup_amount >= 0),
  processing_pricing_allowance numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  customer_price numeric(12,2) not null check (customer_price >= 0),
  planned_economic_profit numeric(12,2) not null,
  planned_profit_pct numeric(7,2) not null,
  created_at timestamptz not null default now()
);

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  change_order_number integer not null,
  status public.change_order_status not null default 'draft',
  current_version integer not null default 1,
  approved_version integer,
  created_by uuid references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_number, change_order_number)
);

create table public.change_order_versions (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references public.change_orders(id),
  version integer not null check (version > 0),
  scope_description text not null,
  productive_hours_delta numeric(8,2) not null default 0,
  labor_cost_delta numeric(12,2) not null default 0,
  materials_cost_delta numeric(12,2) not null default 0,
  rentals_cost_delta numeric(12,2) not null default 0,
  dump_cost_delta numeric(12,2) not null default 0,
  subcontractors_cost_delta numeric(12,2) not null default 0,
  other_direct_cost_delta numeric(12,2) not null default 0,
  overhead_delta numeric(12,2) not null default 0,
  processing_cost_delta numeric(12,2) not null default 0,
  revenue_delta numeric(12,2) not null,
  planned_profit_delta numeric(12,2) not null,
  rate_snapshot jsonb not null,
  formula_version text not null,
  created_by uuid references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  unique (change_order_id, version)
);

create table public.change_order_approvals (
  id uuid primary key default gen_random_uuid(),
  change_order_version_id uuid not null references public.change_order_versions(id),
  kind public.approval_kind not null,
  approved_by_user_id uuid references auth.users(id),
  approved_by_name text not null,
  customer_contact_name text,
  authorization_method public.customer_authorization_method,
  authorization_note text not null,
  evidence_urls text[] not null default '{}',
  approved_at timestamptz not null default now(),
  unique (change_order_version_id, kind),
  check (kind <> 'customer' or customer_contact_name is not null),
  check (kind <> 'customer' or authorization_method is not null)
);

create table public.job_budget_versions (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  version integer not null check (version > 0),
  source_estimate_id uuid references public.estimates(id),
  source_change_order_version_id uuid references public.change_order_versions(id),
  approved_revenue numeric(12,2) not null,
  productive_hours numeric(8,2) not null,
  direct_labor_cost numeric(12,2) not null,
  materials_cost numeric(12,2) not null,
  rentals_cost numeric(12,2) not null,
  dump_cost numeric(12,2) not null,
  subcontractors_cost numeric(12,2) not null,
  other_direct_cost numeric(12,2) not null,
  allocated_overhead numeric(12,2) not null,
  payment_processing_cost numeric(12,2) not null,
  planned_economic_profit numeric(12,2) not null,
  planned_profit_pct numeric(7,2) not null,
  overhead_rate numeric(8,2) not null,
  labor_rate numeric(8,2) not null,
  created_by uuid references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  unique (job_number, version),
  check ((version = 1 and source_estimate_id is not null) or version > 1)
);

create table public.job_checklists (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  checklist_type public.checklist_type not null,
  submitted_by uuid not null references auth.users(id),
  submitted_by_name text not null,
  remaining_workdays numeric(5,2) check (remaining_workdays >= 0),
  expected_crew_size integer check (expected_crew_size > 0),
  hours_per_day numeric(4,2) not null default 8 check (hours_per_day > 0 and hours_per_day <= 24),
  scope_change_flag boolean not null default false,
  work_complete boolean not null default false,
  notes text,
  photo_paths text[] not null default '{}',
  submitted_at timestamptz not null default now(),
  check (checklist_type <> 'start' or work_complete = false),
  check (checklist_type <> 'completion' or work_complete = true)
);

create table public.job_cost_entries (
  id uuid primary key default gen_random_uuid(),
  job_number text references public.jobs(job_number),
  category public.cost_category not null,
  state public.ledger_state not null,
  reconciliation_state public.reconciliation_state not null default 'unreviewed',
  amount numeric(12,2) not null,
  quantity numeric(10,2),
  unit_cost numeric(12,4),
  employee_id uuid references auth.users(id),
  employee_name text,
  vendor_name text,
  incurred_at timestamptz not null,
  source_system text not null,
  source_record_id text not null,
  source_revision integer not null default 1,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_record_id),
  check (job_number is not null or reconciliation_state in ('needs_review','excluded'))
);

create table public.job_cost_entry_audit (
  id bigint generated always as identity primary key,
  job_cost_entry_id uuid not null references public.job_cost_entries(id),
  old_record jsonb not null,
  new_record jsonb not null,
  actor_id uuid references auth.users(id),
  actor_name text not null,
  reason text not null,
  changed_at timestamptz not null default now()
);

create table public.job_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  entry_type public.revenue_entry_type not null,
  amount numeric(12,2) not null,
  source_system text not null,
  source_record_id text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (source_system, source_record_id, entry_type)
);

create table public.overhead_expense_entries (
  id uuid primary key default gen_random_uuid(),
  pool public.overhead_pool not null,
  overhead_category text not null,
  amount numeric(12,2) not null,
  vendor_name text,
  incurred_at timestamptz not null,
  reconciliation_state public.reconciliation_state not null default 'unreviewed',
  source_system text not null,
  source_record_id text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_record_id)
);

create table public.job_forecast_overrides (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  category public.cost_category,
  remaining_workdays numeric(5,2),
  expected_crew_size integer,
  hours_per_day numeric(4,2),
  expected_remaining_cost numeric(12,2),
  reason text not null,
  created_by uuid references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  check (category is not null or remaining_workdays is not null)
);

create table public.job_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  health public.job_health_status not null,
  confidence public.forecast_confidence not null,
  approved_revenue numeric(12,2) not null,
  forecast_cost numeric(12,2) not null,
  forecast_profit numeric(12,2) not null,
  forecast_profit_pct numeric(7,2) not null,
  profit_retention_pct numeric(7,2) not null,
  forecast_hours numeric(8,2) not null,
  reasons jsonb not null,
  input_watermarks jsonb not null,
  calculated_at timestamptz not null default now()
);

create table public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  fingerprint text not null,
  severity public.job_health_status not null,
  title text not null,
  message text not null,
  action_path text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_note text
);

create unique index job_alerts_one_open_fingerprint
  on public.job_alerts (job_number, fingerprint)
  where resolved_at is null;

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  idempotency_key text not null unique,
  payload jsonb not null,
  status public.integration_event_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
```

Add indexes on every `job_number`, on `job_cost_entries(reconciliation_state, incurred_at)`, `job_checklists(job_number, submitted_at desc)`, `job_alerts(resolved_at, severity)`, and `integration_outbox(status, available_at)`.

Enable RLS on all new tables. Grant no access to `anon`. Add authenticated policies only in Task 7 when authenticated operational routes exist.

Add immutable UPDATE/DELETE triggers to `estimate_financial_details`, `job_budget_versions`, `change_order_versions`, `change_order_approvals`, `job_checklists`, and `job_forecast_snapshots`. Corrections to those records are append-only.

- [ ] **Step 5: Reset and test the schema**

Run: `supabase db reset && supabase test db supabase/tests/profitability_core_schema_test.sql`

Expected: 17 tests pass. Then run `deno task test` and expect the existing Deno suite to remain green.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818150000_profitability_lifecycle_values.sql \
  supabase/migrations/20260818151000_profitability_core_schema.sql \
  supabase/tests/profitability_core_schema_test.sql
git commit -m "feat: add canonical job profitability schema"
```

---

### Task 2: Economic estimate details without changing quote math

**Files:**
- Create: `web/src/lib/profitability/estimateEconomics.ts`
- Create: `web/src/lib/profitability/__tests__/estimateEconomics.test.ts`
- Modify: `web/src/lib/estimates/types.ts`
- Modify: `web/src/lib/estimates/validate.ts`
- Modify: `web/src/lib/estimates/map.ts`
- Modify: `web/src/lib/estimates/repo.ts`
- Modify: `web/src/app/(app)/estimates/_components/EstimateBuilder.tsx`
- Modify: `supabase/migrations/20260814215000_phase_b_estimates_fixups.sql` only through a new follow-up migration
- Create: `supabase/migrations/20260818152000_create_estimate_economic_details.sql`

**Interfaces:**
- Consumes: `computeEstimate()`, `roundToCent()`, `EstimateDraft`, and `estimate_financial_details`.
- Produces: `computeEstimateEconomics(input: EstimateEconomicsInput): EstimateEconomicsOutput` and extended estimate drafts with category-specific operational costs.

- [ ] **Step 1: Write failing economic-plan tests**

Create `web/src/lib/profitability/__tests__/estimateEconomics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeEstimateEconomics } from "../estimateEconomics";

describe("computeEstimateEconomics", () => {
  it("separates dump pricing allowance from expected dump cost without changing price", () => {
    const result = computeEstimateEconomics({
      productiveHours: 34,
      operationalLaborCost: 884,
      materialsCost: 0,
      rentalsCost: 0,
      expectedDumpCost: 65,
      subcontractorsCost: 0,
      otherDirectCost: 0,
      allocatedOverhead: 782,
      expectedProcessingCost: 86.01,
      dumpPricingBasis: 300,
      markupAmount: 491.50,
      processingPricingAllowance: 86.01,
      calculatedBid: 2543.51,
      quotedPrice: null,
    });

    expect(result.customerPrice).toBe(2543.51);
    expect(result.riskPricingAllowance).toBe(235);
    expect(result.plannedEconomicProfit).toBe(726.50);
    expect(result.plannedProfitPct).toBe(28.56);
  });

  it("uses quoted price and records its discount", () => {
    const result = computeEstimateEconomics({
      productiveHours: 10,
      operationalLaborCost: 260,
      materialsCost: 100,
      rentalsCost: 0,
      expectedDumpCost: 0,
      subcontractorsCost: 0,
      otherDirectCost: 0,
      allocatedOverhead: 230,
      expectedProcessingCost: 30,
      dumpPricingBasis: 0,
      markupAmount: 147.50,
      processingPricingAllowance: 25.81,
      calculatedBid: 763.31,
      quotedPrice: 700,
    });
    expect(result.discountAmount).toBe(63.31);
    expect(result.customerPrice).toBe(700);
    expect(result.plannedEconomicProfit).toBe(80);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run src/lib/profitability/__tests__/estimateEconomics.test.ts`

Expected: FAIL because `estimateEconomics.ts` does not exist.

- [ ] **Step 3: Implement the pure economic calculation**

Create `web/src/lib/profitability/estimateEconomics.ts`:

```ts
import { roundToCent } from "@/lib/pricing";

export interface EstimateEconomicsInput {
  productiveHours: number;
  operationalLaborCost: number;
  materialsCost: number;
  rentalsCost: number;
  expectedDumpCost: number;
  subcontractorsCost: number;
  otherDirectCost: number;
  allocatedOverhead: number;
  expectedProcessingCost: number;
  dumpPricingBasis: number;
  markupAmount: number;
  processingPricingAllowance: number;
  calculatedBid: number;
  quotedPrice: number | null;
}

export interface EstimateEconomicsOutput {
  operationalDirectCost: number;
  fullyLoadedCost: number;
  riskPricingAllowance: number;
  discountAmount: number;
  customerPrice: number;
  plannedEconomicProfit: number;
  plannedProfitPct: number;
}

export function computeEstimateEconomics(input: EstimateEconomicsInput): EstimateEconomicsOutput {
  const operationalDirectCost = roundToCent(
    input.operationalLaborCost + input.materialsCost + input.rentalsCost +
    input.expectedDumpCost + input.subcontractorsCost + input.otherDirectCost,
  );
  const fullyLoadedCost = roundToCent(
    operationalDirectCost + input.allocatedOverhead + input.expectedProcessingCost,
  );
  const riskPricingAllowance = roundToCent(input.dumpPricingBasis - input.expectedDumpCost);
  const customerPrice = roundToCent(input.quotedPrice ?? input.calculatedBid);
  const discountAmount = roundToCent(input.calculatedBid - customerPrice);
  const plannedEconomicProfit = roundToCent(customerPrice - fullyLoadedCost);
  const plannedProfitPct = customerPrice === 0
    ? 0
    : roundToCent((plannedEconomicProfit / customerPrice) * 100);
  return {
    operationalDirectCost,
    fullyLoadedCost,
    riskPricingAllowance,
    discountAmount,
    customerPrice,
    plannedEconomicProfit,
    plannedProfitPct,
  };
}
```

- [ ] **Step 4: Extend the estimate draft and UI**

Add these exact fields to `EstimateDraft` and its Zod schema:

```ts
materialsCost: number;
rentalsCost: number;
expectedDumpCost: number;
subcontractorsCost: number;
otherDirectCost: number;
expectedProcessingCost: number;
```

In the builder, replace the single visible “Job-specific costs” input with those category inputs. Continue passing this legacy aggregate into `computeEstimate()` so customer quote math remains unchanged:

```ts
const jobSpecificCosts = roundToCent(
  materialsCost + rentalsCost + subcontractorsCost + otherDirectCost,
);
```

Do not add `expectedDumpCost` to `jobSpecificCosts`; the current pricing engine already includes `dumpCount × dumpRate` as its dump pricing basis.

Load `estimated_dump_cost_per_load` from `pricing_variables`, seed it at `65`, and default `expectedDumpCost` to `dumpCount × 65`. This changes planned economic profit only, never the quote.

- [ ] **Step 5: Persist economic details atomically**

Create `20260818152000_create_estimate_economic_details.sql` to add a non-breaking three-argument RPC:

```sql
public.create_estimate_with_items_v2(
  p_estimate jsonb,
  p_line_items jsonb,
  p_financial_details jsonb
) returns public.estimates
```

Within the same transaction, insert the estimate, line items, and exactly one `estimate_financial_details` row. Reject a missing details object. Update `mapDraftToEstimatePayload()` to return `{ estimate, lineItems, financialDetails }` and `repo.ts` to call the v2 RPC with all three arguments. Leave `create_estimate_with_items` intact during rollout so older deployed code cannot fail during a staggered app/database deployment; remove it only in a separate post-launch cleanup after production traffic confirms every writer uses v2.

- [ ] **Step 6: Test all estimate paths**

Run:

```bash
cd web
npm test -- --run src/lib/profitability/__tests__/estimateEconomics.test.ts
npm test -- --run src/lib/estimates src/app/\(app\)/estimates/__tests__/actions.test.ts
npm run build
```

Expected: all tests pass; build succeeds; the existing Jorge total remains `$2,543.51`.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/profitability web/src/lib/estimates \
  'web/src/app/(app)/estimates/_components/EstimateBuilder.tsx' \
  supabase/migrations/20260818152000_create_estimate_economic_details.sql
git commit -m "feat: separate estimate cost economics from customer pricing"
```

---

### Task 3: Pure job forecast and health engine

**Files:**
- Create: `web/src/lib/profitability/types.ts`
- Create: `web/src/lib/profitability/calculateJobHealth.ts`
- Create: `web/src/lib/profitability/__tests__/calculateJobHealth.test.ts`

**Interfaces:**
- Consumes: normalized current budget, current ledger rows, latest checklist/override, and freshness watermarks.
- Produces: `calculateJobHealth(input: JobHealthInput, now?: Date): JobHealthResult` used by Tasks 5, 6, 10, and 15.

- [ ] **Step 1: Define and test the forecast contract**

Use these exact exported types in `types.ts`:

```ts
export type CostCategory =
  | "direct_labor" | "materials" | "rentals" | "dump"
  | "subcontractors" | "other_direct" | "payment_processing";
export type HealthStatus = "on_track" | "watch" | "at_risk";
export type ForecastConfidence = "high" | "medium" | "low";

export interface CategoryAmounts {
  direct_labor: number;
  materials: number;
  rentals: number;
  dump: number;
  subcontractors: number;
  other_direct: number;
  payment_processing: number;
}

export interface JobHealthInput {
  jobStatus: "scheduled" | "in_progress" | "fieldwork_complete" | "financially_reconciled";
  approvedRevenue: number;
  plannedProfit: number;
  plannedProfitPct: number;
  budgetHours: number;
  overheadRate: number;
  categoryBudget: CategoryAmounts;
  approvedActual: CategoryAmounts;
  provisionalActual: CategoryAmounts;
  committed: CategoryAmounts;
  remainingCostOverrides: Partial<CategoryAmounts>;
  approvedHours: number;
  provisionalHours: number;
  remainingWorkdays: number | null;
  expectedCrewSize: number | null;
  hoursPerDay: number;
  expectedRemainingLaborRate: number;
  checklistUpdatedAt: string | null;
  timeUpdatedAt: string | null;
  expenseUpdatedAt: string | null;
  unassignedExpenseCount: number;
  unresolvedScopeChange: boolean;
}

export interface JobHealthResult {
  health: HealthStatus;
  confidence: ForecastConfidence;
  forecastHours: number;
  forecastCategoryCost: CategoryAmounts;
  forecastAllocatedOverhead: number;
  forecastCost: number;
  forecastProfit: number;
  forecastProfitPct: number;
  profitRetentionPct: number;
  reasons: string[];
}
```

Write tests for these named cases:

- `on track with current data and 95 percent profit retention`
- `watch at 80 percent profit retention`
- `at risk below 75 percent profit retention`
- `negative profit is always at risk`
- `medium or low confidence downgrades on track to watch`
- `crew days drive remaining labor and overhead`
- `nonlabor ETC defaults to unused category budget`
- `actual plus committed above budget forecasts the overrun`
- `unapproved changed scope forces watch`

- [ ] **Step 2: Implement deterministic calculations**

Implement these rules in `calculateJobHealth.ts`:

```ts
const actualHours = approvedHours + provisionalHours;
const expectedRemainingHours = remainingWorkdays !== null && expectedCrewSize !== null
  ? remainingWorkdays * expectedCrewSize * hoursPerDay
  : Math.max(0, budgetHours - actualHours);
const forecastHours = actualHours + expectedRemainingHours;
const remainingLaborCost = expectedRemainingHours * expectedRemainingLaborRate;
const forecastAllocatedOverhead = forecastHours * overheadRate;
```

For each nonlabor category, use an explicit remaining-cost override when present; otherwise:

```ts
const consumed = approvedActual[category] + provisionalActual[category] + committed[category];
const remaining = Math.max(0, categoryBudget[category] - consumed);
const forecast = consumed + remaining;
```

Labor forecast equals approved labor cost plus provisional labor cost plus remaining labor cost. Overhead is calculated separately and must not be inserted into `CategoryAmounts`.

Health order:

1. At Risk when forecast profit is negative or profit retention is below 75%.
2. Watch when retention is below 90%, forecast hours exceed budget by more than 10%, scope is unresolved, or confidence is not High.
3. Otherwise On Track.

Freshness at calculation time:

- Checklist current: within 36 hours while status is In Progress; checklist age does not reduce confidence after Fieldwork Complete.
- Time current: within 12 hours.
- Expenses current: within 24 hours.
- High: all current and zero unassigned expenses.
- Medium: exactly one failed condition.
- Low: two or more failed conditions.

When `plannedProfit <= 0`, set `profitRetentionPct=0` and health to At Risk rather than dividing by zero.

- [ ] **Step 3: Run tests and commit**

Run: `cd web && npm test -- --run src/lib/profitability/__tests__/calculateJobHealth.test.ts`

Expected: all named cases pass.

```bash
git add web/src/lib/profitability
git commit -m "feat: add deterministic job forecast and health engine"
```

---

### Task 4: Atomic schedule-to-job promotion

**Files:**
- Create: `supabase/migrations/20260818153000_schedule_estimate_rpc.sql`
- Create: `web/src/lib/jobs/types.ts`
- Create: `web/src/lib/jobs/validate.ts`
- Create: `web/src/lib/jobs/repo.ts`
- Create: `web/src/lib/jobs/__tests__/validate.test.ts`
- Create: `web/src/app/(app)/estimates/[id]/schedule/page.tsx`
- Create: `web/src/app/(app)/estimates/[id]/schedule/ScheduleEstimateForm.tsx`
- Create: `web/src/app/(app)/jobs/actions.ts`
- Modify: `web/src/app/(app)/estimates/[id]/page.tsx`
- Modify: `supabase/functions/ghl-job-webhook/handlers.ts`
- Modify: `supabase/functions/ghl-job-webhook/handlers_test.ts`

**Interfaces:**
- Consumes: an accepted latest estimate with `estimate_financial_details` and no `job_number`.
- Produces: `schedule_estimate(p_estimate_id, p_schedule, p_actor, p_actor_name)`, `scheduleEstimateAction()`, canonical job, original budget v1, and a `job.scheduled` outbox event.

- [ ] **Step 1: Test schedule validation**

Define:

```ts
export interface ScheduleEstimateInput {
  estimateId: string;
  crew: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
}
```

Zod must enforce UUID estimate ID, nonblank crew, ISO dates, and `endDate >= startDate`.

- [ ] **Step 2: Implement the transactional RPC**

`schedule_estimate` must lock the estimate row and enforce:

- It is the latest version in its chain.
- Status is `accepted`.
- `job_number` is null.
- Financial details exist.

Inside one transaction:

1. Mint `next_job_number()`.
2. Insert `jobs` with `status_v2='scheduled'`, `launch_workflow=true`, identity/contact fields copied from the estimate, schedule fields, and `original_estimate_id`.
3. Insert `job_budget_versions` version 1 from `estimate_financial_details` and estimate rate snapshots.
4. Set `jobs.current_budget_version=1`.
5. Call existing `update_estimate_job_number` behavior inside the function using transaction-local actor settings.
6. Insert a successful `job_events` row.
7. Insert `integration_outbox` event `job.scheduled` with idempotency key `job.scheduled:<JOB-XXXX>:v1`.
8. Return the created job row.

A repeated call for the same estimate must return the already linked job and must not mint a second number or outbox event.

- [ ] **Step 3: Add the scheduling UI**

Display “Schedule job” only for the latest accepted estimate without a job. The form requires crew, start date, end date, and optional start time. On success, navigate to `/jobs/<JOB-XXXX>`.

- [ ] **Step 4: Retire quote-acceptance job creation**

Change the GHL Quote Accepted handler so it updates the estimate/opportunity state but does not insert into `jobs` and does not call `next_job_number()`. Its response must say `ready_to_schedule`. Keep the legacy behavior behind `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false`; production must set it to `false` before launch and the flag is removed after the launch validation period.

The GHL Job Scheduled webhook becomes compatibility-only: if it receives an opportunity with a linked launch-workflow job, it returns `app_is_schedule_authority` without creating or rescheduling anything.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd web
npm test -- --run src/lib/jobs src/app/\(app\)/estimates
npm run build
cd ..
deno test supabase/functions/ghl-job-webhook
```

Expected: accepted estimate remains jobless until app scheduling; one scheduling action creates exactly one job and one original budget.

```bash
git add supabase/migrations/20260818153000_schedule_estimate_rpc.sql \
  web/src/lib/jobs 'web/src/app/(app)/jobs' \
  'web/src/app/(app)/estimates/[id]' supabase/functions/ghl-job-webhook
git commit -m "feat: make app scheduling the canonical job creation action"
```

---

### Task 5: Outbox dispatcher and Google Calendar projection

**Files:**
- Create: `supabase/migrations/20260818154000_outbox_claim_rpc.sql`
- Create: `supabase/functions/integration-dispatcher/index.ts`
- Create: `supabase/functions/integration-dispatcher/handlers.ts`
- Create: `supabase/functions/integration-dispatcher/handlers_test.ts`
- Modify: `supabase/functions/_shared/google.ts`
- Create: `supabase/migrations/20260818155000_schedule_integration_dispatcher.sql`

**Interfaces:**
- Consumes: pending `integration_outbox` rows.
- Produces: idempotent Google Calendar create/update, one crew Slack schedule notification, job event IDs, retry state, and dead-letter alerts.

- [ ] **Step 1: Write dispatcher tests**

Cover:

- `job.scheduled creates main and mapped crew calendar events`
- `crew calendar omits financial fields`
- `existing event ids cause update not create`
- `one calendar failure leaves event retryable`
- `five failed attempts mark dead_letter and open a job alert`
- `same idempotency key is never delivered twice after success`
- `scheduled job posts one crew Slack notification without financial fields`

- [ ] **Step 2: Add atomic claiming**

Create `claim_integration_events(p_limit integer)` using `for update skip locked`. It selects pending/failed rows whose `available_at <= now()`, marks them processing, stamps `locked_at`, increments attempts, and returns them.

- [ ] **Step 3: Extend Google helpers**

Add:

```ts
export async function updateCalendarEvent(
  calendarId: string,
  eventId: string,
  accessToken: string,
  eventBody: unknown,
): Promise<unknown>
```

Use `PUT /calendar/v3/calendars/{calendarId}/events/{eventId}`. Preserve the existing main-versus-crew description boundary: main may contain estimate value; crew never contains price, markup, margin, hours, or dump counts.

- [ ] **Step 4: Implement dispatcher status changes**

On success mark `succeeded`, set `completed_at`, update `jobs.gcal_main_event_id` / `gcal_crew_event_id`, and stamp `jobs.slack_notified_at` after the existing crew-safe schedule message is delivered. On transient failure use exponential retry minutes `min(60, 2 ** attempts)`. At attempt 5 mark `dead_letter` and create an At Risk `job_alerts` row with fingerprint `integration:<outbox-id>`.

- [ ] **Step 5: Schedule every five minutes**

Follow the existing `crew-night-before` cron pattern. Store the dispatcher URL and shared secret in Vault. The function must reject missing or invalid `x-webhook-secret`.

- [ ] **Step 6: Test and commit**

Run: `deno test supabase/functions/integration-dispatcher supabase/functions/_shared/google.ts`

```bash
git add supabase/functions/integration-dispatcher supabase/functions/_shared/google.ts \
  supabase/migrations/20260818154000_outbox_claim_rpc.sql \
  supabase/migrations/20260818155000_schedule_integration_dispatcher.sql
git commit -m "feat: deliver scheduled jobs through a retryable integration outbox"
```

**Phase 1 gate:** In staging, accept an estimate, confirm no job exists, schedule it in the app, confirm one `JOB-XXXX`, one original budget, one main calendar event, one crew event when mapped, and a reproducible health result from synthetic manual ledger data.

---

## Phase 2 — Core user experience

### Task 6: Job repository, portfolio, and Live Job Profitability Health Dashboard

**Files:**
- Create: `web/src/lib/jobs/map.ts`
- Create: `web/src/lib/jobs/healthRepo.ts`
- Create: `web/src/lib/jobs/__tests__/map.test.ts`
- Create: `web/src/app/(app)/jobs/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/HealthBanner.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/FinancialComparisonTable.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/LaborVarianceCard.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/ActionQueue.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/AuditTimeline.tsx`
- Modify: `web/src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: current budget, ledger rows, revenues, checklist/override, alerts, and `calculateJobHealth()`.
- Produces: `getJobHealthDetail(jobNumber)` and `listJobHealthSummaries()`.

- [ ] **Step 1: Test numeric normalization and comparison rows**

Test Postgres numeric strings, missing optional values, original/current/actual/forecast column construction, and status sorting `at_risk → watch → on_track → fieldwork_complete`.

- [ ] **Step 2: Implement one aggregate repository query**

`getJobHealthDetail()` loads in parallel:

- Job and original estimate
- Original budget v1 and current budget version
- Current `job_cost_entries`
- Revenue entries
- Latest checklist
- Latest forecast override per category
- Open alerts
- Change orders and approvals
- Audit/job events

Normalize all numeric columns before passing them to the pure engine. Insert a `job_forecast_snapshots` row only when the calculated inputs differ from the latest snapshot watermarks; update `jobs.last_forecast_at`.

- [ ] **Step 3: Build the portfolio**

Each card shows job, client, foreman/crew, workday, forecast profit dollars/percentage, forecast versus approved hours, crew-days remaining, health, confidence, leading reason, and next action. Add filters for Active, Fieldwork Complete, Reconciliation, and Closed.

- [ ] **Step 4: Build the job page**

Render in this order:

1. Identity/status header
2. Health banner with plain-language leading reason
3. Forecast profit and original expectation
4. Financial comparison table
5. Labor variance card; collapsed by default, expandable into productivity and rate variance
6. Change orders
7. Action queue
8. Expandable time, cost, revenue, checklist, and audit sections

Never render sensitive financial values in components reused by `/ops`.

- [ ] **Step 5: Verify responsive behavior**

Run `npm run dev`; verify at 390×844 and 1440×900. At mobile width the comparison table becomes stacked category cards; no horizontal page scrolling.

- [ ] **Step 6: Test, build, and commit**

```bash
cd web
npm test -- --run src/lib/jobs src/lib/profitability
npm run lint
npm run build
git add src/lib/jobs 'src/app/(app)/jobs' 'src/app/(app)/layout.tsx'
git commit -m "feat: add live job profitability dashboard and portfolio"
```

---

### Task 7: Manual cost, commitment, and revenue capture

**Files:**
- Create: `web/src/lib/ledger/types.ts`
- Create: `web/src/lib/ledger/validate.ts`
- Create: `web/src/lib/ledger/repo.ts`
- Create: `web/src/lib/ledger/__tests__/validate.test.ts`
- Create: `web/src/app/(app)/jobs/[jobNumber]/costs/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/costs/CostEntryForm.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/revenue/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/revenue/RevenueEntryForm.tsx`
- Modify: `web/src/app/(app)/jobs/actions.ts`

**Interfaces:**
- Consumes: job code, cost/revenue schemas.
- Produces: manual actuals required to validate Phase 2 before automated integrations.

- [ ] **Step 1: Test trust-boundary validation**

Cost entries require category, state, amount, incurred time, actor, and exactly one job. Revenue entries require type, amount, date, and source note. Reject NaN, blank reasons, and unknown job numbers.

- [ ] **Step 2: Implement idempotent manual records**

Generate `source_record_id` as a server-side UUID and use `source_system='manual'`. Cost corrections update the current row only through `correct_job_cost_entry(p_id, p_patch, p_reason, p_actor, p_actor_name)`, which writes `job_cost_entry_audit` in the same transaction.

- [ ] **Step 3: Build concise entry screens**

Support provisional actual, committed, approved, and void. Revenue supports approved contract, invoice, credit, refund, and payment. Clearly explain that payments affect collection status, not job profit.

- [ ] **Step 4: Recalculate after writes**

Revalidate `/jobs` and `/jobs/<JOB-XXXX>` after every entry/correction. Open an alert when a category's approved+provisional+committed amount exceeds current budget.

- [ ] **Step 5: Test and commit**

```bash
cd web
npm test -- --run src/lib/ledger
npm run build
git add src/lib/ledger 'src/app/(app)/jobs/[jobNumber]/costs' \
  'src/app/(app)/jobs/[jobNumber]/revenue' 'src/app/(app)/jobs/actions.ts'
git commit -m "feat: add manual job cost and revenue reconciliation"
```

---

### Task 8: Authenticated mobile Job Checklist area

**Files:**
- Modify: `web/package.json`
- Create: `web/src/lib/supabase/browser.ts`
- Create: `web/src/lib/supabase/server.ts`
- Create: `web/src/lib/supabase/proxy.ts`
- Create: `web/src/proxy.ts`
- Create: `web/src/app/auth/sign-in/page.tsx`
- Create: `web/src/app/auth/confirm/route.ts`
- Create: `web/src/app/(ops)/ops/layout.tsx`
- Create: `web/src/app/(app)/jobs/layout.tsx`
- Create: `web/src/app/(ops)/ops/jobs/page.tsx`
- Create: `web/src/app/(ops)/ops/jobs/[jobNumber]/page.tsx`
- Create: `web/src/app/(ops)/ops/jobs/[jobNumber]/checklists/new/page.tsx`
- Create: `web/src/app/(ops)/ops/jobs/[jobNumber]/checklists/new/ChecklistForm.tsx`
- Create: `web/src/lib/checklists/types.ts`
- Create: `web/src/lib/checklists/validate.ts`
- Create: `web/src/lib/checklists/repo.ts`
- Create: `web/src/lib/checklists/__tests__/validate.test.ts`
- Create: `supabase/migrations/20260818160000_ops_auth_and_checklist_storage.sql`

**Interfaces:**
- Consumes: Supabase Auth identity and assigned jobs.
- Produces: authenticated, append-only start/daily/completion checklists and `job.checklist.submitted` outbox events.

- [ ] **Step 1: Add Supabase SSR support**

Run: `cd web && npm install @supabase/ssr`

Create browser/server client factories using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `server.ts` uses Next cookies; `proxy.ts` refreshes sessions for `/ops/:path*` and `/jobs/:path*` and redirects unauthenticated users to `/auth/sign-in`.

Do not change the existing no-login estimate route in this task.

`web/src/app/(app)/jobs/layout.tsx` requires an active `owner` profile for financial routes. The `/ops` layout allows active foreman/owner profiles and contains no financial data loader.

- [ ] **Step 2: Add operational profiles and RLS**

Create `workforce_profiles(auth_user_id uuid primary key references auth.users, display_name text, role text check role in ('owner','foreman','employee'), crew text, active boolean)`.

Create private Storage bucket `job-checklist-photos`. Authenticated foremen can insert checklists only under their own `submitted_by=auth.uid()` and only for scheduled/in-progress jobs assigned to their crew. Owners can read all. Checklist records remain immutable.

- [ ] **Step 3: Test checklist rules**

Test:

- Start requires Scheduled job and `work_complete=false`.
- Daily requires In Progress.
- Completion requires `work_complete=true`.
- Remaining workdays/crew size are required unless completion.
- Scope-change flag accepts notes/photos.
- A foreman cannot submit as another user.

- [ ] **Step 4: Implement transactional submission**

Create RPC `submit_job_checklist(p_job_number, p_type, p_payload)` using `auth.uid()`:

- Insert immutable checklist.
- For start, transition Scheduled → In Progress.
- For completion, transition In Progress → Fieldwork Complete.
- Insert `job_events` and outbox event.
- For `scope_change_flag=true`, open Watch alert `scope-change:<checklist-id>`.
- Return checklist and resulting job status.

- [ ] **Step 5: Build the mobile UI**

The route shows only operational identity, schedule, crew, scope summary, checklist inputs, and photos. It must not query or render estimate value, customer price, costs, rates, markup, overhead, or profit.

- [ ] **Step 6: Test and commit**

```bash
cd web
npm test -- --run src/lib/checklists
npm run lint
npm run build
git add package.json package-lock.json src/lib/supabase src/lib/checklists \
  src/proxy.ts src/app/auth 'src/app/(ops)' 'src/app/(app)/jobs/layout.tsx' \
  ../supabase/migrations/20260818160000_ops_auth_and_checklist_storage.sql
git commit -m "feat: add authenticated mobile job checklists"
```

---

### Task 9: Dane forecast overrides

**Files:**
- Create: `web/src/lib/forecasts/repo.ts`
- Create: `web/src/lib/forecasts/validate.ts`
- Create: `web/src/lib/forecasts/__tests__/validate.test.ts`
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/ForecastOverridePanel.tsx`
- Modify: `web/src/app/(app)/jobs/actions.ts`
- Modify: `web/src/app/(app)/jobs/[jobNumber]/page.tsx`

**Interfaces:**
- Consumes: latest checklist forecast and current category ETC.
- Produces: append-only owner overrides with actor, old value, new value, reason, and immediate recalculation.

- [ ] **Step 1: Test override validation**

Require either a labor override (`remainingWorkdays`, `expectedCrewSize`, `hoursPerDay`) or one category ETC override. Require a nonblank reason. Reject negative values.

- [ ] **Step 2: Implement append-only overrides**

Never edit checklist rows. Insert `job_forecast_overrides`; the latest override after the latest checklist wins. Show both the foreman submission and Dane override in the timeline.

- [ ] **Step 3: Build and test**

The panel defaults closed and shows the current forecast values. After save, display the new health result and the delta in forecast profit.

Run: `cd web && npm test -- --run src/lib/forecasts && npm run build`

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/forecasts 'web/src/app/(app)/jobs'
git commit -m "feat: add audited owner forecast overrides"
```

---

### Task 10: Versioned change orders and dual approval

**Files:**
- Create: `supabase/migrations/20260818161000_change_order_rpcs.sql`
- Create: `web/src/lib/changeOrders/types.ts`
- Create: `web/src/lib/changeOrders/validate.ts`
- Create: `web/src/lib/changeOrders/repo.ts`
- Create: `web/src/lib/changeOrders/__tests__/lifecycle.test.ts`
- Create: `web/src/app/(app)/jobs/[jobNumber]/change-orders/new/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/change-orders/[changeOrderId]/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/change-orders/_components/CustomerApprovalForm.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/change-orders/_components/InternalApprovalForm.tsx`
- Modify: `web/src/app/(app)/jobs/actions.ts`

**Interfaces:**
- Consumes: same labor/pricing inputs and economic calculator as estimates.
- Produces: immutable CO versions, customer/internal approval evidence, and an atomic current-budget version.

- [ ] **Step 1: Test lifecycle and approval rules**

Cover:

- Draft version can be issued.
- Issued version cannot mutate; revision creates version +1.
- Verbal customer approval requires contact, receiver, time, amount, and note.
- Internal approval requires Dane identity.
- One approval alone does not update current approved revenue.
- Both approvals create exactly one next `job_budget_versions` snapshot.
- Repeated approval call is idempotent.
- Approved version cannot be edited or deleted.

- [ ] **Step 2: Reuse the estimate calculator**

Create CO drafts from `EstimateInputs`, category operational costs, and current rate config. Store the exact rate snapshot and formula version in `change_order_versions`. Do not build a second pricing formula.

- [ ] **Step 3: Implement approval RPCs**

`record_change_order_approval()` inserts the evidence. When both approval kinds exist for the same exact version, call `approve_change_order_version()` in the same transaction:

- Lock job, CO, version, and current budget.
- Verify the version is still current.
- Insert cumulative budget version `current + 1` by adding every delta.
- Update `jobs.current_budget_version`.
- Set CO status/version approved.
- Resolve matching scope-change alert.
- Insert job event and `change_order.approved` outbox event.

- [ ] **Step 4: Build UI and audit display**

Show Draft, Issued, Work Authorized—Customer Approval Pending, Approved, Declined, and Cancelled. Customer authorization methods are signature, email, text, verbal, and other. Evidence is uploaded to private Storage via signed URL.

- [ ] **Step 5: Test and commit**

```bash
cd web
npm test -- --run src/lib/changeOrders src/lib/profitability
npm run build
git add src/lib/changeOrders 'src/app/(app)/jobs' \
  ../supabase/migrations/20260818161000_change_order_rpcs.sql
git commit -m "feat: add audited change orders and approved budget revisions"
```

---

### Task 11: Financial reconciliation and Dane close

**Files:**
- Create: `web/src/lib/reconciliation/types.ts`
- Create: `web/src/lib/reconciliation/evaluate.ts`
- Create: `web/src/lib/reconciliation/repo.ts`
- Create: `web/src/lib/reconciliation/__tests__/evaluate.test.ts`
- Create: `web/src/app/(app)/jobs/[jobNumber]/reconcile/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/reconcile/ReconciliationChecklist.tsx`
- Create: `supabase/migrations/20260818162000_financial_close_rpc.sql`

**Interfaces:**
- Consumes: field completion, approved time, reconciled costs, closed commitments, resolved COs, final invoices, processing cost.
- Produces: `evaluateCloseReadiness()` and `financially_close_job()`.

- [ ] **Step 1: Test readiness reasons**

Block close for each of these exact reasons:

- Job is not Fieldwork Complete.
- Provisional/unapproved time exists.
- Cost entry needs review or lacks a job.
- Commitment remains open.
- Change order is issued/work-authorized but unresolved.
- Final net invoice is absent.
- Payment-processing cost is absent when card payment exists.
- Checklist exception remains unresolved.

Allow explicit waivers only with actor and reason; waivers are job events.

- [ ] **Step 2: Implement close RPC**

`financially_close_job(p_job_number, p_expected_snapshot_id, p_waivers, p_actor, p_actor_name)` locks the job, verifies the supplied latest forecast snapshot, re-evaluates blockers server-side, then sets `status_v2='financially_reconciled'`, close timestamp/actor, inserts an immutable final forecast snapshot, and writes `job.financially_reconciled` outbox event.

Only Dane's configured owner profile can call it. Reopening requires `reopen_financial_job(p_job_number, p_reason, p_actor)` and creates an audit event.

- [ ] **Step 3: Build checklist UI and commit**

Run: `cd web && npm test -- --run src/lib/reconciliation && npm run build`

```bash
git add web/src/lib/reconciliation 'web/src/app/(app)/jobs/[jobNumber]/reconcile' \
  supabase/migrations/20260818162000_financial_close_rpc.sql
git commit -m "feat: add audited job financial reconciliation and close"
```

**Phase 2 gate:** Run a staging job from accepted estimate through app scheduling, start/daily/completion checklist, manual time/cost/revenue, change order with verbal customer authorization, dashboard forecast, and Dane financial close. Verify original budget never changes and current budget changes only after dual approval.

---

## Phase 3 — Integrations and automation

### Task 12: Slack profitability alerts and daily digest

**Files:**
- Create: `supabase/functions/_shared/profitabilitySlack.ts`
- Create: `supabase/functions/_shared/profitabilitySlack_test.ts`
- Modify: `supabase/functions/integration-dispatcher/handlers.ts`
- Create: `supabase/functions/profitability-digest/index.ts`
- Create: `supabase/functions/profitability-digest/handlers.ts`
- Create: `supabase/functions/profitability-digest/handlers_test.ts`
- Create: `supabase/migrations/20260818163000_profitability_digest_cron.sql`

**Interfaces:**
- Consumes: `job.health.changed`, `job.scope_change.flagged`, integration dead letters, and open Watch/action items.
- Produces: immediate At Risk Slack messages and one daily digest.

- [ ] **Step 1: Test safe message rendering**

Immediate Dane-channel messages may contain job revenue/profit. Crew-channel messages may never contain price, revenue, cost, margin, markup, hours budget, or dump budget. Reuse the existing no-pricing crew boundary tests.

- [ ] **Step 2: Implement alert idempotency**

Use `job_alerts.fingerprint`. Send an immediate Slack message only when an alert opens or severity increases. Do not resend while unchanged. Resolution writes a thread reply when a Slack timestamp exists in alert metadata.

- [ ] **Step 3: Implement one daily digest**

At 7:00 AM `America/Denver`, group At Risk, Watch, stale checklists, missing time, unassigned expenses, and reconciliation pending. Each line links to `/jobs/<JOB-XXXX>`.

- [ ] **Step 4: Test and commit**

```bash
deno test supabase/functions/_shared/profitabilitySlack_test.ts \
  supabase/functions/profitability-digest
git add supabase/functions/_shared/profitabilitySlack* \
  supabase/functions/profitability-digest \
  supabase/functions/integration-dispatcher/handlers.ts \
  supabase/migrations/20260818163000_profitability_digest_cron.sql
git commit -m "feat: add actionable Slack profitability alerts and digest"
```

---

### Task 13: Provider-neutral approved-time adapter and import fallback

**Files:**
- Create: `supabase/migrations/20260818164000_job_time_entries.sql`
- Create: `web/src/lib/timekeeping/types.ts`
- Create: `web/src/lib/timekeeping/adapter.ts`
- Create: `web/src/lib/timekeeping/normalize.ts`
- Create: `web/src/lib/timekeeping/__tests__/normalize.test.ts`
- Create: `web/src/lib/timekeeping/manualCsv.ts`
- Create: `web/src/app/(app)/integrations/timekeeping/page.tsx`
- Create: `web/src/app/(app)/integrations/timekeeping/TimeImportForm.tsx`
- Create: `supabase/functions/timekeeping-webhook/index.ts`
- Create: `supabase/functions/timekeeping-webhook/handlers.ts`
- Create: `supabase/functions/timekeeping-webhook/handlers_test.ts`
- Modify: `supabase/functions/integration-dispatcher/handlers.ts`

**Interfaces:**
- Consumes: scheduled jobs and vendor events/imports.
- Produces: normalized corrected/approved job-coded time and direct-labor ledger entries.

- [ ] **Step 1: Create canonical time schema**

Create `job_time_entries` rather than extending the undocumented dormant legacy `time_entries` table:

```sql
create table public.job_time_entries (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  employee_external_id text not null,
  employee_name text not null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  approved_minutes integer check (approved_minutes >= 0),
  burden_rate numeric(10,4) not null check (burden_rate >= 0),
  labor_cost numeric(12,2) not null check (labor_cost >= 0),
  status text not null check (status in ('open','submitted','approved','void')),
  source_system text not null,
  source_record_id text not null,
  source_updated_at timestamptz not null,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_record_id)
);
```

Corrections update this canonical row only when `source_updated_at` is newer and write an audit row. A linked `job_cost_entries` labor row is upserted by deterministic source ID `time:<source-system>:<source-record-id>` so corrections replace, never duplicate, labor cost.

- [ ] **Step 2: Define the adapter contract**

```ts
export interface ProvisionTimekeepingJobRequest {
  jobNumber: string;
  name: string;
  address: string | null;
  startsOn: string;
  endsOn: string;
}

export interface ApprovedTimeRecord {
  externalId: string;
  employeeExternalId: string;
  employeeName: string;
  jobNumber: string;
  clockIn: string;
  clockOut: string;
  approvedMinutes: number;
  sourceUpdatedAt: string;
}

export interface TimekeepingAdapter {
  provisionJob(input: ProvisionTimekeepingJobRequest): Promise<{ externalJobId: string }>;
  verifyWebhook(request: Request): Promise<boolean>;
  parseWebhook(request: Request): Promise<ApprovedTimeRecord[]>;
  listCorrectedApprovedTime(updatedAfter: string): Promise<ApprovedTimeRecord[]>;
}
```

The selected vendor connector must implement all four methods. Until selection, `manualCsv.ts` implements the same normalization path from a CSV with exact headers: `external_id,employee_external_id,employee_name,job_number,clock_in,clock_out,approved_minutes,source_updated_at`.

- [ ] **Step 3: Implement burdened labor cost**

Store burden rate history in `employee_burden_rates(employee_external_id, effective_from, effective_to, hourly_rate, payroll_tax_rate, workers_comp_rate, benefit_hourly_cost, burdened_hourly_rate)`. Select the rate effective at `clock_in`. Labor cost is `approved_minutes / 60 × burdened_hourly_rate`, rounded half-up.

- [ ] **Step 4: Implement webhook/import idempotency and reconciliation**

Reject unknown `JOB-XXXX` into a needs-review queue; do not silently discard it. Open clock entries remain provisional. Approved entries create approved costs. A correction to approved minutes or job code updates forecasts immediately and records old/new values.

- [ ] **Step 5: Test and commit**

```bash
cd web
npm test -- --run src/lib/timekeeping
npm run build
cd ..
deno test supabase/functions/timekeeping-webhook
git add web/src/lib/timekeeping 'web/src/app/(app)/integrations/timekeeping' \
  supabase/functions/timekeeping-webhook \
  supabase/functions/integration-dispatcher/handlers.ts \
  supabase/migrations/20260818164000_job_time_entries.sql
git commit -m "feat: add provider-neutral approved job time ingestion"
```

---

### Task 14: BILL expense ingestion and reconciliation queue

**Files:**
- Create: `supabase/functions/bill-expense-webhook/index.ts`
- Create: `supabase/functions/bill-expense-webhook/handlers.ts`
- Create: `supabase/functions/bill-expense-webhook/handlers_test.ts`
- Create: `web/src/lib/bill/normalize.ts`
- Create: `web/src/lib/bill/__tests__/normalize.test.ts`
- Create: `web/src/app/(app)/reconciliation/expenses/page.tsx`
- Create: `web/src/app/(app)/reconciliation/expenses/ExpenseQueue.tsx`
- Modify: `supabase/functions/integration-dispatcher/handlers.ts`

**Interfaces:**
- Consumes: BILL job custom field and transaction events.
- Produces: one job or overhead classification per transaction, dump counts, and an unassigned queue.

- [ ] **Step 1: Provision job codes from outbox**

For `job.scheduled`, create/ensure BILL custom-selector value equal to `JOB-XXXX`. Persist returned external value ID in `jobs.bill_job_code`. Repeated delivery must return the existing value.

- [ ] **Step 2: Test transaction normalization**

Use the rules already established in `INTEGRATION_DESIGN.md`:

- Ingest `CLEAR` only; ignore `AUTHORIZATION` to avoid double counting.
- Skip split-parent summaries; ingest their child records.
- Refunds are negative costs.
- Exactly one job code is allowed.
- Missing job code is `needs_review`, not overhead.
- Explicit overhead classification writes `overhead_expense_entries` with pool `crew` or `company`, stores no job number, and retains the detailed overhead category.
- Dump-vendor transactions record `quantity=1` unless the reviewed transaction specifies another quantity.

- [ ] **Step 3: Upsert into the canonical ledger**

For job costs use unique key `source_system='bill'`, `source_record_id=<transaction-id>` in `job_cost_entries`. For overhead use the same source identity in `overhead_expense_entries`. Category mappings are configuration rows, not hardcoded vendor names. Corrections use audited correction RPCs in the appropriate ledger.

- [ ] **Step 4: Build the reconciliation queue**

Show unassigned, low-confidence, and corrected transactions. Actions: assign one job, classify as overhead with overhead category, exclude with reason, or correct direct-cost category. No split action is present in the first release.

- [ ] **Step 5: Test and commit**

```bash
cd web
npm test -- --run src/lib/bill
npm run build
cd ..
deno test supabase/functions/bill-expense-webhook
git add web/src/lib/bill 'web/src/app/(app)/reconciliation/expenses' \
  supabase/functions/bill-expense-webhook \
  supabase/functions/integration-dispatcher/handlers.ts
git commit -m "feat: ingest and reconcile job-coded BILL expenses"
```

---

### Task 15: GHL prefill, opportunity linkage, invoice revenue, and payment status

**Files:**
- Modify: `web/src/lib/ghl/client.ts`
- Create: `web/src/lib/ghl/prefill.ts`
- Create: `web/src/lib/ghl/__tests__/prefill.test.ts`
- Modify: `web/src/app/(app)/estimates/new/page.tsx`
- Create: `supabase/functions/ghl-financial-webhook/index.ts`
- Create: `supabase/functions/ghl-financial-webhook/handlers.ts`
- Create: `supabase/functions/ghl-financial-webhook/handlers_test.ts`
- Modify: `web/src/lib/ghl/estimateFields.ts`
- Modify: `web/src/lib/ghl/push.ts`

**Interfaces:**
- Consumes: GHL contact/opportunity/invoice events.
- Produces: equal app-first and GHL-first estimate entry, final net invoiced revenue, separate collections, and dashboard deep links in GHL.

- [ ] **Step 1: Implement GHL-first prefill**

Support `/estimates/new?ghlOpportunityId=<id>`. `loadGhlEstimatePrefill()` fetches the opportunity and contact and returns:

```ts
export interface GhlEstimatePrefill {
  opportunityId: string;
  contactId: string;
  clientName: string;
  companyName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  jobName: string | null;
  jobAddress: string | null;
  city: string | null;
}
```

The app-first path continues creating/updating the opportunity through existing `pushEstimateToGhl()`.

- [ ] **Step 2: Surface stable links in GHL**

Push estimate URL before scheduling and `/jobs/<JOB-XXXX>` after scheduling. Do not expose the owner dashboard link in crew-facing channels.

- [ ] **Step 3: Normalize financial events**

Map:

- Final invoice total → `invoice` revenue entry.
- Credit note → negative `credit` entry.
- Refund → negative `refund` entry.
- Payment received → `payment` entry only.

Dashboard final actual revenue equals invoice + credit + refund. Payment entries populate collected/outstanding status and never enter economic profit.

Verify webhook signatures before parsing. Upsert by GHL object ID and event type.

- [ ] **Step 4: Test and commit**

```bash
cd web
npm test -- --run src/lib/ghl
npm run build
cd ..
deno test supabase/functions/ghl-financial-webhook
git add web/src/lib/ghl 'web/src/app/(app)/estimates/new/page.tsx' \
  supabase/functions/ghl-financial-webhook
git commit -m "feat: connect GHL prefill and job revenue to profitability"
```

**Phase 3 gate:** Schedule a staging job and verify Google and BILL provisioning, import corrected approved time twice without duplication, ingest a BILL transaction/refund, ingest invoice/payment separately, and receive only the expected Slack alert/digest.

---

## Phase 4 — Launch and feedback substrate

### Task 16: Pricing-feedback facts without automatic rate changes

**Files:**
- Create: `supabase/migrations/20260818165000_pricing_feedback_facts.sql`
- Create: `web/src/lib/feedback/facts.ts`
- Create: `web/src/lib/feedback/__tests__/facts.test.ts`
- Create: `web/src/app/(app)/pricing-feedback/page.tsx`

**Interfaces:**
- Consumes: financially reconciled jobs only.
- Produces: immutable facts needed for future human-reviewed rate recommendations; does not modify pricing variables.

- [ ] **Step 1: Create immutable fact rows**

Create `pricing_feedback_facts` with job number, estimate/budget version, estimated and actual productive hours, estimated blended labor rate, actual weighted labor rate, estimated and actual labor cost, estimated and actual dump count/cost, allocated overhead rate, actual overhead pool reference period, original/current/final revenue, planned/actual profit, job type, client type, estimator, crew, and close timestamp.

Insert one row during financial close. Reject updates/deletes.

- [ ] **Step 2: Test variance decomposition**

Calculate:

```text
Productivity variance = (Actual hours − Estimated hours) × Estimated blended rate
Rate variance = Actual labor cost − (Actual hours × Estimated blended rate)
```

Do not calculate or apply recommended rates in this plan.

- [ ] **Step 3: Build read-only feedback page**

Show sample count, hours variance, labor-rate variance, dump count/cost variance, and actual economic profit by job. Label the page “Historical facts”; it contains no Accept Recommendation action.

- [ ] **Step 4: Test and commit**

```bash
cd web
npm test -- --run src/lib/feedback
npm run build
git add src/lib/feedback 'src/app/(app)/pricing-feedback' \
  ../supabase/migrations/20260818165000_pricing_feedback_facts.sql
git commit -m "feat: capture immutable pricing feedback facts at job close"
```

---

### Task 17: Launch-date rollout, observability, and end-to-end acceptance

**Files:**
- Create: `docs/runbooks/live-job-profitability-launch.md`
- Create: `docs/runbooks/live-job-profitability-rollback.md`
- Create: `web/src/app/api/health/integrations/route.ts`
- Create: `web/src/lib/__tests__/liveJobLifecycle.contract.test.ts`
- Modify: `CLAUDE.md`
- Modify: `BUILD_PLAN.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: operational launch procedure, rollback without data loss, monitoring, and one verified real-job loop.

- [ ] **Step 1: Add a cross-module contract test**

The test must prove this state sequence:

```text
accepted estimate, no job
→ schedule
→ scheduled job + budget v1
→ start checklist/in_progress
→ time + expense + daily checklist
→ Watch due to labor forecast
→ approved change order + budget v2
→ completion/fieldwork_complete
→ final invoice + reconciled actuals
→ Dane close/financially_reconciled
→ immutable feedback fact
```

Assert original budget v1 is byte-for-byte unchanged after CO approval and close.

- [ ] **Step 2: Define production feature flags**

Set and document:

```text
ENABLE_APP_JOB_SCHEDULING=true
ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false
ENABLE_TIMEKEEPING_AUTOMATION=false
ENABLE_BILL_AUTOMATION=false
ENABLE_PROFITABILITY_SLACK=true
PROFITABILITY_WORKFLOW_LAUNCH_AT=<approved ISO timestamp>
```

Jobs before `PROFITABILITY_WORKFLOW_LAUNCH_AT` remain legacy and are excluded from the new portfolio by default. Timekeeping/BILL remain manual/imported until their production credentials and webhook tests pass.

- [ ] **Step 3: Write launch runbook**

Include exact order:

1. Back up production schema and record row counts.
2. Apply migrations in timestamp order.
3. Deploy Edge Functions with their existing `verify_jwt` requirements explicitly preserved.
4. Configure Vault/env secrets.
5. Seed Dane owner profile and foreman profiles.
6. Enable app scheduling while GHL acceptance creation is disabled.
7. Run synthetic staging E2E.
8. Run one low-risk real job with manual actuals.
9. Dane signs off original/current/actual numbers.
10. Enable Slack notifications.
11. Enable BILL and timekeeping separately only after each integration gate passes.

- [ ] **Step 4: Write rollback runbook**

Rollback disables new scheduling and integrations but never deletes jobs, budgets, checklists, ledger entries, or audit events. Existing scheduled jobs remain readable and manually reconcilable. Re-enable the old GHL creation flag only if the app scheduling action is disabled, never both simultaneously.

- [ ] **Step 5: Add integration health endpoint**

Return no secrets. Report last successful outbox delivery by event type, pending/failed/dead-letter counts, last time import, last BILL event, last GHL financial event, and last Slack digest. Protect the route for owner access.

- [ ] **Step 6: Run full verification**

```bash
cd web
npm test
npm run lint
npm run build
cd ..
deno task test
supabase test db
```

Expected: all suites pass, build succeeds, no migration test failure, and integration health shows no unexplained dead letters.

- [ ] **Step 7: Update canonical docs and commit**

Update `CLAUDE.md` and `BUILD_PLAN.md` with the launch timestamp, new schedule authority, schema table inventory, deployed function versions, feature-flag state, known deferred items, and real-job verification evidence.

```bash
git add docs/runbooks web/src/app/api/health web/src/lib/__tests__ CLAUDE.md BUILD_PLAN.md
git commit -m "docs: ship live job profitability workflow runbooks and verification"
```

**Final acceptance gate:** Dane can open the portfolio, identify the most at-risk active job, understand its leading variance, review original versus current versus actual/forecast financials, approve a documented change order, and financially close a completed job. The final record must reconcile approved time, job-coded costs, allocated overhead, final net invoiced revenue, actual processing cost, and immutable audit history.

---

## Dependency graph

```text
Task 1 schema
├── Task 2 estimate economics
├── Task 3 forecast engine
└── Task 4 schedule promotion
    └── Task 5 outbox/calendar

Tasks 1–5
├── Task 6 dashboard
├── Task 7 manual ledger
└── Task 8 checklist/auth
    ├── Task 9 forecast overrides
    ├── Task 10 change orders
    └── Task 11 reconciliation

Tasks 6–11
├── Task 12 Slack
├── Task 13 timekeeping adapter
├── Task 14 BILL
└── Task 15 GHL financial sync

Tasks 1–15
├── Task 16 feedback facts
└── Task 17 launch/E2E
```

## Explicit non-goals for this plan

- Full historical job migration
- Automatic modification of labor, overhead, dump, markup, or card rates
- Per-phase labor/cost attribution inside a job
- Expense splitting across multiple jobs
- Foreman access to financial or profitability data
- Selecting the final timekeeping vendor
- Replacing Gusto payroll
- Using collections as the profitability revenue measure

## Definition of done

- All migrations are committed and reproducible from an empty local Supabase database.
- All existing estimate golden-master pricing tests still pass.
- No accepted estimate receives a job code until app scheduling.
- Scheduling is idempotent and creates one job, one baseline, and retryable integration events.
- Health calculations are deterministic, tested, confidence-aware, and explain their leading reason.
- Checklists and approvals are attributable and immutable.
- Change orders require customer plus Dane approval before current approved revenue/budget changes.
- Actual labor, nonlabor cost, overhead, processing cost, net invoiced revenue, and collections remain distinct.
- Dashboard and portfolio are usable at mobile and desktop widths.
- External corrections update forecasts without duplication and retain audits.
- A launch-date real job completes the entire loop and Dane signs off the result.
