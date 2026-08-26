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
-- job_financial_closure_snapshots.closed_by is a real FK to auth.users(id).
-- ⚠️ TASK-2 ASSERTION FIX: the brief's original fixture read
-- `(select id from auth.users limit 1)`, which assumes at least one live
-- auth user exists in the environment under test. A disposable Supabase
-- branch (per the runbook) is schema-only with zero rows in every table,
-- auth.users included — that ambient-data assumption silently produces a
-- NULL closed_by and a not-null-violation abort, unrelated to anything this
-- migration does. Inserting a test-local synthetic auth user makes the
-- fixture self-contained and correct in any environment (branch or
-- production dry-run); it is rolled back with the rest of the transaction.
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111'::uuid)
  on conflict do nothing;
insert into public.job_financial_closure_snapshots (
  job_number, closure_version, budget_version, financials, closed_by, closed_by_name
) values (
  'JOB-940003', 1, 1, '{"note":"test closure"}'::jsonb,
  '11111111-1111-4111-8111-111111111111'::uuid, 'Test Fixture'
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
