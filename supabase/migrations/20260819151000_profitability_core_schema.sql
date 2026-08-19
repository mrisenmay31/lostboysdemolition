-- Profitability v2 Phase 1, Task 1 (Lane A) — canonical profitability
-- schema. Companion to 20260819150000_profitability_lifecycle_types.sql
-- (which adds `job_financial_status` alone, per the v2 spec's own file
-- split). This migration reproduces the v2 doc's Task 1 Step 4 SQL
-- (`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md`,
-- lines 341-672) verbatim for every enum/table/column/check/FK, EXCEPT for
-- the four approved corrections recorded in
-- `docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` ("Spec
-- corrections / deviations", items 1-4):
--
--   1. Filename prefix is 20260819..., not the spec's 20260818..., so repo
--      ordering matches the applied migration head (20260818230956).
--   2. Every new table gets an EXPLICIT
--      `revoke all on table ... from public, anon, authenticated;` —
--      Supabase default privileges pre-grant `authenticated`
--      REFERENCES/TRIGGER/TRUNCATE on a fresh table, and TRUNCATE is NOT
--      RLS-gated (the exact gap Phase 0 found and BL-7's
--      workforce_auth_boundary migration fixed the same way). RLS is
--      enabled with NO policies on every table this migration creates —
--      not just the 12 named in the v2 doc's own (superseded, see below)
--      smoke test, but all of them, including job_cost_entry_audit,
--      job_forecast_overrides, job_forecast_snapshots, and job_alerts.
--      service_role bypasses RLS and keeps full access; Task 8 adds
--      `authenticated` policies once operational routes exist.
--   3. `search_path = public, pg_temp` is pinned on every function this
--      migration creates (`mark_job_reconciliation_required` and all seven
--      immutability trigger functions), and EXECUTE is revoked from
--      `public, anon, authenticated` on every one of them (grant to
--      service_role only where a caller needs it — trigger functions need
--      no grant to fire; EXECUTE is checked at CREATE TRIGGER time, not at
--      fire time — see the 20260817130000 hardening migration's "Fix 4"
--      for the load-bearing correction of the "triggers run as table
--      owner" myth).
--   4. (this file's own prefix, restated for completeness — see item 1.)
--
-- Two counting corrections, resolved in favor of the literal SQL text over
-- summary counts elsewhere in the planning docs (the SQL is spec-canonical;
-- the prose counts around it disagree with each other and with the SQL):
--   - This migration creates 13 new enums, not "12" as one summary line in
--     the phase-1 plan states — job_health_status, forecast_confidence,
--     cost_category, ledger_state, reconciliation_state, checklist_type,
--     change_order_status, approval_kind, customer_authorization_method,
--     revenue_entry_type, overhead_pool, integration_event_status,
--     schedule_exception_status. (`job_financial_status`, the 14th enum
--     overall, lives in the companion lifecycle-types migration.) This
--     matches the phase-1 plan's OTHER summary line ("has_enum for ALL 13
--     new enums") and the pgTAP suite below asserts exactly 13.
--   - This migration creates 16 new tables, not "15" as the phase-1 plan's
--     "Spec fidelity notes" line states — the v2 doc's own Task 1 Step 1
--     smoke test only ever listed 12 (it predates job_cost_entry_audit,
--     job_forecast_overrides, job_forecast_snapshots, and job_alerts being
--     added later in the same Step 4 SQL block), and the phase-1 plan's
--     instruction to this session names those same 4 tables as additional
--     to "the 12 in the spec's smoke test" — 12 + 4 = 16. The pgTAP suite
--     below asserts has_table for all 16.
--   - The `alter table public.jobs` block below adds 12 columns, not "13"
--      as the phase-1 plan states — counted directly from the v2 doc's own
--      SQL (original_estimate_id, original_estimate_number,
--      current_budget_version, financial_status, financially_closed_at,
--      financially_closed_by, financially_closed_by_name, launch_workflow,
--      last_forecast_at, cancelled_at, cancellation_reason,
--      calendar_sync_revision). Added verbatim, no columns invented or
--      dropped to hit either count.
--
-- No legacy `jobs`/`users`/`crews`/`time_entries` columns, rows, or
-- policies are touched. No pricing math changes — this migration adds no
-- code path that calls `_shared/pricing.ts` or touches `estimates`/
-- `estimate_line_items` (both remain immutable per their own triggers).
--
-- Replay note (A10): unlike the companion lifecycle-types migration, this
-- migration is deliberately NOT duplicate_object-guarded — every create is
-- spec-verbatim. Supabase wraps each migration file in a single transaction,
-- so a partial apply (e.g. failing halfway through the 16 tables) rolls back
-- the whole file rather than leaving orphaned objects behind for a guard to
-- skip past. Do not add duplicate_object/if-not-exists guards here on the
-- assumption that re-run safety is missing; it is provided by the
-- transaction boundary, not by idempotent DDL.

-- ============================================================
-- 1. Enums (13 — see header)
-- ============================================================
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

-- ============================================================
-- 2. jobs columns (12 — see header). Legacy columns untouched.
-- ============================================================
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

-- ============================================================
-- 3. Tables (16 — see header). Verbatim from the v2 spec.
-- ============================================================

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
  check (category is not null or remaining_workdays is not null),
  -- B6 (approved phase-plan deviation 11): the forecast engine ignores a
  -- direct_labor expected_remaining_cost by contract — labor ETC always
  -- flows from the crew-days model (remaining_workdays / expected_crew_size
  -- / hours_per_day), never from a manual dollar override. And a
  -- category-less expected_remaining_cost has no home either: the engine's
  -- remainingCostOverrides is keyed by category, so a NULL-category dollar
  -- override would be silently ignored the same way. Both shapes are
  -- rejected at write time instead of persisting as silent no-ops.
  check (
    (category is not null and category is distinct from 'direct_labor')
    or expected_remaining_cost is null
  )
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

-- ============================================================
-- 4. mark_job_reconciliation_required — server-only helper.
--    Plain plpgsql (not security definer — callers are service-role
--    already, per the task instructions). Pinned search_path, EXECUTE
--    revoked from public/anon/authenticated, granted to service_role.
--    Never modifies job_financial_closure_snapshots.
--
--    A1 (approved phase-plan deviation 10): the job_alerts dedup window is
--    (job_number, fingerprint) where resolved_at is null — per-job AND
--    per-open-window: it REOPENS once the alert is resolved. No string
--    key derived from job/fingerprint alone can track that window (a
--    bare fingerprint drops the Slack event when the same source recurs
--    on a different job; a job-scoped string still drops it when the
--    source recurs after the first alert was resolved — both failure
--    modes demonstrated in this task's adversarial review). The intended
--    semantics are "one Slack ping per NEWLY OPENED reconciliation
--    alert", so the outbox key is derived from the alert row the insert
--    actually opened: `on conflict ... do nothing returning id` yields
--    NULL when the alert was already open (Slack was queued when it
--    opened — nothing new to announce, early return), and a fresh alert
--    id otherwise, keyed as 'alert:<uuid>'. The ON CONFLICT on the outbox
--    insert is belt-and-braces, not load-bearing. The job_alerts
--    fingerprint itself stays spec-exact (`reconcile:<kind>:<id>`).
-- ============================================================
create function public.mark_job_reconciliation_required(
  p_job_number text,
  p_source_kind text,
  p_source_id text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_has_snapshot boolean;
  v_fingerprint  text;
  v_alert_id     uuid;
begin
  -- A8: guard all three args before they ever reach a NOT NULL column.
  -- '...' || null || '...' evaluates to NULL, which would otherwise violate
  -- job_alerts.fingerprint's not-null constraint and abort the CALLER's
  -- transaction (this function runs inside ledger/Stripe RPC transactions)
  -- with a not-null-violation raised three layers away from the actual
  -- mistake. A NULL argument is a caller bug and must surface immediately
  -- and clearly here — it is not coalesced away. (p_job_number is included
  -- for symmetry: a NULL job would otherwise silently no-op through the
  -- snapshot existence probe, hiding the same class of caller bug.)
  if p_job_number is null or p_source_kind is null or p_source_id is null then
    raise exception 'mark_job_reconciliation_required: job number and source kind/id are all required (job %, kind %, id %)',
      p_job_number, p_source_kind, p_source_id;
  end if;

  select exists (
    select 1
      from public.job_financial_closure_snapshots
     where job_number = p_job_number
  )
  into v_has_snapshot;

  -- No closure snapshot for this job: there is nothing to reconcile
  -- against, so this is a no-op by design (v2 spec, Task 1 Step 4).
  if not v_has_snapshot then
    return;
  end if;

  v_fingerprint := 'reconcile:' || p_source_kind || ':' || p_source_id;

  update public.jobs
     set financial_status = 'reconciliation_required'
   where job_number = p_job_number;

  -- Idempotent against the partial unique index: a re-call with the same
  -- fingerprint while the alert is still open is a no-op, not a duplicate.
  -- RETURNING under `on conflict do nothing` yields NULL when the conflict
  -- fired (alert already open) and the new row's id when this call is the
  -- one that opened it — which is exactly the "should Slack fire?" signal
  -- (A1, see function header).
  insert into public.job_alerts (
    job_number, fingerprint, severity, title, message, action_path
  ) values (
    p_job_number,
    v_fingerprint,
    'at_risk',
    'Reconciliation required',
    format(
      'A %s event (%s) landed on a financially closed job and requires reconciliation.',
      p_source_kind, p_source_id
    ),
    '/jobs/' || p_job_number
  )
  on conflict (job_number, fingerprint) where resolved_at is null do nothing
  returning id into v_alert_id;

  -- Alert was already open: Slack was queued when it opened. Nothing new
  -- to announce.
  if v_alert_id is null then
    return;
  end if;

  -- One Slack ping per newly opened alert (A1): the key is the alert row
  -- this very call opened, so it can never collide with a different job's
  -- alert or an earlier resolved-and-reopened one.
  insert into public.integration_outbox (
    event_type, aggregate_type, aggregate_id, idempotency_key, payload
  ) values (
    'slack_reconciliation_required',
    'job',
    p_job_number,
    'alert:' || v_alert_id,
    jsonb_build_object(
      'job_number', p_job_number,
      'source_kind', p_source_kind,
      'source_id', p_source_id,
      'alert_id', v_alert_id
    )
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke all on function public.mark_job_reconciliation_required(text, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_job_reconciliation_required(text, text, text)
  to service_role;

-- ============================================================
-- 5. Immutability triggers — UPDATE and DELETE both raise
--    unconditionally, following the house
--    enforce_estimate_line_item_immutability pattern
--    (20260814160000_phase_b_estimates_fixups.sql): these are append-only
--    event/version tables, not header rows with a mutable-column
--    allowlist like `estimates`. Corrections are a new version row, never
--    an edit. One function + one trigger per table (7 tables, per the v2
--    spec's Task 1 Step 4 closing paragraph).
-- ============================================================

create function public.enforce_estimate_financial_details_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'estimate financial details are immutable — write a new estimate version instead (estimate_id %)',
    coalesce(old.estimate_id, new.estimate_id);
  return old;
end $$;

create trigger estimate_financial_details_immutable
  before update or delete on public.estimate_financial_details
  for each row execute function public.enforce_estimate_financial_details_immutability();

create function public.enforce_job_budget_versions_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'job budget versions are immutable — write a new version row instead (job % version %)',
    coalesce(old.job_number, new.job_number), coalesce(old.version, new.version);
  return old;
end $$;

create trigger job_budget_versions_immutable
  before update or delete on public.job_budget_versions
  for each row execute function public.enforce_job_budget_versions_immutability();

create function public.enforce_change_order_versions_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'change order versions are immutable — write a new version row instead (change_order_id % version %)',
    coalesce(old.change_order_id, new.change_order_id), coalesce(old.version, new.version);
  return old;
end $$;

create trigger change_order_versions_immutable
  before update or delete on public.change_order_versions
  for each row execute function public.enforce_change_order_versions_immutability();

create function public.enforce_change_order_approvals_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'change order approvals are immutable — record a new approval instead (id %)',
    coalesce(old.id, new.id);
  return old;
end $$;

create trigger change_order_approvals_immutable
  before update or delete on public.change_order_approvals
  for each row execute function public.enforce_change_order_approvals_immutability();

create function public.enforce_job_checklists_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'job checklists are immutable — submit a new checklist instead (id %)',
    coalesce(old.id, new.id);
  return old;
end $$;

create trigger job_checklists_immutable
  before update or delete on public.job_checklists
  for each row execute function public.enforce_job_checklists_immutability();

create function public.enforce_job_forecast_snapshots_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'job forecast snapshots are immutable — write a new snapshot instead (id %)',
    coalesce(old.id, new.id);
  return old;
end $$;

create trigger job_forecast_snapshots_immutable
  before update or delete on public.job_forecast_snapshots
  for each row execute function public.enforce_job_forecast_snapshots_immutability();

create function public.enforce_job_financial_closure_snapshots_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'job financial closure snapshots are immutable — write a new closure version instead (job % closure_version %)',
    coalesce(old.job_number, new.job_number), coalesce(old.closure_version, new.closure_version);
  return old;
end $$;

create trigger job_financial_closure_snapshots_immutable
  before update or delete on public.job_financial_closure_snapshots
  for each row execute function public.enforce_job_financial_closure_snapshots_immutability();

-- Immutability trigger functions need no EXECUTE grant to fire (checked at
-- CREATE TRIGGER time, not fire time — see 20260817130000's "Fix 4"), but a
-- fresh CREATE FUNCTION grants PUBLIC execute by default, so each is
-- explicitly revoked to close that gap immediately rather than leaving it
-- for a later hardening pass.
revoke all on function public.enforce_estimate_financial_details_immutability()           from public, anon, authenticated;
revoke all on function public.enforce_job_budget_versions_immutability()                  from public, anon, authenticated;
revoke all on function public.enforce_change_order_versions_immutability()                from public, anon, authenticated;
revoke all on function public.enforce_change_order_approvals_immutability()               from public, anon, authenticated;
revoke all on function public.enforce_job_checklists_immutability()                       from public, anon, authenticated;
revoke all on function public.enforce_job_forecast_snapshots_immutability()                from public, anon, authenticated;
revoke all on function public.enforce_job_financial_closure_snapshots_immutability()       from public, anon, authenticated;

-- ============================================================
-- 6. Indexes — every job_number FK column, plus the four named
--    access-pattern indexes from the v2 spec's Task 1 Step 4 closing
--    paragraph.
-- ============================================================
create index idx_change_orders_job_number on public.change_orders (job_number);
create index idx_job_budget_versions_job_number on public.job_budget_versions (job_number);
create index idx_job_checklists_job_number on public.job_checklists (job_number);
create index idx_job_cost_entries_job_number on public.job_cost_entries (job_number);
create index idx_job_revenue_entries_job_number on public.job_revenue_entries (job_number);
create index idx_job_forecast_overrides_job_number on public.job_forecast_overrides (job_number);
create index idx_job_forecast_snapshots_job_number on public.job_forecast_snapshots (job_number);
create index idx_job_alerts_job_number on public.job_alerts (job_number);
create index idx_job_schedule_exceptions_job_number on public.job_schedule_exceptions (job_number);
create index idx_job_financial_closure_snapshots_job_number on public.job_financial_closure_snapshots (job_number);

create index idx_job_cost_entries_reconciliation_state_incurred_at
  on public.job_cost_entries (reconciliation_state, incurred_at);
create index idx_job_checklists_job_number_submitted_at
  on public.job_checklists (job_number, submitted_at desc);
create index idx_job_alerts_resolved_at_severity
  on public.job_alerts (resolved_at, severity);
create index idx_integration_outbox_status_available_at
  on public.integration_outbox (status, available_at);

-- ============================================================
-- 7. RLS — enable on ALL 16 new tables, no policies (house posture; Task 8
--    adds authenticated policies once operational routes exist).
--    Explicit revoke from public/anon/authenticated on every table closes
--    the default-privilege TRUNCATE gap (deviation 2, see header).
--    service_role bypasses RLS (rolbypassrls = true) and keeps full
--    access via its default privileges — no explicit grant needed, same
--    posture as every other RLS-enabled, policy-free table in this repo.
-- ============================================================

alter table public.estimate_financial_details enable row level security;
alter table public.change_orders enable row level security;
alter table public.change_order_versions enable row level security;
alter table public.change_order_approvals enable row level security;
alter table public.job_budget_versions enable row level security;
alter table public.job_checklists enable row level security;
alter table public.job_cost_entries enable row level security;
alter table public.job_cost_entry_audit enable row level security;
alter table public.job_revenue_entries enable row level security;
alter table public.overhead_expense_entries enable row level security;
alter table public.job_forecast_overrides enable row level security;
alter table public.job_forecast_snapshots enable row level security;
alter table public.job_alerts enable row level security;
alter table public.integration_outbox enable row level security;
alter table public.job_schedule_exceptions enable row level security;
alter table public.job_financial_closure_snapshots enable row level security;

revoke all on table public.estimate_financial_details from public, anon, authenticated;
revoke all on table public.change_orders from public, anon, authenticated;
revoke all on table public.change_order_versions from public, anon, authenticated;
revoke all on table public.change_order_approvals from public, anon, authenticated;
revoke all on table public.job_budget_versions from public, anon, authenticated;
revoke all on table public.job_checklists from public, anon, authenticated;
revoke all on table public.job_cost_entries from public, anon, authenticated;
revoke all on table public.job_cost_entry_audit from public, anon, authenticated;
-- A3: job_cost_entry_audit.id is `generated always as identity`, which
-- creates job_cost_entry_audit_id_seq. Supabase's default privileges
-- pre-grant `authenticated`/`anon` USAGE on newly created sequences — the
-- table-only revoke sweep above does not touch it. This is the only new
-- identity/serial sequence this migration creates (all other primary keys
-- are `default gen_random_uuid()`), so it is the only one needing this line.
revoke all on sequence public.job_cost_entry_audit_id_seq from public, anon, authenticated;
revoke all on table public.job_revenue_entries from public, anon, authenticated;
revoke all on table public.overhead_expense_entries from public, anon, authenticated;
revoke all on table public.job_forecast_overrides from public, anon, authenticated;
revoke all on table public.job_forecast_snapshots from public, anon, authenticated;
revoke all on table public.job_alerts from public, anon, authenticated;
revoke all on table public.integration_outbox from public, anon, authenticated;
revoke all on table public.job_schedule_exceptions from public, anon, authenticated;
revoke all on table public.job_financial_closure_snapshots from public, anon, authenticated;
