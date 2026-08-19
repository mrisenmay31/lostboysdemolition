-- Profitability v2 Phase 1, Task 1 pgTAP suite. Extends the v2 spec's own
-- Task 1 Step 1 smoke test (plan(20): 8 has_enum + 12 has_table, none
-- carrying a description argument) into a real suite, per the phase-1 plan's
-- deviation 1 ("Spec corrections / deviations" #1 in
-- docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md) — every
-- multi-overload pgTAP assertion here carries a description argument, since
-- an undescribed has_table('public','x')/has_enum('public','x') silently
-- resolves the wrong overload and checks for an object literally named
-- 'public' (the exact bug Phase 0 caught; see workforce_auth_boundary_test.sql
-- assertions 1-3's own fix-round comment for the precedent).
--
-- All of the original smoke test's assertions are kept (with descriptions
-- added) and are subsumed by the fuller counts below: the original 8
-- has_enum checks (job_health_status, forecast_confidence, cost_category,
-- ledger_state, reconciliation_state, checklist_type, change_order_status,
-- job_financial_status) are the first 8 of the 14 has_enum assertions here
-- (14 = the 13 enums this task's core-schema migration creates, plus
-- job_financial_status from the companion lifecycle-types migration — both
-- migrations are validated together in one runbook cycle for Task 1, same
-- as the v2 spec's own single test file did); the original 12 has_table
-- checks are the first 12 of the 16 has_table assertions here (16 = the 12
-- named in the spec's original smoke test plus job_cost_entry_audit,
-- job_forecast_overrides, job_forecast_snapshots, and job_alerts, which the
-- same Step 4 SQL block also creates but the original smoke test predates).
--
-- Added beyond the original smoke test, per this session's brief:
--   - has_column spot-checks for all 12 new `jobs` columns (not just the 4
--     named "at minimum" — full coverage costs nothing and Tasks 2-17
--     depend on these exact names).
--   - RLS-enabled checks for all 16 new tables.
--   - ACL posture (table_privs_are) proving anon AND authenticated hold NO
--     privileges on 4 representative tables — the assertion class that
--     caught a real TRUNCATE gap in Phase 0 (deviation 2).
--   - function_privs_are proving authenticated and anon cannot EXECUTE
--     mark_job_reconciliation_required, and that service_role can
--     (deviation 3's ACL half).
--   - Existence + predicate-text checks for the job_alerts_one_open_fingerprint
--     partial unique index (schema-qualified — see A7 fix-round note below).
--   - has_trigger existence checks for all 7 immutability triggers.
--
-- Fix round (2026-08-19, adversarial review that executed this suite against
-- a local Postgres) added six more assertion groups, +24 assertions total,
-- taking plan() from 78 to 102:
--   - A4: trigger_is alongside each has_trigger (+7) — pins that each
--     immutability trigger calls its matching enforcement function, not
--     just that a same-named trigger exists.
--   - A5: enum_has_labels for the 4 parity-critical enums — cost_category,
--     job_health_status, forecast_confidence, job_financial_status (+4) —
--     values AND order, not just presence.
--   - A6: col_type_is/col_default_is on load-bearing columns — jobs.
--     financial_status, jobs.calendar_sync_revision, jobs.launch_workflow
--     (type + default, 2 each), estimate_financial_details.customer_price
--     and job_budget_versions.approved_revenue (type only) (+8).
--   - A7: rewrote the partial-index predicate assertion (net +0 — same
--     assertion count, corrected query) to join pg_namespace and check the
--     actual predicate text instead of an unqualified relname join that
--     could ERROR the whole suite if a same-named index existed in another
--     schema.
--   - A13: triggers_are proving the 3 MUTABLE ledger tables
--     (job_cost_entries, job_revenue_entries, overhead_expense_entries)
--     carry NO triggers, so a later migration can't silently make one
--     immutable or add a side-effecting trigger unnoticed (+3). NOTE:
--     these 3 are drift PINS, not red/green targets — they pass vacuously
--     pre-migration (no table = no triggers = empty matches empty), so
--     the expected RED baseline is 99 fail / 3 pass, not 102 fail (same
--     labeled-regression-pin convention as workforce_auth_boundary_test).
--   - A3 (test half): sequence_privs_are proving anon/authenticated hold no
--     privileges on job_cost_entry_audit_id_seq, mirroring the migration's
--     new explicit revoke (+2).
-- Arithmetic: 78 + 7 + 4 + 8 + 0 + 3 + 2 = 102.
--
-- pgTAP lives on branches / production single-transaction dry-runs only,
-- per docs/runbooks/profitability-schema-validation.md §3 — this file is
-- never applied to production outside a rolled-back transaction.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;
select plan(102);

-- ============================================================
-- 1-14: has_enum — all 14 enums touched by Task 1 (13 in the core-schema
-- migration + job_financial_status in the companion lifecycle-types
-- migration).
-- ============================================================
select has_enum('public', 'job_financial_status', 'job_financial_status enum exists');
select has_enum('public', 'job_health_status', 'job_health_status enum exists');
select has_enum('public', 'forecast_confidence', 'forecast_confidence enum exists');
select has_enum('public', 'cost_category', 'cost_category enum exists');
select has_enum('public', 'ledger_state', 'ledger_state enum exists');
select has_enum('public', 'reconciliation_state', 'reconciliation_state enum exists');
select has_enum('public', 'checklist_type', 'checklist_type enum exists');
select has_enum('public', 'change_order_status', 'change_order_status enum exists');
select has_enum('public', 'approval_kind', 'approval_kind enum exists');
select has_enum('public', 'customer_authorization_method', 'customer_authorization_method enum exists');
select has_enum('public', 'revenue_entry_type', 'revenue_entry_type enum exists');
select has_enum('public', 'overhead_pool', 'overhead_pool enum exists');
select has_enum('public', 'integration_event_status', 'integration_event_status enum exists');
select has_enum('public', 'schedule_exception_status', 'schedule_exception_status enum exists');

-- ============================================================
-- 15-30: has_table — all 16 new tables.
-- ============================================================
select has_table('public', 'estimate_financial_details', 'estimate_financial_details table exists');
select has_table('public', 'change_orders', 'change_orders table exists');
select has_table('public', 'change_order_versions', 'change_order_versions table exists');
select has_table('public', 'change_order_approvals', 'change_order_approvals table exists');
select has_table('public', 'job_budget_versions', 'job_budget_versions table exists');
select has_table('public', 'job_checklists', 'job_checklists table exists');
select has_table('public', 'job_cost_entries', 'job_cost_entries table exists');
select has_table('public', 'job_cost_entry_audit', 'job_cost_entry_audit table exists');
select has_table('public', 'job_revenue_entries', 'job_revenue_entries table exists');
select has_table('public', 'overhead_expense_entries', 'overhead_expense_entries table exists');
select has_table('public', 'job_forecast_overrides', 'job_forecast_overrides table exists');
select has_table('public', 'job_forecast_snapshots', 'job_forecast_snapshots table exists');
select has_table('public', 'job_alerts', 'job_alerts table exists');
select has_table('public', 'integration_outbox', 'integration_outbox table exists');
select has_table('public', 'job_schedule_exceptions', 'job_schedule_exceptions table exists');
select has_table('public', 'job_financial_closure_snapshots', 'job_financial_closure_snapshots table exists');

-- ============================================================
-- 31-42: has_column — all 12 new `jobs` columns.
-- ============================================================
select has_column('public', 'jobs', 'original_estimate_id', 'jobs.original_estimate_id exists');
select has_column('public', 'jobs', 'original_estimate_number', 'jobs.original_estimate_number exists');
select has_column('public', 'jobs', 'current_budget_version', 'jobs.current_budget_version exists');
select has_column('public', 'jobs', 'financial_status', 'jobs.financial_status exists');
select has_column('public', 'jobs', 'financially_closed_at', 'jobs.financially_closed_at exists');
select has_column('public', 'jobs', 'financially_closed_by', 'jobs.financially_closed_by exists');
select has_column('public', 'jobs', 'financially_closed_by_name', 'jobs.financially_closed_by_name exists');
select has_column('public', 'jobs', 'launch_workflow', 'jobs.launch_workflow exists');
select has_column('public', 'jobs', 'last_forecast_at', 'jobs.last_forecast_at exists');
select has_column('public', 'jobs', 'cancelled_at', 'jobs.cancelled_at exists');
select has_column('public', 'jobs', 'cancellation_reason', 'jobs.cancellation_reason exists');
select has_column('public', 'jobs', 'calendar_sync_revision', 'jobs.calendar_sync_revision exists');

-- ============================================================
-- 43-58: RLS enabled on all 16 new tables.
-- ============================================================
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'estimate_financial_details'),
  'RLS is enabled on estimate_financial_details'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'change_orders'),
  'RLS is enabled on change_orders'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'change_order_versions'),
  'RLS is enabled on change_order_versions'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'change_order_approvals'),
  'RLS is enabled on change_order_approvals'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_budget_versions'),
  'RLS is enabled on job_budget_versions'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_checklists'),
  'RLS is enabled on job_checklists'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_cost_entries'),
  'RLS is enabled on job_cost_entries'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_cost_entry_audit'),
  'RLS is enabled on job_cost_entry_audit'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_revenue_entries'),
  'RLS is enabled on job_revenue_entries'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'overhead_expense_entries'),
  'RLS is enabled on overhead_expense_entries'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_forecast_overrides'),
  'RLS is enabled on job_forecast_overrides'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_forecast_snapshots'),
  'RLS is enabled on job_forecast_snapshots'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_alerts'),
  'RLS is enabled on job_alerts'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'integration_outbox'),
  'RLS is enabled on integration_outbox'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_schedule_exceptions'),
  'RLS is enabled on job_schedule_exceptions'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_financial_closure_snapshots'),
  'RLS is enabled on job_financial_closure_snapshots'
);

-- ============================================================
-- 59-66: ACL posture — anon and authenticated hold NO table privileges on
-- 4 representative tables (the assertion class that caught a real TRUNCATE
-- gap in Phase 0's workforce_profiles review).
-- ============================================================
select table_privs_are('public', 'estimate_financial_details', 'anon', array[]::name[], 'anon has no table privileges on estimate_financial_details');
select table_privs_are('public', 'estimate_financial_details', 'authenticated', array[]::name[], 'authenticated has no table privileges on estimate_financial_details');
select table_privs_are('public', 'job_budget_versions', 'anon', array[]::name[], 'anon has no table privileges on job_budget_versions');
select table_privs_are('public', 'job_budget_versions', 'authenticated', array[]::name[], 'authenticated has no table privileges on job_budget_versions');
select table_privs_are('public', 'integration_outbox', 'anon', array[]::name[], 'anon has no table privileges on integration_outbox');
select table_privs_are('public', 'integration_outbox', 'authenticated', array[]::name[], 'authenticated has no table privileges on integration_outbox');
select table_privs_are('public', 'job_financial_closure_snapshots', 'anon', array[]::name[], 'anon has no table privileges on job_financial_closure_snapshots');
select table_privs_are('public', 'job_financial_closure_snapshots', 'authenticated', array[]::name[], 'authenticated has no table privileges on job_financial_closure_snapshots');

-- ============================================================
-- 67-69: mark_job_reconciliation_required EXECUTE posture.
-- ============================================================
select function_privs_are(
  'public', 'mark_job_reconciliation_required', array['text','text','text'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE mark_job_reconciliation_required'
);
select function_privs_are(
  'public', 'mark_job_reconciliation_required', array['text','text','text'],
  'anon', array[]::text[],
  'anon cannot EXECUTE mark_job_reconciliation_required'
);
select function_privs_are(
  'public', 'mark_job_reconciliation_required', array['text','text','text'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE mark_job_reconciliation_required'
);

-- ============================================================
-- 70-71: job_alerts_one_open_fingerprint partial unique index.
--
-- A7: assertion 71 previously joined pg_index -> pg_class on relname alone,
-- with no schema filter — a same-named index living in another schema
-- (extensions/pg_temp, or a future test fixture) would make the scalar
-- subquery return >1 row and ERROR the whole suite mid-transaction rather
-- than fail one assertion. It also only proved `indpred is not null`, i.e.
-- "some partial predicate exists", not that it's the RIGHT predicate — a
-- future edit could silently narrow or wrong-way the where-clause and this
-- check would still pass. Rewritten to join pg_namespace and filter
-- nspname='public', then assert the predicate text itself.
-- ============================================================
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'job_alerts'
       and indexname = 'job_alerts_one_open_fingerprint'
  ),
  'job_alerts_one_open_fingerprint index exists'
);
select ok(
  (select pg_get_expr(i.indpred, i.indrelid) like '%resolved_at IS NULL%'
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'job_alerts_one_open_fingerprint'),
  'job_alerts_one_open_fingerprint predicate is resolved_at IS NULL'
);

-- ============================================================
-- 72-85: immutability triggers on the 7 append-only tables. Each trigger
-- gets both has_trigger (existence) and trigger_is (A4 — pins that the
-- trigger actually calls its matching enforcement function, not just that
-- *some* trigger of that name exists; a later migration could rename the
-- trigger onto a no-op function and has_trigger alone would still pass).
-- ============================================================
select has_trigger('public', 'estimate_financial_details', 'estimate_financial_details_immutable', 'estimate_financial_details has its immutability trigger');
select trigger_is('public', 'estimate_financial_details', 'estimate_financial_details_immutable', 'public', 'enforce_estimate_financial_details_immutability', 'estimate_financial_details_immutable calls the right enforcement function');
select has_trigger('public', 'job_budget_versions', 'job_budget_versions_immutable', 'job_budget_versions has its immutability trigger');
select trigger_is('public', 'job_budget_versions', 'job_budget_versions_immutable', 'public', 'enforce_job_budget_versions_immutability', 'job_budget_versions_immutable calls the right enforcement function');
select has_trigger('public', 'change_order_versions', 'change_order_versions_immutable', 'change_order_versions has its immutability trigger');
select trigger_is('public', 'change_order_versions', 'change_order_versions_immutable', 'public', 'enforce_change_order_versions_immutability', 'change_order_versions_immutable calls the right enforcement function');
select has_trigger('public', 'change_order_approvals', 'change_order_approvals_immutable', 'change_order_approvals has its immutability trigger');
select trigger_is('public', 'change_order_approvals', 'change_order_approvals_immutable', 'public', 'enforce_change_order_approvals_immutability', 'change_order_approvals_immutable calls the right enforcement function');
select has_trigger('public', 'job_checklists', 'job_checklists_immutable', 'job_checklists has its immutability trigger');
select trigger_is('public', 'job_checklists', 'job_checklists_immutable', 'public', 'enforce_job_checklists_immutability', 'job_checklists_immutable calls the right enforcement function');
select has_trigger('public', 'job_forecast_snapshots', 'job_forecast_snapshots_immutable', 'job_forecast_snapshots has its immutability trigger');
select trigger_is('public', 'job_forecast_snapshots', 'job_forecast_snapshots_immutable', 'public', 'enforce_job_forecast_snapshots_immutability', 'job_forecast_snapshots_immutable calls the right enforcement function');
select has_trigger('public', 'job_financial_closure_snapshots', 'job_financial_closure_snapshots_immutable', 'job_financial_closure_snapshots has its immutability trigger');
select trigger_is('public', 'job_financial_closure_snapshots', 'job_financial_closure_snapshots_immutable', 'public', 'enforce_job_financial_closure_snapshots_immutability', 'job_financial_closure_snapshots_immutable calls the right enforcement function');

-- ============================================================
-- 86-89: enum_has_labels (A5) — pins values AND order exactly as the
-- migration creates them, for the 4 parity-critical enums (cost accounting
-- categories and financial/health statuses that later tasks branch on by
-- label).
-- ============================================================
select enum_has_labels(
  'public', 'cost_category',
  array['direct_labor','materials','rentals','dump','subcontractors','other_direct','payment_processing'],
  'cost_category has the exact expected labels in order'
);
select enum_has_labels(
  'public', 'job_health_status',
  array['on_track','watch','at_risk'],
  'job_health_status has the exact expected labels in order'
);
select enum_has_labels(
  'public', 'forecast_confidence',
  array['high','medium','low'],
  'forecast_confidence has the exact expected labels in order'
);
select enum_has_labels(
  'public', 'job_financial_status',
  array['not_ready','invoice_review','invoice_sent','paid_reconciliation_pending','financially_closed','reconciliation_required'],
  'job_financial_status has the exact expected labels in order'
);

-- ============================================================
-- 90-97: type/default pins on load-bearing columns (A6) — proves the
-- columns Tasks 2-17 branch on by exact type and rely on for their default
-- value are what the migration actually created, not just that they exist
-- (has_column alone says nothing about type or default).
-- ============================================================
select col_type_is('public', 'jobs', 'financial_status', 'job_financial_status', 'jobs.financial_status is typed job_financial_status');
-- Expected value is the plain enum LABEL, not the rendered default
-- expression: col_default_is casts the expected string to the column's
-- type before comparing, so passing $$'not_ready'::job_financial_status$$
-- makes it try `'...'::job_financial_status` on the whole string and
-- ERROR 22P02, aborting the suite (caught by this task's own branch GREEN
-- run, 2026-08-19).
select col_default_is('public', 'jobs', 'financial_status', 'not_ready', 'jobs.financial_status defaults to not_ready');
select col_type_is('public', 'jobs', 'calendar_sync_revision', 'bigint', 'jobs.calendar_sync_revision is typed bigint');
select col_default_is('public', 'jobs', 'calendar_sync_revision', '0', 'jobs.calendar_sync_revision defaults to 0');
select col_type_is('public', 'jobs', 'launch_workflow', 'boolean', 'jobs.launch_workflow is typed boolean');
select col_default_is('public', 'jobs', 'launch_workflow', 'false', 'jobs.launch_workflow defaults to false');
select col_type_is('public', 'estimate_financial_details', 'customer_price', 'numeric(12,2)', 'estimate_financial_details.customer_price is typed numeric(12,2)');
select col_type_is('public', 'job_budget_versions', 'approved_revenue', 'numeric(12,2)', 'job_budget_versions.approved_revenue is typed numeric(12,2)');

-- ============================================================
-- 98-100: triggers_are (A13) — pins that the three MUTABLE ledger tables
-- (job_cost_entries, job_revenue_entries, overhead_expense_entries — these
-- are corrected in place via reconciliation, unlike the 7 append-only
-- tables above) carry NO triggers at all, so a later migration can't
-- quietly make one of them immutable (or add an unreviewed side-effecting
-- trigger) without this suite catching the drift.
-- ============================================================
select triggers_are('public', 'job_cost_entries', array[]::name[], 'job_cost_entries has no triggers');
select triggers_are('public', 'job_revenue_entries', array[]::name[], 'job_revenue_entries has no triggers');
select triggers_are('public', 'overhead_expense_entries', array[]::name[], 'overhead_expense_entries has no triggers');

-- ============================================================
-- 101-102: sequence ACL (A3) — job_cost_entry_audit_id_seq, the one
-- identity sequence this migration creates, must be revoked from
-- anon/authenticated the same as its owning table (Supabase's default
-- privileges pre-grant USAGE on new sequences, which the table-only revoke
-- sweep does not touch).
-- ============================================================
select sequence_privs_are('public', 'job_cost_entry_audit_id_seq', 'anon', array[]::name[], 'anon has no sequence privileges on job_cost_entry_audit_id_seq');
select sequence_privs_are('public', 'job_cost_entry_audit_id_seq', 'authenticated', array[]::name[], 'authenticated has no sequence privileges on job_cost_entry_audit_id_seq');

select * from finish();
rollback;
