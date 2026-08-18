# Live Job Profitability Health Dashboard Implementation Plan — Version 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every presented estimate, create exactly one operational `JOB-XXXX` only when the accepted work is scheduled, and give Dane a permanent live and historical view of original-versus-current-versus-actual job profitability.

**Architecture:** Extend the existing versioned estimate model and shared TypeScript pricing engine. Supabase remains the canonical estimate, job, budget, actuals, forecast, and audit ledger; the Next.js App Router application is the detailed estimating and operational work surface. GHL remains the CRM/pipeline and communication surface, Google Calendar is a two-way schedule projection, Stripe remains the invoice/payment system, Synder continues carrying Stripe detail into QuickBooks, and external writes are isolated behind an idempotent outbox. The first release works with manual/imported actuals before BILL or a selected timekeeping provider is enabled.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5 strict mode, Tailwind CSS 4, Zod 4, Vitest 4, Supabase Postgres/Auth/Storage/Edge Functions, Deno 2 tests, Google Calendar API, Slack API, GoHighLevel API, BILL Spend & Expense, selected construction timekeeping provider, Gusto payroll.

**Design input:** `docs/superpowers/specs/2026-08-18-live-job-profitability-health-dashboard-design.md`. The decision ledger in this Version 2 plan supersedes that file and Version 1 where they conflict. Task 0A amends the canonical repository documentation before production code begins.

> **Landed in-repo 2026-08-18, approved by Matt with five adjustments** (all folded into the text
> below): (1) estimate-version immutability wording — every persisted version's input fields stay
> immutable under the existing trigger; presentation pins and hashes the exact presented version,
> it does not "freeze the chain"; (2) `estimate_identity_links` is canonical for the estimate-family
> → GHL identity while `ghl_push_state` stays per-version delivery bookkeeping, with a
> deterministic backfill rule; (3) Task 0 is split into **0A — Canonical documentation and plan
> landing** and **0B — BL-7 authentication boundary**, and completing 0A must not be read as the
> auth migration being implemented or verified; (4) Task 5's Google Calendar channel lifecycle is
> fully specified (registry, expiration timestamps, renewal before expiry, overlap deduplication,
> renewal-failure alerts, periodic reconciliation fallback); (5) Stripe native reminders + the
> weekly AR digest are deferred with an explicit owner and activation criterion, not dropped.
> Version 1 of this plan is archived at
> `docs/archive/2026-08-18-live-job-profitability-health-dashboard.md`.

## Version 2 decision ledger

- The GHL opportunity exists throughout the commercial and operational lifecycle. It is not the canonical financial job record.
- The exact GHL pipeline is: `New Lead`, `Intake/Qualification`, `Estimate in Progress`, `Quote Sent`, `Quote Accepted`, `Job Scheduled`, `Job in Progress`, `Job Completed`, `Invoice Review`, `Invoice Sent`, `Paid/Closed (Won)`, `Closed Lost (Declined)`.
- Creating an estimate in the app creates or explicitly links a GHL contact and opportunity at `Estimate in Progress`. Starting from GHL opens the same estimate workflow with contact/opportunity prefill.
- Every persisted estimate version's input fields remain immutable under the existing `enforce_estimate_immutability` trigger — a change, before or after presentation, creates another version in the same chain. Presentation pins and hashes the exact presented version. The existing limited mutable fields (`status`, `quoted_price`, `quote_override_reason`, `job_number`) are preserved. Acceptance points to one exact presented version and moves GHL to `Quote Accepted`.
- Dane and authorized estimators may record electronic or off-system acceptance. Manual acceptance requires method, customer contact, effective date, recorder, note, and optional evidence. Reversals append audit history and return to `Quote Sent` or `Closed Lost (Declined)`; they never erase the acceptance.
- One accepted estimate can create exactly one operational job. Separate additional work requires a separate estimate and job.
- `Quote Accepted` is still pre-job. Scheduling is the only action that mints `JOB-XXXX`, snapshots the original budget, provisions integrations, and moves GHL to `Job Scheduled`.
- A scheduled cancellation preserves the job and all facts. Postponed/reschedulable work returns GHL to `Quote Accepted`; definitively lost work moves to `Closed Lost (Declined)`.
- Multi-day work uses one all-day Google Calendar event spanning all scheduled service dates and one operational job. Google Calendar and the app synchronize start/end dates in both directions. Calendar deletion creates a `Scheduling Required` exception; only an explicit app confirmation unschedules the job.
- A foreman's start checklist moves GHL and the internal job to `Job in Progress`. Each multi-day service date can have an end-of-day checklist. A final completion checklist always moves both to `Job Completed`, even if workers remain clocked in.
- `Job Completed` means operationally complete, not financially closed. Open clocks generate an exception and Slack alert but never block completion.
- Dane manually advances `Job Completed` to `Invoice Review`. Stripe `invoice.sent` advances GHL to `Invoice Sent`. Stripe full payment advances GHL to `Paid/Closed (Won)` while an as-yet-unclosed internal job becomes `Paid — Reconciliation Pending`; payment alone does not reopen an already closed job.
- Dane alone financially closes the internal job. Closure creates an immutable snapshot; the job and every prior snapshot remain searchable forever. A late cost or correction marks the job `Reconciliation Required`, alerts Dane, and a later re-close creates another immutable closure version.
- Automated financial-close blockers are deferred. Version 2 shows warnings and unresolved exceptions but allows Dane to exercise judgment.
- Foremen require authenticated mobile access. Authenticated access for other hourly employees and foreman financial visibility are deferred.
- Foremen approve corrections for their crews. Dane can approve or override any labor correction. All corrections preserve before/after values, reason, actor, and time.
- The mobile Job Checklist supports offline drafts and an idempotent submission queue with visible `Saved Offline`, `Syncing`, `Submitted`, and `Needs Attention` states.
- Timekeeping is decided as Phase D1/D2 (Matt, 2026-08-18). **Phase D1 — unblocked:** canonical job-time schema, manual/CSV import, foreman approval, Dane override, labor-cost attribution, audit history, and the provider-neutral adapter contract. **Phase D2 — deferred:** vendor evaluation and the production connector. Any future vendor must automatically accept `JOB-XXXX` and return corrected/approved job-coded time; ClockShark, busybusy, a custom application, and other providers are evaluated against the same contract. Gusto remains payroll; the Gusto timekeeping/add-on question stays parked until vendor evaluation.
- Stripe direct invoicing, Stripe webhooks, Synder, and QuickBooks remain the approved invoicing/accounting architecture. GHL receives statuses and deep links; GHL is not the invoice source of truth.

## System authority and work-surface contract

| Concern | Canonical authority | Primary work surface | Projection/feed rule |
|---|---|---|---|
| Contacts, companies, lead communication | GHL | GHL | App reads/prefills and stores stable GHL IDs; no silent merge |
| Estimate inputs, versions, economics, acceptance audit | Supabase | Estimator app | App projects headline values, stage, and deep link to GHL |
| Opportunity pipeline | GHL | GHL plus automated transitions | App/Stripe/checklists request named stage changes through outbox |
| Operational job and `JOB-XXXX` | Supabase | Operations app | Created only by scheduling the current accepted estimate |
| Dates and all-day schedule | Supabase canonical schedule with audited Calendar input | App and Google Calendar | Two-way dates only; deletion creates an exception |
| Job checklists and operational forecast | Supabase | Authenticated mobile operations area | Slack receives actionable exceptions only |
| Actual labor | Supabase normalized approved-time ledger | Manual/import first; provider later | Provider must provision/return job-coded corrected approved time |
| Payroll | Gusto | Gusto | Gusto timekeeping is not the future job-time authority; Version 2 leaves payroll submission unchanged until the provider/payroll handoff is selected and tested |
| Expenses | BILL source transaction; Supabase attribution ledger | BILL plus app reconciliation queue | Unassigned is never silently overhead |
| Invoices and payments | Stripe | App invoice review plus Stripe-hosted customer experience | GHL receives stages/link; Synder carries detail to QBO |
| Accounting books | QuickBooks through Synder | QuickBooks | No direct QBO writer in Version 2 |
| Profitability, closure history, pricing facts | Supabase | Dane dashboard | Every close/re-close remains permanent and searchable |
| Notifications | Supabase alert state | Slack and in-app action queue | Slack delivery is idempotent; in-app queue remains authoritative |

## GHL transition contract

| GHL stage | Trigger | Supabase effect |
|---|---|---|
| `New Lead` | GHL intake | Contact/opportunity link only |
| `Intake/Qualification` | Existing GHL workflow | No estimate or job requirement |
| `Estimate in Progress` | First saved app estimate or linked GHL start | Create/link estimate family; no job |
| `Quote Sent` | `presentEstimate()` | Freeze presented estimate version and hash |
| `Quote Accepted` | Electronic/manual acceptance | Append acceptance event and set current accepted projection; no job |
| `Job Scheduled` | `schedule_estimate()` | Mint/reuse exactly one `JOB-XXXX`, budget v1, schedule/outbox |
| `Job in Progress` | Authenticated foreman start checklist | Transition job to `in_progress` |
| `Job Completed` | Authenticated foreman completion checklist | Transition job to `completed` even with open time |
| `Invoice Review` | Dane `begin_invoice_review()` | Set internal `invoice_review`; do not send automatically |
| `Invoice Sent` | Verified Stripe `invoice.sent` | Store/upsert invoice revenue and set `invoice_sent` |
| `Paid/Closed (Won)` | Verified full-payment event | Store payment separately and set `paid_reconciliation_pending` |
| `Closed Lost (Declined)` | Acceptance reversal or confirmed final cancellation | Preserve estimate/job/audit facts; mark canceled when a job exists |

Postponed scheduled work returns GHL to `Quote Accepted` while preserving the canceled/reschedulable `JOB-XXXX`; rescheduling reuses that job. Internal financial closure never changes the GHL paid stage and never hides the job.

## Global Constraints

- Supabase and the estimator application own estimates, jobs, budgets, actual-cost attribution, forecasts, change orders, profitability, and audits.
- Scheduling in the estimator application is the only primary action that creates `JOB-XXXX`; Google Calendar is a two-way schedule projection for controlled schedule fields only.
- Estimate acceptance moves GHL to `Quote Accepted`, never creates a job, and identifies the exact accepted presented version.
- Every persisted estimate version's input fields remain immutable under the existing trigger; corrections before or after presentation create a new version in the same chain. Presentation pins and hashes the exact presented version. Only the existing limited mutable fields (`status`, `quoted_price`, `quote_override_reason`, `job_number`) change after insert.
- One accepted estimate creates at most one operational job.
- Existing customer prices do not change merely because operational costs and pricing allowances are separated.
- Existing quote math remains cost-plus markup: labor `$26/hr`, overhead `$23/hr`, dump pricing `$300/load`, card allowance `3.5%`, default markup `25%`, advisory floor `15%`.
- Economic profit, not entered markup, is the primary dashboard profit metric.
- Current approved revenue equals accepted quote plus customer-authorized and internally approved change orders.
- Final actual revenue equals final invoiced revenue net of credits and refunds; collected cash is separate.
- Actual job overhead is allocated from productive hours. Crew and company overhead remain separate analytical pools but feed one blended rate.
- Actual labor uses employee-specific burdened rates effective on the work date.
- Actual costs stay at job/category granularity; no operational phase attribution is required.
- A medium/low-confidence forecast cannot display On Track.
- Dane is the change-order internal approver, forecast reviewer, Slack alert recipient, invoice-review initiator, and only financial-close approver.
- Foreman financial visibility is deferred; operational routes must not expose price, burden rates, markup, overhead dollars, or profit.
- No full historical job migration. New workflow applies to jobs scheduled after the launch timestamp, while all new estimates—including lost estimates—remain queryable.
- No production path deletes presented estimates, acceptance events, operational jobs, budget versions, ledger audits, or closure snapshots. Canceled and financially closed jobs remain searchable to Dane indefinitely.
- Timekeeping providers are disqualified unless they accept `JOB-XXXX` automatically and return corrected/approved job-coded time.
- All external writes are idempotent and retryable. External failure never rolls back a canonical job or approved financial record.
- RLS is enabled on every new table. Service-role access remains server-only. Task 0B must resolve BL-7 before any foreman account is created; do not blindly re-grant the legacy functions or activate the silent `handle_new_auth_user()` trigger.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, GHL credentials, Google service-account JSON, Slack tokens, BILL tokens, or webhook secrets to client components.
- Money is stored as `numeric(12,2)` and normalized to JavaScript numbers at repository boundaries. Percentages are stored as whole-number percentages unless the column name ends in `_rate`, which stores a decimal fraction.
- All money calculations use `roundToCent()` from the shared pricing engine or the same decimal half-up convention.
- Existing `ghl-job-webhook` deployments must retain `verify_jwt=false`; deploy with `--no-verify-jwt` and read the deployed setting back after every deployment.
- Do not use `supabase db reset`, `supabase db push`, or claim empty-database reproducibility until the five live-only legacy functions are represented in a verified harness. Schema work is first validated against an isolated database branch/clone of the live schema, then applied through the repository's established Supabase migration workflow.
- Each task uses TDD and ends in a focused commit.

## Execution packaging

This document is the program map and the complete technical contract. It is **not** permission to deploy all phases in one pass. Each phase below is an independently reviewable vertical slice and must end with its stated acceptance gate, canonical documentation update, and Dane sign-off before the next phase begins. If rollout learning changes a later phase, amend this plan and the canonical `BUILD_PLAN.md`; do not create a competing architecture document.

## Delivery map

| Phase | Working outcome | Tasks |
|---|---|---|
| 0 — Canonical alignment and safety | Repository decisions, BL-7 auth path, migration validation, and deploy invariants are explicit | 0A–0B |
| 1 — Commercial-to-job foundation | Preserve presented estimates, accept/reverse them, schedule exactly one official job, and synchronize GHL/Calendar | 1–5 |
| 2 — Manual profitability | Calculate health from manual facts and give Dane the live dual-view dashboard | 6–7 |
| 3 — Authenticated field operations | Foreman auth, offline checklists, lifecycle automation, and audited forecasts | 8–9 |
| 4 — Change, completion, and money | Change orders, invoice-review state, reconciliation, closure snapshots, and reopen/re-close | 10–11 |
| 5 — External automation | Slack, provider-neutral approved time, BILL expenses, Stripe/Synder/QBO, and GHL projections | 12–15 |
| 6 — Launch and learning substrate | Historical pricing facts, new-workflow rollout, and one real job end to end | 16–17 |

---

## Phase 0 — Canonical alignment and engineering safety

Task 0 is split (Matt, 2026-08-18): **Task 0A** is documentation only; **Task 0B** implements the
BL-7 authentication boundary. **Completing 0A must not be read as implying the authentication
migration has been implemented or verified** — only 0B's passing assertions mean that.

### Task 0A: Canonical documentation and plan landing

**Files:**
- Modify: `BUILD_PLAN.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-18-live-job-profitability-health-dashboard-design.md`
- Create: `docs/runbooks/profitability-schema-validation.md`

**Interfaces:**
- Consumes: BL-7 evidence in `BUILD_PLAN.md` and the Version 2 decision ledger.
- Produces: amended canonical documentation; the documented schema-validation workflow used by every migration task; the recorded `ghl-job-webhook verify_jwt=false` deployment invariant.

- [ ] **Step 1: Amend the canonical lifecycle and integration decisions**

Update `BUILD_PLAN.md`, `CLAUDE.md`, and the design spec with the Version 2 decision ledger above. Explicitly replace “Quote Accepted creates a job” with “Quote Accepted records the accepted presented estimate; Job Scheduled creates the operational job.” Preserve direct Stripe → Synder → QuickBooks invoicing. Mark Phase D as `provider-neutral/manual-import first; vendor selection deferred`, not blocked.

- [ ] **Step 2: Document migration validation and production application**

In `docs/runbooks/profitability-schema-validation.md`, require this sequence for every schema task:

1. Create/refresh a disposable database branch from the live schema.
2. Record migration-table head and row counts for touched tables.
3. Apply the exact migration SQL to the branch using Supabase migration tooling/MCP.
4. Run the task's transactional SQL assertions on the branch.
5. Run all web and Edge Function unit tests.
6. Commit the identical SQL that passed.
7. Apply to production only during the phase rollout window.
8. Re-run read-only assertions and row counts; never attempt down-migration data deletion.

- [ ] **Step 3: Document the webhook deployment invariant**

Add to `CLAUDE.md` and the runbook:

```bash
supabase functions deploy ghl-job-webhook --project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt
supabase functions list --project-ref eiqqqwajmcpcwhvxxnhx
```

Expected: the readback reports `ghl-job-webhook` with JWT verification disabled. Any deployment lacking the explicit flag is a failed deployment and must not receive production traffic.

- [ ] **Step 4: Commit the documentation**

```bash
git add BUILD_PLAN.md CLAUDE.md docs/superpowers/specs \
  docs/runbooks/profitability-schema-validation.md
git commit -m "docs: align profitability v2 decisions and validation workflow"
```

### Task 0B: BL-7 authentication boundary

**Files:**
- Create: `supabase/migrations/20260818143000_workforce_auth_boundary.sql`
- Create: `supabase/tests/workforce_auth_boundary_test.sql`

**Interfaces:**
- Consumes: live-only `handle_new_auth_user()`, `get_my_role()`, `get_my_crew_id()`, and the seven legacy RLS policies.
- Produces: one implemented, verified workforce identity path used by Task 8. Documentation (0A) alone does not produce this.

- [ ] **Step 1: Write failing BL-7 assertions against an isolated live-schema clone**

Create `supabase/tests/workforce_auth_boundary_test.sql`:

```sql
begin;
select plan(7);
select has_table('public', 'workforce_profiles');
select has_column('public', 'workforce_profiles', 'auth_user_id');
select has_column('public', 'workforce_profiles', 'role');
select function_privs_are(
  'public', 'get_my_role', array[]::text[], 'authenticated', array[]::text[]
);
select function_privs_are(
  'public', 'get_my_crew_id', array[]::text[], 'authenticated', array[]::text[]
);
select isnt_empty(
  $$select 1 from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal$$
);
select policies_are('public', 'workforce_profiles', array['workforce_self_read','workforce_owner_all']);
select * from finish();
rollback;
```

Run these assertions through the Supabase SQL test runner against a disposable database branch cloned from the live schema. Expected: FAIL because `workforce_profiles` and its policies do not exist. Do not run `supabase db reset`; the repository cannot replay the five live-only functions from empty state.

- [ ] **Step 2: Implement an isolated workforce identity boundary**

Create `20260818143000_workforce_auth_boundary.sql` with `workforce_profiles(auth_user_id uuid primary key references auth.users(id), display_name text not null, role text check (role in ('pending','owner','foreman')), crew_external_id text, active boolean default false, created_at timestamptz default now(), updated_at timestamptz default now())`. Enable RLS. Add policies based directly on `auth.uid()` and a server-maintained owner profile lookup; do not query legacy `public.users`, `public.crews`, or `public.time_entries` and do not re-grant `get_my_role()` or `get_my_crew_id()`. Preserve the existing no-login estimator picker; estimator actions record the selected estimator identity and `actor_assurance='selected_identity'`, while Dane/foreman actions record `actor_assurance='authenticated'`.

Keep the existing `on_auth_user_created` trigger attachment but replace its function body explicitly:

```sql
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workforce_profiles (auth_user_id, display_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'pending',
    false
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to supabase_auth_admin, service_role;
```

This ends the silent no-op without inserting into legacy `public.users` or activating its policies. Task 8 adds an owner-only activation action that changes a pending profile to `owner` or `foreman` and sets crew assignment.

- [ ] **Step 3: Re-run assertions and commit**

Expected: all seven SQL assertions pass on the disposable branch; a new foreman auth user receives a `workforce_profiles` row and no `public.users` row; authenticated reads of legacy `users`, `crews`, and `time_entries` are not used by the application.

```bash
git add supabase/migrations/20260818143000_workforce_auth_boundary.sql \
  supabase/tests/workforce_auth_boundary_test.sql
git commit -m "feat: implement BL-7 workforce authentication boundary"
```

**Phase 0 gate:** Task 0A — canonical documentation contains no conflicting job-creation or invoicing ownership statement, the migration-validation workflow is documented, and the `ghl-job-webhook` deploy invariant is recorded. Task 0B — BL-7 has a tested, verified implementation on a live-schema clone. The gate requires **both**; 0A alone does not satisfy it.

---

## Phase 1 — Commercial-to-job foundation

### Task 1: Canonical profitability schema

**Files:**
- Create: `supabase/migrations/20260818150000_profitability_lifecycle_types.sql`
- Create: `supabase/migrations/20260818151000_profitability_core_schema.sql`
- Create: `supabase/tests/profitability_core_schema_test.sql`

**Interfaces:**
- Consumes: existing `jobs(job_number)`, `estimates(id, job_number)`, `auth.users(id)`, and `next_job_number()`.
- Produces: enums and tables named below; Tasks 2–17 depend on these exact names.

- [ ] **Step 1: Write the schema smoke test**

Create `supabase/tests/profitability_core_schema_test.sql`:

```sql
begin;
select plan(20);

select has_enum('public', 'job_health_status');
select has_enum('public', 'forecast_confidence');
select has_enum('public', 'cost_category');
select has_enum('public', 'ledger_state');
select has_enum('public', 'reconciliation_state');
select has_enum('public', 'checklist_type');
select has_enum('public', 'change_order_status');
select has_enum('public', 'job_financial_status');
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
select has_table('public', 'job_schedule_exceptions');
select has_table('public', 'job_financial_closure_snapshots');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and verify it fails**

Run the SQL file through the branch SQL test runner defined in Task 0A.

Expected: FAIL because the new enums and tables do not exist.

- [ ] **Step 3: Add financial lifecycle values without misusing the operational lifecycle**

Create `supabase/migrations/20260818150000_profitability_lifecycle_types.sql`:

```sql
do $$ begin
  create type public.job_financial_status as enum (
    'not_ready',
    'invoice_review',
    'invoice_sent',
    'paid_reconciliation_pending',
    'financially_closed',
    'reconciliation_required'
  );
exception when duplicate_object then null; end $$;
```

Do not add pre-job stages to `job_lifecycle`: no `jobs` row exists at `Quote Accepted`. Use existing `scheduled`, `in_progress`, `completed`, `paid`, and `cancelled` values for operational state, while `job_financial_status` tracks the internal money lifecycle independently of GHL.

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
create type public.schedule_exception_status as enum ('open','rescheduled','unscheduled','dismissed');
```

Add these columns without touching legacy job columns:

```sql
alter table public.jobs
  add column if not exists original_estimate_id uuid references public.estimates(id),
  add column if not exists original_estimate_number integer unique,
  add column if not exists current_budget_version integer,
  add column if not exists financial_status public.job_financial_status not null default 'not_ready',
  add column if not exists financially_closed_at timestamptz,
  add column if not exists financially_closed_by uuid references auth.users(id),
  add column if not exists financially_closed_by_name text,
  add column if not exists launch_workflow boolean not null default false,
  add column if not exists last_forecast_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists calendar_sync_revision bigint not null default 0;
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
  client_submission_id uuid not null,
  service_date date not null,
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
  source_created_at timestamptz not null,
  unique (submitted_by, client_submission_id),
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

create table public.job_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  external_event_id text,
  kind text not null check (kind in ('calendar_deleted','calendar_conflict','sync_failed')),
  status public.schedule_exception_status not null default 'open',
  previous_schedule jsonb not null,
  incoming_event jsonb,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_note text
);

create table public.job_financial_closure_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_number text not null references public.jobs(job_number),
  closure_version integer not null check (closure_version > 0),
  budget_version integer not null,
  financials jsonb not null,
  unresolved_exceptions jsonb not null default '[]',
  closed_by uuid not null references auth.users(id),
  closed_by_name text not null,
  closed_at timestamptz not null default now(),
  unique (job_number, closure_version)
);
```

Create server-only helper `mark_job_reconciliation_required(p_job_number text, p_source_kind text, p_source_id text)`. It returns immediately when no closure snapshot exists. Otherwise it sets `jobs.financial_status='reconciliation_required'`, leaves every closure snapshot byte-for-byte unchanged, inserts one open `job_alerts` fingerprint `reconcile:<source-kind>:<source-id>`, and inserts one Slack outbox event with the same idempotency key. Revoke it from `public`, `anon`, and `authenticated`; ledger/change-order/time/Stripe RPCs invoke it within their server-controlled transactions.

Add indexes on every `job_number`, on `job_cost_entries(reconciliation_state, incurred_at)`, `job_checklists(job_number, submitted_at desc)`, `job_alerts(resolved_at, severity)`, and `integration_outbox(status, available_at)`.

Enable RLS on all new tables. Grant no access to `anon`. Add authenticated policies only in Task 8 when authenticated operational routes exist.

Add immutable UPDATE/DELETE triggers to `estimate_financial_details`, `job_budget_versions`, `change_order_versions`, `change_order_approvals`, `job_checklists`, `job_forecast_snapshots`, and `job_financial_closure_snapshots`. Corrections to those records are append-only.

- [ ] **Step 5: Validate on the disposable live-schema branch**

Apply both migrations to a disposable branch per the Task 0A process, run `profitability_core_schema_test.sql`, and expect 20 assertions to pass. Then run `deno task test` and expect the existing Deno suite to remain green. Confirm no row count changed in legacy `jobs`, `users`, `crews`, or `time_entries`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818150000_profitability_lifecycle_types.sql \
  supabase/migrations/20260818151000_profitability_core_schema.sql \
  supabase/tests/profitability_core_schema_test.sql
git commit -m "feat: add canonical job profitability schema"
```

---

### Task 2: Versioned commercial estimates and economic details without changing quote math

**Files:**
- Create: `web/src/lib/profitability/estimateEconomics.ts`
- Create: `web/src/lib/profitability/__tests__/estimateEconomics.test.ts`
- Modify: `web/src/lib/estimates/types.ts`
- Modify: `web/src/lib/estimates/validate.ts`
- Modify: `web/src/lib/estimates/map.ts`
- Modify: `web/src/lib/estimates/repo.ts`
- Modify: `web/src/lib/estimates/lifecycle.ts`
- Create: `web/src/lib/estimates/commercialLifecycle.ts`
- Create: `web/src/lib/estimates/__tests__/commercialLifecycle.test.ts`
- Modify: `web/src/lib/ghl/client.ts`
- Create: `web/src/lib/ghl/pipeline.ts`
- Create: `web/src/lib/ghl/prefill.ts`
- Create: `web/src/lib/ghl/__tests__/prefill.test.ts`
- Modify: `web/src/app/(app)/estimates/actions.ts`
- Modify: `web/src/app/(app)/estimates/_components/EstimateBuilder.tsx`
- Modify: `supabase/migrations/20260814215000_phase_b_estimates_fixups.sql` only through a new follow-up migration
- Create: `supabase/migrations/20260818152000_create_estimate_economic_details.sql`
- Create: `supabase/migrations/20260818152500_estimate_commercial_lifecycle.sql`

**Interfaces:**
- Consumes: `computeEstimate()`, `roundToCent()`, `EstimateDraft`, and `estimate_financial_details`.
- Produces: `computeEstimateEconomics(input: EstimateEconomicsInput): EstimateEconomicsOutput`; explicit GHL identity linkage; immutable presentation/acceptance history; extended estimate drafts with category-specific operational costs.

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

Before the test run, create `20260818152500_estimate_commercial_lifecycle.sql`:

```sql
create type public.estimate_acceptance_action as enum ('accepted','reversed');
create type public.actor_assurance as enum ('authenticated','selected_identity','external_webhook');

create table public.estimate_identity_links (
  estimate_number integer primary key,
  ghl_contact_id text not null,
  ghl_opportunity_id text not null unique,
  linked_by_name text not null,
  actor_assurance public.actor_assurance not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.estimate_presentations (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null unique references public.estimates(id),
  presented_via text not null check (presented_via in ('ghl','email','print','other')),
  presented_by_name text not null,
  actor_assurance public.actor_assurance not null,
  snapshot_hash text not null,
  presented_at timestamptz not null default now()
);

create table public.estimate_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id),
  action public.estimate_acceptance_action not null,
  authorization_method public.customer_authorization_method,
  customer_contact_name text,
  effective_at timestamptz not null,
  recorded_by_auth_user_id uuid references auth.users(id),
  recorded_by_name text not null,
  actor_assurance public.actor_assurance not null,
  note text not null,
  evidence_paths text[] not null default '{}',
  supersedes_event_id uuid references public.estimate_acceptance_events(id),
  reversal_destination text check (reversal_destination in ('quote_sent','closed_lost')),
  created_at timestamptz not null default now(),
  check (
    (action = 'accepted' and authorization_method is not null and customer_contact_name is not null)
    or
    (action = 'reversed' and reversal_destination is not null)
  )
);

create table public.estimate_acceptance_state (
  estimate_number integer primary key,
  current_estimate_id uuid not null references public.estimates(id),
  accepted boolean not null,
  current_acceptance_event_id uuid references public.estimate_acceptance_events(id),
  last_event_id uuid not null references public.estimate_acceptance_events(id),
  updated_at timestamptz not null default now()
);
```

`estimate_identity_links` is the **canonical** estimate-family → GHL contact/opportunity relationship. `ghl_push_state` remains per-version delivery bookkeeping only — estimate-doc IDs, push timestamps, attempts, and errors — and is never read as identity authority. Backfill deterministically and idempotently: for each estimate family that has `ghl_push_state` rows, seed `estimate_identity_links` from the most recent row (order by `fields_pushed_at` desc nulls last, then `updated_at` desc); if rows within one family disagree on contact or opportunity ID, do not guess — open a manual-review exception for that family and skip it. Re-running the backfill never overwrites an existing link.

Do not overwrite or delete an accepted event. Implement `record_estimate_acceptance_event(p_event jsonb)` as a transactionally locked RPC: append the event, then upsert the mutable `estimate_acceptance_state` projection for the estimate number. An `accepted` event sets the exact presented `current_estimate_id`; a `reversed` event clears the current acceptance. Re-acceptance after a reversal appends a new event and points the projection to the newly accepted presented version. Scheduling reads only this projection and can therefore never select a reversed acceptance.

Implement these exact server interfaces:

```ts
export interface EstimateIdentitySelection {
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  createContact: boolean;
  createOpportunity: boolean;
}

export interface RecordAcceptanceInput {
  estimateId: string;
  method: "signature" | "email" | "text" | "verbal" | "other";
  customerContactName: string;
  effectiveAt: string;
  recordedByName: string;
  note: string;
  evidencePaths: string[];
}

export async function presentEstimate(estimateId: string): Promise<void>;
export async function recordEstimateAcceptance(input: RecordAcceptanceInput): Promise<void>;
export async function reverseEstimateAcceptance(input: {
  estimateId: string;
  destination: "quote_sent" | "closed_lost";
  reason: string;
  recordedByName: string;
}): Promise<void>;
```

App-first creation must search GHL by stable contact ID, email, and phone, show possible matches, and require explicit contact/opportunity selection or creation. Never silently merge. GHL-first entry uses `/estimates/new?ghlOpportunityId=<id>` and pre-fills contact/company fields. Creating the first saved estimate ensures the linked GHL opportunity is at `Estimate in Progress`; presenting moves it to `Quote Sent`; accepting moves it to `Quote Accepted`; reversing moves it to the selected destination. Centralize configured pipeline stage IDs in `web/src/lib/ghl/pipeline.ts`, not string literals distributed across actions.

Write tests proving: drafts do not create presentations; presenting stores an immutable version/hash; acceptance references a presented estimate; a reversal preserves acceptance history; scheduling eligibility is false after reversal; duplicate contact suggestions never auto-merge; one opportunity can link to only one active estimate family.

- [ ] **Step 7: Test all estimate paths**

Run:

```bash
cd web
npm test -- --run src/lib/profitability/__tests__/estimateEconomics.test.ts
npm test -- --run src/lib/estimates src/app/\(app\)/estimates/__tests__/actions.test.ts
npm test -- --run src/lib/ghl
npm run build
```

Expected: all tests pass; build succeeds; the existing Jorge total remains `$2,543.51`.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/profitability web/src/lib/estimates \
  'web/src/app/(app)/estimates/_components/EstimateBuilder.tsx' \
  web/src/app/\(app\)/estimates/actions.ts web/src/lib/ghl \
  supabase/migrations/20260818152000_create_estimate_economic_details.sql \
  supabase/migrations/20260818152500_estimate_commercial_lifecycle.sql
git commit -m "feat: version estimate economics and commercial acceptance"
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
  jobStatus: "scheduled" | "in_progress" | "completed" | "paid" | "cancelled";
  financialStatus: "not_ready" | "invoice_review" | "invoice_sent" |
    "paid_reconciliation_pending" | "financially_closed" | "reconciliation_required";
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

- Checklist current: within 36 hours while status is In Progress; checklist age does not reduce confidence after Job Completed.
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
- Consumes: `estimate_acceptance_state` pointing to an accepted, presented estimate with `estimate_financial_details` and no existing operational job.
- Produces: `schedule_estimate(p_estimate_id, p_schedule, p_actor, p_actor_name)`, `scheduleEstimateAction()`, exactly one canonical job per estimate family, original budget v1, GHL stage projection, and a `job.scheduled` outbox event.

- [ ] **Step 1: Test schedule validation**

Define:

```ts
export interface ScheduleEstimateInput {
  estimateId: string;
  crew: string;
  startDate: string;
  endDate: string;
}
```

Zod must enforce UUID estimate ID, nonblank crew, ISO dates, and `endDate >= startDate`. These are inclusive service dates; the Google adapter converts them to Calendar's exclusive all-day `end.date`.

- [ ] **Step 2: Implement the transactional RPC**

`schedule_estimate` must lock the estimate row and enforce:

- It is exactly the presented estimate referenced by the current accepted projection.
- The latest acceptance event has not been reversed.
- `job_number` is null.
- Financial details exist.
- No operational job already belongs to the estimate family.

Inside one transaction:

1. Mint `next_job_number()`.
2. Insert `jobs` with `status_v2='scheduled'`, `launch_workflow=true`, identity/contact fields copied from the estimate, schedule fields, and `original_estimate_id`.
3. Insert `job_budget_versions` version 1 from `estimate_financial_details` and estimate rate snapshots.
4. Set `jobs.current_budget_version=1`.
5. Call existing `update_estimate_job_number` behavior inside the function using transaction-local actor settings.
6. Insert a successful `job_events` row.
7. Insert `integration_outbox` events `job.scheduled` and `ghl.stage.requested` (`Job Scheduled`) with stable idempotency keys.
8. Return the created job row.

A repeated call for the same estimate family must return the already linked job and must not mint a second number or baseline. Add a unique stable estimate-family key to `jobs`. When a canceled/reschedulable job is scheduled again, reactivate the same `JOB-XXXX`, retain budget v1, append a scheduling audit event, and create a new schedule outbox revision.

- [ ] **Step 3: Add the scheduling UI**

Display “Schedule job” only for the currently accepted estimate. The form requires crew, inclusive start date, and inclusive end date and explicitly labels the event “All day.” On success, navigate to `/jobs/<JOB-XXXX>`.

- [ ] **Step 4: Retire quote-acceptance job creation**

Change the GHL Quote Accepted handler so it records/links acceptance state but does not insert into `jobs` and does not call `next_job_number()`. Its response must say `quote_accepted_awaiting_schedule`. Keep the legacy behavior behind `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false`; production must set it to `false` before launch and the flag is removed after the launch validation period.

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

After tests, deploy the modified function and verify the Task 0A invariant:

```bash
supabase functions deploy ghl-job-webhook --project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt
supabase functions list --project-ref eiqqqwajmcpcwhvxxnhx
```

Expected readback: `ghl-job-webhook` still has JWT verification disabled.

```bash
git add supabase/migrations/20260818153000_schedule_estimate_rpc.sql \
  web/src/lib/jobs 'web/src/app/(app)/jobs' \
  'web/src/app/(app)/estimates/[id]' supabase/functions/ghl-job-webhook
git commit -m "feat: make app scheduling the canonical job creation action"
```

---

### Task 5: Outbox dispatcher, two-way Google Calendar schedule sync, and cancellation

**Files:**
- Create: `supabase/migrations/20260818154000_outbox_claim_rpc.sql`
- Create: `supabase/functions/integration-dispatcher/index.ts`
- Create: `supabase/functions/integration-dispatcher/handlers.ts`
- Create: `supabase/functions/integration-dispatcher/handlers_test.ts`
- Modify: `supabase/functions/_shared/google.ts`
- Create: `supabase/functions/google-calendar-webhook/index.ts`
- Create: `supabase/functions/google-calendar-webhook/handlers.ts`
- Create: `supabase/functions/google-calendar-webhook/handlers_test.ts`
- Create: `web/src/lib/jobs/scheduleActions.ts`
- Create: `web/src/lib/jobs/__tests__/scheduleActions.test.ts`
- Create: `supabase/migrations/20260818155000_schedule_integration_dispatcher.sql`

**Interfaces:**
- Consumes: pending `integration_outbox` rows.
- Produces: idempotent all-day Calendar create/update, audited two-way date synchronization, deletion exceptions, explicit cancel/reschedule actions, GHL stage projections, one crew Slack schedule notification, retry state, and dead-letter alerts.

- [ ] **Step 1: Write dispatcher tests**

Cover:

- `job.scheduled creates one all-day event per configured calendar projection`
- `inclusive two-day job writes exclusive calendar end date on day three`
- `calendar date edit updates canonical schedule and mirrors other projections once`
- `stale calendar revision cannot overwrite a newer app edit`
- `calendar deletion opens scheduling required and does not delete or roll back the job`
- `confirmed postponement cancels the job and returns GHL to quote accepted`
- `confirmed final cancellation moves GHL to closed lost`
- `crew calendar omits financial fields`
- `existing event ids cause update not create`
- `one calendar failure leaves event retryable`
- `five failed attempts mark dead_letter and open a job alert`
- `same idempotency key is never delivered twice after success`
- `scheduled job posts one crew Slack notification without financial fields`
- `watch channel is renewed before expiry and overlapping channels deduplicate notifications`
- `channel renewal failure opens an alert and the reconciliation fallback still detects the change`

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

Build all-day bodies exactly as:

```ts
{
  summary: `${job.jobNumber} — ${job.clientName} — ${job.jobAddress}`,
  start: { date: job.startDate },
  end: { date: addCalendarDays(job.endDate, 1) },
  extendedProperties: {
    private: {
      jobNumber: job.jobNumber,
      scheduleRevision: String(job.calendarSyncRevision),
      managedBy: "lostboys-estimator",
    },
  },
}
```

Google treats `end.date` as exclusive. A job scheduled for August 18–19 must write `start.date=2026-08-18` and `end.date=2026-08-20`. The main and assigned-crew projections represent the same job/schedule revision; they are not separate operational jobs.

- [ ] **Step 4: Implement dispatcher status changes**

On success mark `succeeded`, set `completed_at`, update `jobs.gcal_main_event_id` / `gcal_crew_event_id`, and stamp `jobs.slack_notified_at` after the existing crew-safe schedule message is delivered. On transient failure use exponential retry minutes `min(60, 2 ** attempts)`. At attempt 5 mark `dead_letter` and create an At Risk `job_alerts` row with fingerprint `integration:<outbox-id>`.

- [ ] **Step 5: Schedule every five minutes**

Follow the existing `crew-night-before` cron pattern. Store the dispatcher URL and shared secret in Vault. The function must reject missing or invalid `x-webhook-secret`.

- [ ] **Step 6: Implement inbound Calendar reconciliation with a managed channel lifecycle**

Maintain a `calendar_watch_channels` registry table: `channel_id`, `resource_id`, `calendar_id`, `token_hash`, `registered_at`, `expires_at`, `status` (`active`, `superseded`, `expired`, `renewal_failed`), `last_notification_at`. Google Calendar watch channels expire on the order of days, so a renewal job runs ahead of each `expires_at`: it registers the replacement channel **before** stopping the old one, then marks the old row `superseded`. During the overlap window, deduplicate notifications by `(resource_id, event id, event updated timestamp)` so overlapping channels cannot double-apply one change. A failed renewal marks the row `renewal_failed`, opens a `job_alerts`/Slack alert, and degrades to outbound-only projection — it never breaks app→Calendar pushes. Independent of push delivery, a periodic reconciliation fallback polls managed events and compares them against the canonical schedule, catching changes missed while a channel was expired or failing.

Verify the Google channel token, fetch the changed event by stored event ID, and ignore events without `extendedProperties.private.managedBy`. For a newer schedule revision/date change, call an audited RPC that updates only `jobs.start_date`, `jobs.end_date`, and `calendar_sync_revision`; enqueue updates for the other projection and GHL summary. Calendar cannot change crew, scope, prices, lifecycle, or financial data.

When Google reports the event deleted/cancelled, insert one open `job_schedule_exceptions` row and a Slack/outbox alert. Do not update `jobs.status_v2` or GHL automatically.

Implement:

```ts
export async function resolveDeletedCalendarEvent(input: {
  jobNumber: string;
  resolution: "reschedule" | "postponed" | "closed_lost" | "dismiss";
  reason: string;
  startDate?: string;
  endDate?: string;
}): Promise<void>;
```

`reschedule` requires dates, reuses the same job, and returns it to `scheduled`. `postponed` sets internal `cancelled`, preserves every fact, and queues GHL `Quote Accepted`. `closed_lost` sets internal `cancelled` and queues GHL `Closed Lost (Declined)`. `dismiss` recreates the managed event. Every choice closes the exception and appends an audit event.

- [ ] **Step 7: Test and commit**

Run: `deno test supabase/functions/integration-dispatcher supabase/functions/google-calendar-webhook supabase/functions/_shared/google.ts` and `cd web && npm test -- --run src/lib/jobs && npm run build`.

```bash
git add supabase/functions/integration-dispatcher supabase/functions/google-calendar-webhook \
  supabase/functions/_shared/google.ts web/src/lib/jobs \
  supabase/migrations/20260818154000_outbox_claim_rpc.sql \
  supabase/migrations/20260818155000_schedule_integration_dispatcher.sql
git commit -m "feat: deliver scheduled jobs through a retryable integration outbox"
```

**Phase 1 gate — precondition:** Matt's phone smoke test and at least one real estimate created through the builder (both outstanding since 2026-08-14) must be complete before this gate is attempted — the app-scheduling authority decision assumes the estimate builder is the committed path for every job.

**Phase 1 gate:** In staging, create/link a GHL opportunity, present two estimate versions, accept the second, confirm GHL is `Quote Accepted` and no job exists, then schedule it as a two-day all-day job. Confirm one `JOB-XXXX`, one original budget, correct inclusive Calendar rendering, and GHL `Job Scheduled`. Edit dates in both directions, simulate deletion and resolve it, and prove every retry remains idempotent. Inbound calendar sync (channels, renewal, reconciliation fallback) is its own gated sub-slice inside this phase — the outbound projection must pass its gate without depending on inbound sync being live.

---

## Phase 2 — Manual profitability

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

Test Postgres numeric strings, missing optional values, original/current/actual/forecast column construction, and status sorting `at_risk → watch → on_track → completed → financially_closed`.

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

Each card shows job, client, foreman/crew, workday, forecast profit dollars/percentage, forecast versus approved hours, crew-days remaining, health, confidence, leading reason, and next action. Add filters for Active, Job Completed, Invoice/Reconciliation, Financially Closed, Reconciliation Required, and Canceled. Closed jobs remain searchable and never disappear from historical reporting.

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

**Phase 2 gate:** On a staged scheduled job, enter manual labor, materials, rental, dump, subcontractor, other-direct, processing, invoice, credit, refund, and payment facts. Dane can see original/current/actual+committed/forecast views, health/confidence, leading variance, and full audit detail. Existing quote golden tests remain unchanged.

---

## Phase 3 — Authenticated field operations

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
- Create: `web/src/lib/checklists/offlineQueue.ts`
- Create: `web/src/lib/checklists/__tests__/offlineQueue.test.ts`
- Create: `web/src/lib/workforce/admin.ts`
- Create: `web/src/lib/workforce/__tests__/admin.test.ts`
- Create: `web/public/sw.js`
- Create: `supabase/migrations/20260818160000_ops_auth_and_checklist_storage.sql`

**Interfaces:**
- Consumes: Supabase Auth identity and assigned jobs.
- Produces: authenticated foreman/owner access, offline-safe append-only start/daily/completion checklists, automatic GHL operational-stage events, and `job.checklist.submitted` outbox events.

- [ ] **Step 1: Add Supabase SSR support**

Run: `cd web && npm install @supabase/ssr`

Create browser/server client factories using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `server.ts` uses Next cookies; `proxy.ts` refreshes sessions for `/ops/:path*` and `/jobs/:path*` and redirects unauthenticated users to `/auth/sign-in`.

Do not change the existing no-login estimate route in this task.

`web/src/app/(app)/jobs/layout.tsx` requires an active `owner` profile for financial routes. The `/ops` layout allows active foreman/owner profiles and contains no financial data loader.

- [ ] **Step 2: Extend the Task 0B operational profile boundary and add checklist RLS**

Reuse Task 0B `workforce_profiles`; add only assignment fields needed by the mobile workflow. Do not create a second profile table and do not add hourly-employee accounts in Version 2.

Implement `activateWorkforceProfile(authUserId, role, crewExternalId)` as an owner-only server action. The launch runbook uses service role exactly once to activate Dane's known auth user as `owner`; every later foreman activation must be performed by authenticated Dane and audited. A newly invited account stays `pending/active=false` until that action succeeds.

Create private Storage bucket `job-checklist-photos`. Authenticated foremen can insert checklists only under their own `submitted_by=auth.uid()` and only for scheduled/in-progress jobs assigned to their crew. Owners can read all and act through owner RPCs. Checklist records remain immutable. Policies join `workforce_profiles` directly on `auth.uid()`; they must not call legacy `get_my_role()` or `get_my_crew_id()`, which remain revoked.

- [ ] **Step 3: Test checklist rules**

Test:

- Start requires Scheduled job and `work_complete=false`.
- Daily requires In Progress.
- Completion requires `work_complete=true`.
- Remaining workdays/crew size are required unless completion.
- Scope-change flag accepts notes/photos.
- A foreman cannot submit as another user.
- One offline `clientSubmissionId` submitted repeatedly creates one checklist.
- Completion succeeds with open clocks and creates an exception instead of rejecting.
- Start queues GHL `Job in Progress`; completion queues GHL `Job Completed`.

- [ ] **Step 4: Implement transactional submission**

Create RPC `submit_job_checklist(p_job_number, p_type, p_client_submission_id, p_service_date, p_payload)` using `auth.uid()` and a unique `(submitted_by, client_submission_id)` constraint:

- Insert immutable checklist.
- For start, transition Scheduled → In Progress.
- For completion, transition In Progress → Completed without checking whether time entries remain open.
- Insert `job_events` and outbox event.
- For start, enqueue GHL stage `Job in Progress`.
- For completion, enqueue GHL stage `Job Completed`, stop future daily-checklist reminders, and retain the completion answers as the final operational forecast snapshot.
- If completion finds open clocks, open `time:open-at-completion:<job-number>` and enqueue a Slack warning; never roll back the checklist or completion transition.
- For `scope_change_flag=true`, open Watch alert `scope-change:<checklist-id>`.
- Return checklist and resulting job status.

- [ ] **Step 5: Build the mobile UI and offline queue**

The route shows only operational identity, schedule, crew, scope summary, checklist inputs, and photos. It must not query or render estimate value, customer price, costs, rates, markup, overhead, or profit.

Use IndexedDB through `offlineQueue.ts` to persist one envelope per `clientSubmissionId`:

```ts
export interface OfflineChecklistEnvelope {
  clientSubmissionId: string;
  jobNumber: string;
  checklistType: "start" | "daily" | "completion";
  serviceDate: string;
  payload: ChecklistPayload;
  createdAt: string;
  status: "saved_offline" | "syncing" | "submitted" | "needs_attention";
  attempts: number;
  lastError: string | null;
}
```

Cache only assigned job identity, schedule, scope summary, and blank checklist shells. Never cache financial fields. The service worker may cache static assets and safe operational GET responses but never authentication callbacks. On reconnect, submit oldest-first with the stable client ID. A 2xx or `already_submitted` response marks submitted; validation/authorization errors mark `needs_attention`; network/5xx errors retry exponentially. Render the exact labels `Saved Offline`, `Syncing`, `Submitted`, and `Needs Attention`.

- [ ] **Step 6: Test and commit**

```bash
cd web
npm test -- --run src/lib/checklists
npm run lint
npm run build
git add package.json package-lock.json src/lib/supabase src/lib/checklists src/lib/workforce \
  public/sw.js src/proxy.ts src/app/auth 'src/app/(ops)' 'src/app/(app)/jobs/layout.tsx' \
  ../supabase/migrations/20260818160000_ops_auth_and_checklist_storage.sql
git commit -m "feat: add authenticated offline mobile job checklists"
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

**Phase 3 gate:** With network available and unavailable, a foreman signs in, sees only an assigned job without financial fields, submits start/daily/completion checklists, and observes offline states. Start moves internal/GHL state to `Job in Progress`; completion moves both to `Job Completed` even with an open clock, which creates an exception and Slack warning. Dane can see and override the resulting crew-days forecast without changing the foreman submission.

---

## Phase 4 — Change orders, completion, invoicing state, and financial history

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
- If a closure snapshot already exists, call Task 11 `mark_job_reconciliation_required()` so the newly approved revenue/budget is reconciled through a new closure version.

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

### Task 11: Invoice review, versioned financial closure, and automatic re-reconciliation

**Files:**
- Create: `web/src/lib/reconciliation/types.ts`
- Create: `web/src/lib/reconciliation/evaluate.ts`
- Create: `web/src/lib/reconciliation/repo.ts`
- Create: `web/src/lib/reconciliation/__tests__/evaluate.test.ts`
- Create: `web/src/app/(app)/jobs/[jobNumber]/reconcile/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/reconcile/ReconciliationChecklist.tsx`
- Create: `supabase/migrations/20260818162000_financial_close_rpc.sql`

**Interfaces:**
- Consumes: operational completion, known time/cost exceptions, change orders, final Stripe-derived or manual invoice facts, payments, and processing cost.
- Produces: Dane-controlled `Invoice Review`, warning-only close readiness, immutable closure snapshots, perpetual financial visibility, and automatic `Reconciliation Required` after late facts.

- [ ] **Step 1: Test warnings without inventing hard blockers**

Display warnings for each of these exact reasons:

- Job is not `completed`.
- Provisional/unapproved time exists.
- Cost entry needs review or lacks a job.
- Commitment remains open.
- Change order is issued/work-authorized but unresolved.
- Final net invoice is absent.
- Payment-processing cost is absent when card payment exists.
- Checklist exception remains unresolved.

Version 2 has no automated financial-close blocker because the policy was explicitly deferred. Dane must acknowledge every warning and provide one close note; warnings and acknowledgements are stored in the closure snapshot. Do not silently label a job “clean.”

- [ ] **Step 2: Implement invoice-review and close RPCs**

`begin_invoice_review(p_job_number, p_actor, p_note)` requires Dane's authenticated owner profile and `status_v2='completed'`. It sets `financial_status='invoice_review'`, records an audit event, and queues GHL `Invoice Review`. It does not send an invoice.

`financially_close_job(p_job_number, p_expected_snapshot_id, p_acknowledged_warnings, p_close_note)` locks the job, verifies Dane's owner profile, verifies the supplied latest forecast snapshot, re-evaluates warnings server-side, and requires the supplied warning fingerprints to equal the current warning set. It inserts `job_financial_closure_snapshots` with `closure_version=max+1`, the complete original/current/actual/forecast financial payload, warning set, actor, and time. Then set `financial_status='financially_closed'`, stamp the current close fields, insert an immutable final forecast snapshot, and write `job.financially_closed`.

Do not change `status_v2` to a financial enum value. Operational status remains `completed` or `paid`; financial state remains separate.

- [ ] **Step 3: Reopen automatically when late facts arrive**

Every audited insert/correction RPC for `job_cost_entries`, `job_time_entries`, `job_revenue_entries`, change-order approvals, credits, refunds, and processing fees calls `mark_job_reconciliation_required(job_number, source_kind, source_id)`. If the job is financially closed, it:

1. Sets `financial_status='reconciliation_required'`.
2. Leaves the latest closure snapshot byte-for-byte unchanged; `jobs.financial_status` and the appended reconciliation alert identify that it is no longer current.
3. Opens one idempotent alert `reconcile:<source-kind>:<source-id>`.
4. Queues a direct Slack notice to Dane.
5. Leaves every closure snapshot and job page readable.

Dane resolves facts and calls the same close RPC again, producing closure version +1. Historical reporting defaults to the latest closure but permits selection of every prior snapshot.

- [ ] **Step 4: Build the reconciliation/closure UI and commit**

Run: `cd web && npm test -- --run src/lib/reconciliation && npm run build`

```bash
git add web/src/lib/reconciliation 'web/src/app/(app)/jobs/[jobNumber]/reconcile' \
  supabase/migrations/20260818162000_financial_close_rpc.sql
git commit -m "feat: add audited job financial reconciliation and close"
```

**Phase 4 gate:** Run a staged job through a verbally authorized change order, automatic `Job Completed`, Dane `Invoice Review`, warning acknowledgement, and financial close. Insert a late direct cost, prove the prior closure snapshot is unchanged and the job becomes `Reconciliation Required`, then re-close and compare both snapshots. Original budget must never change; current budget changes only after dual approval.

---

## Phase 5 — External automation

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

### Task 13 (Phase D1): Provider-neutral approved-time adapter and import fallback

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
  approved_by_auth_user_id uuid references auth.users(id),
  approved_by_name text,
  approved_at timestamptz,
  correction_reason text,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_record_id)
);

create table public.job_time_entry_audit (
  id bigint generated always as identity primary key,
  job_time_entry_id uuid not null references public.job_time_entries(id),
  old_record jsonb not null,
  new_record jsonb not null,
  reason text not null,
  actor_auth_user_id uuid references auth.users(id),
  actor_name text not null,
  actor_source text not null check (actor_source in ('provider','foreman','owner','import')),
  changed_at timestamptz not null default now()
);
```

Corrections update this canonical row only when `source_updated_at` is newer and write an audit row. A linked `job_cost_entries` labor row is upserted by deterministic source ID `time:<source-system>:<source-record-id>` so corrections replace, never duplicate, labor cost.

The new table is an intentional replacement boundary, not an accidental duplicate. Add comments and repository guards stating that new code must not query or write legacy `public.time_entries`; do not migrate its zero historical rows; do not reuse its seven legacy RLS policies. New policies use `workforce_profiles` and owner/foreman approval RPCs only.

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

Do not build a ClockShark-, busybusy-, or other vendor-specific connector in Version 2. A connector cannot be enabled unless a contract test proves automatic job provisioning and return of corrected/approved job-coded time.

This task is **Phase D1** of the recorded Phase D decision (Matt, 2026-08-18). Vendor evaluation and the production connector are **Phase D2**, deferred; ClockShark, busybusy, a custom application, and other providers are evaluated against this same adapter contract, and the Gusto timekeeping/add-on question stays parked until that evaluation. Gusto remains payroll.

- [ ] **Step 3: Implement burdened labor cost**

Store burden rate history in `employee_burden_rates(employee_external_id, effective_from, effective_to, hourly_rate, payroll_tax_rate, workers_comp_rate, benefit_hourly_cost, burdened_hourly_rate)`. Select the rate effective at `clock_in`. Labor cost is `approved_minutes / 60 × burdened_hourly_rate`, rounded half-up.

- [ ] **Step 4: Implement webhook/import idempotency and reconciliation**

Reject unknown `JOB-XXXX` into a needs-review queue; do not silently discard it. Open clock entries remain provisional. Provider-approved entries may create approved costs when provider approver evidence is retained. Imported/submitted corrections require approval: a foreman may approve entries for their assigned crew and Dane may approve or override any entry. Approval uses an RPC that locks the row, records before/after minutes and job code, reason, actor, and timestamp, and upserts the deterministic labor-cost row. Hourly employees do not need application accounts in Version 2.

The approval/correction RPC calls Task 11 `mark_job_reconciliation_required()` in the same transaction whenever a closure snapshot exists.

Completion never waits for this queue. If a completion checklist lands while an entry remains `open` or `submitted`, the job still completes and the existing open-time exception remains actionable until a foreman or Dane resolves it.

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

After each job-cost insert/correction/refund, call Task 11 `mark_job_reconciliation_required()` in the same transaction so late BILL facts reopen a financially closed job without changing its prior snapshot.

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

### Task 15: Preserve direct Stripe invoicing, Synder/QuickBooks flow, and GHL status projection

**Files:**
- Create: `supabase/functions/stripe-job-invoice/index.ts`
- Create: `supabase/functions/stripe-job-invoice/handlers.ts`
- Create: `supabase/functions/stripe-job-invoice/handlers_test.ts`
- Create: `supabase/functions/stripe-webhook/index.ts`
- Create: `supabase/functions/stripe-webhook/handlers.ts`
- Create: `supabase/functions/stripe-webhook/handlers_test.ts`
- Create: `web/src/lib/stripe/jobInvoice.ts`
- Create: `web/src/lib/stripe/__tests__/jobInvoice.test.ts`
- Create: `web/src/app/(app)/jobs/[jobNumber]/invoice/page.tsx`
- Create: `web/src/app/(app)/jobs/[jobNumber]/invoice/InvoiceReviewForm.tsx`
- Modify: `web/src/lib/ghl/estimateFields.ts`
- Modify: `web/src/lib/ghl/push.ts`
- Create: `docs/runbooks/stripe-synder-qbo-verification.md`

**Interfaces:**
- Consumes: Dane's `invoice_review` job, accepted estimate/change-order line items, existing proven Stripe rendering in `supabase/functions/airtable-job-completed/index.ts`, and signed Stripe events.
- Produces: direct Stripe draft/send workflow, canonical invoice/credit/refund/payment facts, GHL `Invoice Sent` and `Paid/Closed (Won)` projections, and a verified Synder→QuickBooks handoff. GHL never becomes invoice authority.

- [ ] **Step 1: Test invoice composition and preserve the proven Stripe API shape**

Build invoice lines from accepted estimate scope plus approved change orders. Tests must prove declined/pending change orders are excluded, credits/refunds are negative revenue facts, and duplicate webhook delivery is idempotent.

Port the existing two-step rendering exactly: create/reuse a Stripe Product, then create invoice items using `price_data[product]`. Never send `price_data[product_data]`; Stripe rejects it. Create drafts only after Dane has entered `Invoice Review`; never auto-send on checklist completion.

**Go-live gate:** the deployed `STRIPE_SECRET_KEY` is currently a **test** key, and the in-session Stripe MCP belongs to CTA Integrity, not Lost Boys. Before any real invoice is created or sent, confirm the key belongs to the Lost Boys **live** Stripe account and record that account ID in the launch runbook.

- [ ] **Step 2: Implement the invoice review/send action**

```ts
export interface SendJobInvoiceInput {
  jobNumber: string;
  customerId: string;
  lineItems: Array<{ description: string; quantity: number; unitAmountCents: number }>;
  memo: string | null;
}

export async function createOrUpdateStripeDraft(input: SendJobInvoiceInput): Promise<{
  stripeInvoiceId: string;
  hostedInvoiceUrl: string | null;
}>;

export async function sendStripeInvoice(jobNumber: string): Promise<void>;
```

Only Dane's authenticated owner route can create/edit/send the draft. Store Stripe IDs and hosted link. Surface the link and current status in GHL through the existing opportunity field mapper; do not copy sensitive dashboard data into crew channels.

- [ ] **Step 3: Implement signed Stripe webhook normalization**

Verify `Stripe-Signature` against the raw request body before parsing. Normalize:

- `invoice.sent` → upsert `job_revenue_entries(entry_type='invoice')`, set `financial_status='invoice_sent'`, queue GHL `Invoice Sent`.
- Credit note → upsert negative `credit`.
- Refund → upsert negative `refund`.
- Payment received/full invoice payment → upsert `payment` only, set `financial_status='paid_reconciliation_pending'` only when the job is neither `financially_closed` nor `reconciliation_required`, set operational `status_v2='paid'`, and queue GHL `Paid/Closed (Won)`. Payment alone does not reopen a closed job because it does not change economic profit.
- Processing fee/balance transaction → upsert `payment_processing` cost separately.

Economic revenue equals invoice + credits + refunds. Payment affects collection status only. Use `(stripe_object_id,event_type)` as the stable idempotency identity. Out-of-order events must converge to the Stripe object's latest state without duplicating ledger rows.

Every credit, refund, corrected invoice amount, or processing-fee event must call Task 11 `mark_job_reconciliation_required()` when a closure snapshot already exists. A paid GHL stage never suppresses internal re-reconciliation.

- [ ] **Step 4: Verify Synder and QuickBooks without replacing them**

The runbook requires one Stripe test invoice through the connected Synder test/sandbox path where available, confirmation that invoice-level customer/job detail reaches QuickBooks, and screenshots/IDs recorded as launch evidence. If Synder/QBO test mode is unavailable, document a controlled low-dollar production verification approved by Dane; do not build a competing QBO writer.

- [ ] **Step 5: Test and commit**

```bash
cd web
npm test -- --run src/lib/stripe
npm run build
cd ..
deno test supabase/functions/stripe-job-invoice supabase/functions/stripe-webhook
git add web/src/lib/stripe 'web/src/app/(app)/jobs/[jobNumber]/invoice' \
  supabase/functions/stripe-job-invoice supabase/functions/stripe-webhook \
  web/src/lib/ghl docs/runbooks/stripe-synder-qbo-verification.md
git commit -m "feat: preserve stripe invoicing and project financial stages"
```

**Phase 5 gate:** Schedule a staged job and verify Calendar and BILL provisioning, import corrected time twice without duplication, approve it as foreman and override as Dane, ingest a BILL transaction/refund, send a Stripe invoice, replay signed invoice/payment events, confirm GHL stages, confirm Synder/QBO evidence, and receive only the expected Slack alerts/digest.

---

## Phase 6 — Launch and feedback substrate

### Task 16: Pricing-feedback facts without automatic rate changes

**Files:**
- Create: `supabase/migrations/20260818165000_pricing_feedback_facts.sql`
- Create: `web/src/lib/feedback/facts.ts`
- Create: `web/src/lib/feedback/__tests__/facts.test.ts`
- Create: `web/src/app/(app)/pricing-feedback/page.tsx`

**Interfaces:**
- Consumes: `job_financial_closure_snapshots`, one row per closure version.
- Produces: immutable versioned facts needed for future human-reviewed rate recommendations; does not modify pricing variables.

- [ ] **Step 1: Create immutable fact rows**

Create `pricing_feedback_facts` with job number, closure snapshot ID/version, estimate/budget version, estimated and actual productive hours, estimated blended labor rate, actual weighted labor rate, estimated and actual labor cost, estimated and actual dump count/cost, allocated overhead rate, actual overhead pool reference period, original/current/final revenue, planned/actual profit, job type, client type, estimator, crew, and close timestamp. Make `(job_number, closure_version)` unique.

Insert one row for each financial close/re-close. Reject updates/deletes. Reporting defaults to the latest closure version and exposes prior versions for audit; late corrections never mutate a previous feedback fact.

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
presented estimate → accepted/Quote Accepted, no job
→ schedule
→ scheduled job + budget v1 + Job Scheduled + all-day Calendar event
→ offline start checklist/in_progress/Job in Progress
→ time + expense + daily checklist
→ Watch due to labor forecast
→ approved change order + budget v2
→ completion/completed/Job Completed despite an open clock
→ Dane Invoice Review → Stripe invoice.sent/Invoice Sent
→ Stripe paid/Paid-Closed Won + paid_reconciliation_pending
→ Dane close/financially_closed/closure v1
→ late cost/Reconciliation Required
→ Dane re-close/closure v2
→ immutable feedback facts for v1 and v2
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
```

Create owner-only RPC `enable_profitability_workflow()` that atomically stores `clock_timestamp()` in `workflow_configuration.launch_at` and enables scheduling. Jobs before the stored timestamp remain legacy and are excluded from the new portfolio by default. This avoids an unreviewed placeholder timestamp. Timekeeping/BILL remain manual/imported until their production credentials and webhook tests pass.

- [ ] **Step 3: Write launch runbook**

Include exact order:

1. Back up production schema and record row counts.
2. Apply migrations in timestamp order.
3. Deploy Edge Functions with their existing `verify_jwt` requirements explicitly preserved; deploy `ghl-job-webhook` with `--no-verify-jwt` and read back the setting.
4. Configure Vault/env secrets.
5. Confirm `STRIPE_SECRET_KEY` is the Lost Boys **live** account key (not the current test key, not CTA Integrity's account) and record the Stripe account ID.
6. Seed Dane owner profile and foreman profiles.
7. Set `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false`, verify Quote Accepted no longer mints a job, then call `enable_profitability_workflow()` to store the launch timestamp and enable app scheduling.
8. Run synthetic staging E2E.
9. Run one low-risk real job with manual actuals.
10. Dane signs off original/current/actual numbers.
11. Enable Slack notifications.
12. Enable BILL and timekeeping separately only after each integration gate passes.

- [ ] **Step 4: Write rollback runbook**

Rollback disables new app scheduling and optional integrations but never deletes jobs, budgets, checklists, ledger entries, or audit events. Existing scheduled jobs remain readable and manually reconcilable; accepted unscheduled work remains at GHL `Quote Accepted`. Do **not** re-enable Quote-Accepted job minting—the approved job-creation boundary remains scheduling even during rollback.

- [ ] **Step 5: Add integration health endpoint**

Return no secrets. Report last successful outbox delivery by event type, pending/failed/dead-letter counts, last Calendar inbound event, last time import, last BILL event, last Stripe event, last GHL stage projection, and last Slack digest. Protect the route for owner access.

- [ ] **Step 6: Run full verification**

```bash
cd web
npm test
npm run lint
npm run build
cd ..
deno task test
```

Run every SQL assertion through the disposable live-schema branch process from Task 0A. Expected: all suites and SQL assertions pass, the build succeeds, and integration health shows no unexplained dead letters.

- [ ] **Step 7: Update canonical docs and commit**

Update `CLAUDE.md` and `BUILD_PLAN.md` with the launch timestamp, new schedule authority, schema table inventory, deployed function versions, feature-flag state, known deferred items, and real-job verification evidence.

```bash
git add docs/runbooks web/src/app/api/health web/src/lib/__tests__ CLAUDE.md BUILD_PLAN.md
git commit -m "docs: ship live job profitability workflow runbooks and verification"
```

**Final acceptance gate:** Dane can open the portfolio, identify the most at-risk active job, understand its leading variance, review original versus current versus actual/forecast financials, approve a documented change order, and financially close a completed job. The final record reconciles approved time, job-coded costs, allocated overhead, final net Stripe-invoiced revenue, actual processing cost, and immutable audit history. Dane can then open the same job after closure, inspect closure v1, receive a late cost, see `Reconciliation Required`, re-close to v2, and compare both snapshots. GHL and Google Calendar show the approved operational stages/schedule without becoming the financial source of truth.

---

## Dependency graph

```text
Task 0A canonical docs/plan landing
├── Task 0B BL-7 auth boundary (required by Task 8)
└── Task 1 schema
    ├── Task 2 estimate economics + commercial lifecycle
    │   └── Task 4 schedule promotion
    │       └── Task 5 outbox/calendar
    └── Task 3 forecast engine

Tasks 1–5
├── Task 6 dashboard
└── Task 7 manual ledger

Tasks 0B, 5–7
└── Task 8 checklist/auth/offline
    └── Task 9 forecast overrides

Tasks 6–9
├── Task 10 change orders
└── Task 11 closure versions/reconciliation

Tasks 6–11
├── Task 12 Slack
├── Task 13 timekeeping adapter
├── Task 14 BILL
└── Task 15 Stripe/Synder/QBO + GHL stage projection

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
- Authenticated application accounts for hourly employees other than foremen
- Hard-coded financial-close blockers before Dane defines that policy
- Replacing Gusto payroll
- Replacing Stripe, Synder, or QuickBooks with GHL invoicing/accounting
- Using collections as the profitability revenue measure
- Stripe native invoice auto-reminders and the weekly Slack AR digest — **deferred, not dropped.** Owner: Matt (CFO — chases AR personally today). Where: extend `profitability-digest` plus Stripe invoice settings. Activation criterion: `stripe-webhook` is live and the first real Stripe invoices are flowing through it (Phase 5 gate passed).

## Definition of done

- All new migrations are committed, validated on a disposable clone of the live schema, and applied through the documented migration workflow; the plan makes no false empty-database replay claim while live-only functions remain absent from git.
- All existing estimate golden-master pricing tests still pass.
- Every customer-presented estimate version, acceptance, and reversal remains immutable and queryable.
- No accepted estimate receives a job code until app scheduling.
- One estimate family creates at most one job. Scheduling/rescheduling is idempotent and creates one job, one baseline, and retryable integration events.
- GHL stages match the approved 12-stage pipeline and Calendar shows one inclusive all-day schedule per job projection.
- Health calculations are deterministic, tested, confidence-aware, and explain their leading reason.
- Foremen authenticate through the isolated workforce boundary; legacy BL-7 policies/functions are not reactivated blindly.
- Checklists work offline, synchronize idempotently, and remain attributable and immutable.
- Start and completion checklists automatically advance GHL/internal operational stages; completion is not blocked by open clocks.
- Change orders require customer plus Dane approval before current approved revenue/budget changes.
- Actual labor, nonlabor cost, overhead, processing cost, net invoiced revenue, and collections remain distinct.
- Direct Stripe invoicing and webhook status, Synder→QuickBooks, and GHL status/link projection are verified end to end.
- Dashboard and portfolio are usable at mobile and desktop widths.
- External corrections update forecasts without duplication and retain audits.
- Financial closure creates immutable versions; late facts reopen reconciliation and re-close without rewriting history.
- `ghl-job-webhook` remains deployed with JWT verification disabled and its setting is read back after deployment.
- A launch-date real job completes the entire loop and Dane signs off the result.
