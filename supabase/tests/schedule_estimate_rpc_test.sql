-- Profitability v2 Phase 1, Task 4 (Session 3, Lane 4a) pgTAP suite for
-- 20260819170000_schedule_estimate_rpc.sql.
--
-- Fix round (adversarial review, same session): F1 numeric/integer literal
-- casts fixed throughout; F2 idempotent-mismatch + reactivation-mismatch
-- coverage added (Sections I/J); F3 positive with-GHL-link coverage added
-- (Section K); F4 eligibility-2 explicit coverage added (Section L) plus a
-- full input-guard sweep (Section B); F5 is_definer flipped to
-- isnt_definer (schedule_estimate is no longer SECURITY DEFINER); F6
-- ghl.stage.requested-only-when-linked is exercised both ways (910101 has
-- no link, 910108 does); F7 scope_summary coverage added (910101 gets 2
-- line items, 910102 stays line-item-free as the NULL case). Every count
-- assertion touching integration_outbox was re-derived for F6 (a family
-- with no estimate_identity_links row now enqueues ONE outbox row per
-- schedule/reactivate action, not two).
--
-- Re-review round (same session): R1 -- the F8 clamp was dead code (a
-- numeric(7,2)-typed variable enforces its own typmod at every
-- assignment, before the clamp line could ever run); fixed by declaring
-- the variable plain numeric in the migration, and covered here by a new
-- Section M (family 910110: a $1.00 accepted_price against a
-- >$1,000,000 fully-loaded cost, asserting the schedule succeeds and the
-- stored planned_profit_pct is exactly -99999.99). R2 -- the dual-link
-- collision raise's wording was reworded to drop "already" (it was being
-- misclassified web-side as `already_scheduled`); re-verified below that
-- the final text contains none of classifyScheduleError's five matched
-- substrings ("already", "accept", "supersed", "financial", "not
-- presented") and so correctly falls through to `other`.
--
-- House style throughout (estimate_commercial_lifecycle_test.sql,
-- profitability_core_schema_test.sql, workforce_auth_boundary_test.sql):
-- every multi-overload assertion carries a description argument; fixtures
-- are built via the REAL write-path RPCs
-- (create_estimate_with_items_v2 / record_estimate_acceptance_event /
-- update_estimate_job_number) where the scenario needs an
-- estimate_financial_details row, an acceptance projection, or a
-- pre-existing job_number, and via direct INSERT (mirroring
-- estimate_commercial_lifecycle_test.sql's 900102/900103 pattern) only for
-- the fixtures that deliberately need a shape the RPCs can't produce (no
-- financial_details row; a legacy job to collide with).
--
-- Estimate families use 910101-910110 -- far outside both the live range
-- (~1400s) and estimate_commercial_lifecycle_test.sql's own 900101-900103
-- fixture range.
--
-- plan(82) arithmetic, section by section (counts verified against the
-- actual file with `grep -cE '^select (has_function|isnt_definer|ok\(|
-- function_privs_are|lives_ok\(|is\(|throws_like\()'` -- every
-- TAP-emitting statement in this file starts a line with one of those
-- seven forms, so that grep's count is the ground truth plan(n) must
-- match):
--   6  Section A -- function existence / NOT SECURITY DEFINER (F5) /
--                   search_path / EXECUTE posture
--   9  Section B -- input-guard raises (F4): every argument-shape failure
--                   the RPC can raise, each fired before any DB lookup
--  28  Section C -- happy-path mint (910101, deliberately NO
--                   estimate_identity_links row): job row shape, budget
--                   v1, estimates.job_number + audit row, job_events,
--                   ONE outbox row (F6: no link => no ghl.stage.requested),
--                   ghl_contact_id/ghl_opportunity_id are NULL (F3, no
--                   link case), scope_summary populated from 2 line items
--                   with no dollar-digit content (F7)
--   5  Section D -- idempotent re-call on the now-active job from C
--                   (910101): same job, no second number/budget, no new
--                   outbox rows, new p_schedule values are ignored
--   4  Section E -- quoted-price family (910102): accepted_price =
--                   quoted_price flows to approved_revenue; profit
--                   RECOMPUTED, not copied from estimate_financial_details;
--                   scope_summary is NULL (F7, zero-line-item case)
--   1  Section F -- reversal-after-acceptance blocks scheduling (910103)
--   1  Section G -- missing estimate_financial_details blocks (910104,
--                   direct-insert fixture, no financial_details row)
--   1  Section H -- non-current (superseded-since-accepted) version blocks
--                   (910105 v1, after v2 is accepted)
--   2  Section I -- F2 idempotent-mismatch (910106): family re-accepted on
--                   a DIFFERENT version while the original job is still
--                   ACTIVE -- scheduling the new version must raise, not
--                   silently return the stale job
--   2  Section J -- F2 reactivation-mismatch (910107): same shape as I but
--                   the original job is CANCELLED first -- scheduling the
--                   new version must raise before ever reaching the
--                   reactivate branch, not revive stale budget/ids
--   5  Section K -- F3/F6 positive case (910108): family WITH an
--                   estimate_identity_links row -- minted job carries
--                   ghl_contact_id/ghl_opportunity_id, and
--                   ghl.stage.requested IS enqueued with the right
--                   opportunity id
--   1  Section L -- F4 eligibility-2 explicit (910109): estimates.job_number
--                   set via update_estimate_job_number directly (simulating
--                   a legacy external link), asserts the exact
--                   byte-identical eligibility-2 message
--   2  Section M -- re-review R1: the F8 clamp actually executes (910110,
--                   $1.00 accepted_price vs a >$1,000,000 fully-loaded
--                   cost) -- schedule succeeds, stored planned_profit_pct
--                   is exactly -99999.99, not a raised overflow error
--  14  Section N -- cancelled-job reactivation, reusing 910101's job:
--                   same JOB-XXXX, budget v1 retained, revision bumped,
--                   NEW p_schedule values DO apply this time (unlike D),
--                   ONE fresh outbox row at rev2 (F6: 910101 has no link)
--   1  Section O -- outbox idempotency_key UNIQUE constraint is really
--                   enforced (raw duplicate insert against a live key from
--                   Section C raises)
-- ---
--  82  total -- 6+9+28+5+4+1+1+1+2+2+5+1+2+14+1 = 82
--
-- No test reproduces the two-concurrent-session races the migration's own
-- header documents (family-lock serialization; the
-- jobs_original_estimate_number_key / jobs_ghl_opportunity_id_key
-- race-catch branches) -- pgTAP runs single-session, the same limitation
-- estimate_commercial_lifecycle_test.sql documents for its own F3
-- deadlock fix.
--
-- pgTAP lives on branches / production single-transaction dry-runs only,
-- per docs/runbooks/profitability-schema-validation.md §3.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;
select plan(82);

-- ============================================================
-- Section A (1-6): function existence, NOT SECURITY DEFINER (fix round
-- F5), search_path pin, EXECUTE posture.
-- ============================================================
select has_function(
  'public', 'schedule_estimate', array['uuid', 'jsonb', 'uuid', 'text'],
  'schedule_estimate(uuid, jsonb, uuid, text) exists'
);
select isnt_definer(
  'public', 'schedule_estimate', array['uuid', 'jsonb', 'uuid', 'text'],
  'schedule_estimate is NOT SECURITY DEFINER (fix round F5 -- plain invoker, matching every sibling estimates RPC)'
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'schedule_estimate'),
  'schedule_estimate has search_path pinned to public, pg_temp'
);
select function_privs_are(
  'public', 'schedule_estimate', array['uuid', 'jsonb', 'uuid', 'text'],
  'anon', array[]::text[],
  'anon cannot EXECUTE schedule_estimate'
);
select function_privs_are(
  'public', 'schedule_estimate', array['uuid', 'jsonb', 'uuid', 'text'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE schedule_estimate'
);
select function_privs_are(
  'public', 'schedule_estimate', array['uuid', 'jsonb', 'uuid', 'text'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE schedule_estimate'
);

-- ============================================================
-- Section B (7-15): input-guard raises (fix round F4). Every guard fires
-- BEFORE any database lookup, so p_estimate_id can be an arbitrary
-- syntactically-valid uuid (gen_random_uuid()) for every case except the
-- "estimate id itself is null" case.
-- ============================================================
select throws_like(
  $sql$select schedule_estimate(null, jsonb_build_object('crew','Crew 1','startDate','2026-09-01','endDate','2026-09-01'), null::uuid, 'Test Scheduler')$sql$,
  '%p_estimate_id is required%',
  'a null p_estimate_id raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), jsonb_build_object('crew','Crew 1','startDate','2026-09-01','endDate','2026-09-01'), null::uuid, '')$sql$,
  '%p_actor_name is required%',
  'a blank p_actor_name raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), '[]'::jsonb, null::uuid, 'Test Scheduler')$sql$,
  '%p_schedule must be a non-null JSON object%',
  'a non-object p_schedule (a JSON array) raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), jsonb_build_object('crew','   ','startDate','2026-09-01','endDate','2026-09-01'), null::uuid, 'Test Scheduler')$sql$,
  '%p_schedule.crew is required%',
  'a blank (whitespace-only) crew raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), jsonb_build_object('crew','Crew 1','endDate','2026-09-01'), null::uuid, 'Test Scheduler')$sql$,
  '%p_schedule.startDate is required%',
  'a missing startDate raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), jsonb_build_object('crew','Crew 1','startDate','not-a-date','endDate','2026-09-01'), null::uuid, 'Test Scheduler')$sql$,
  '%p_schedule.startDate is not a valid date%',
  'a garbage (non-parseable) startDate raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), jsonb_build_object('crew','Crew 1','startDate','2026-09-01'), null::uuid, 'Test Scheduler')$sql$,
  '%p_schedule.endDate is required%',
  'a missing endDate raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), jsonb_build_object('crew','Crew 1','startDate','2026-09-01','endDate','not-a-date'), null::uuid, 'Test Scheduler')$sql$,
  '%p_schedule.endDate is not a valid date%',
  'a garbage (non-parseable) endDate raises'
);
select throws_like(
  $sql$select schedule_estimate(gen_random_uuid(), jsonb_build_object('crew','Crew 1','startDate','2026-09-05','endDate','2026-09-01'), null::uuid, 'Test Scheduler')$sql$,
  '%must be on or after startDate%',
  'endDate before startDate raises'
);

-- ============================================================
-- Fixture: family 910101 -- full estimate + financial details via the real
-- v2 write path, no quote override (accepted_price = total_bid), TWO line
-- items (F7 scope_summary source), deliberately NO estimate_identity_links
-- row (F3/F6 "no link" case).
-- Fully-loaded cost = 260 + 50 + 0 + 195 + 0 + 0 + 230 + 35 = 770.00.
-- accepted_price = coalesce(quoted_price, total_bid) = 1000.00.
-- Expected budget-v1 profit = 1000.00 - 770.00 = 230.00 (23.00%).
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910101, 'version', 1, 'status', 'sent',
    'client_name', 'Acme Corp', 'client_type', 'Contractor',
    'client_phone', '555-0101', 'job_address', '123 Main St', 'city', 'Provo',
    'labor_method', 'total_hours', 'total_job_hours', 10, 'dump_count', 1,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 260, 'dump_fees', 195, 'total_direct', 455,
    'overhead', 230, 'profit', 315, 'cc_fee', 0, 'total_bid', 1000.00,
    'true_margin_pct', 31.5, 'created_by_name', 'Test Fixture'
  ),
  jsonb_build_array(
    jsonb_build_object('name', 'Kitchen Demo', 'description', '', 'labor_hours', 4, 'dump_count', 0.5, 'materials_cost', 20, 'sort_order', 1),
    jsonb_build_object('name', 'Garage Cleanout', 'description', '', 'labor_hours', 6, 'dump_count', 0.75, 'materials_cost', 30, 'sort_order', 2)
  ),
  jsonb_build_object(
    'productive_hours', 10, 'operational_labor_cost', 260, 'materials_cost', 50,
    'rentals_cost', 0, 'expected_dump_cost', 195, 'subcontractors_cost', 0,
    'other_direct_cost', 0, 'allocated_overhead', 230, 'expected_processing_cost', 35,
    'markup_amount', 225, 'customer_price', 1000.00,
    'planned_economic_profit', 230.00, 'planned_profit_pct', 23.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910101 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910101-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910101 and version = 1),
  'action', 'accepted',
  'authorization_method', 'signature',
  'customer_contact_name', 'Acme Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance for schedule_estimate happy-path mint'
));

-- ============================================================
-- Section C (16-43): happy-path mint.
-- ============================================================
select lives_ok(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910101 and version = 1),
      jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-02'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  'scheduling the accepted estimate 910101 succeeds'
);
select ok(
  (select job_number ~ '^JOB-\d{4,}$' from public.jobs where original_estimate_number = 910101),
  'minted job_number matches the JOB-XXXX format'
);
select is(
  (select status_v2::text from public.jobs where original_estimate_number = 910101),
  'scheduled',
  'minted job status_v2 is scheduled'
);
select ok(
  (select launch_workflow from public.jobs where original_estimate_number = 910101),
  'minted job launch_workflow is true'
);
select is(
  (select current_budget_version from public.jobs where original_estimate_number = 910101),
  1,
  'minted job current_budget_version is 1'
);
select is(
  (select original_estimate_id from public.jobs where original_estimate_number = 910101),
  (select id from public.estimates where estimate_number = 910101 and version = 1),
  'minted job original_estimate_id points at the scheduled estimate version'
);
select is(
  (select crew from public.jobs where original_estimate_number = 910101),
  'Crew 1',
  'minted job crew matches p_schedule'
);
select is(
  (select start_date from public.jobs where original_estimate_number = 910101),
  '2026-09-01'::date,
  'minted job start_date matches p_schedule'
);
select is(
  (select end_date from public.jobs where original_estimate_number = 910101),
  '2026-09-02'::date,
  'minted job end_date matches p_schedule'
);
select is(
  (select client_name from public.jobs where original_estimate_number = 910101),
  'Acme Corp',
  'minted job client_name copied from the estimate'
);
select is(
  (select city from public.jobs where original_estimate_number = 910101),
  'Provo',
  'minted job city copied from the estimate'
);
select is(
  (select calendar_sync_revision from public.jobs where original_estimate_number = 910101),
  1::bigint,
  'minted job calendar_sync_revision starts at 1'
);
select is(
  (select job_number from public.estimates where estimate_number = 910101 and version = 1),
  (select job_number from public.jobs where original_estimate_number = 910101),
  'estimates.job_number was set to the minted job_number'
);
select is(
  (select count(*) from public.estimate_mutations_audit
    where estimate_id = (select id from public.estimates where estimate_number = 910101 and version = 1)
      and new_job_number is not null),
  1::bigint,
  'exactly one estimate_mutations_audit row records the job_number write, via update_estimate_job_number'
);
select is(
  (select count(*) from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101)),
  1::bigint,
  'exactly one job_budget_versions row exists for the minted job'
);
select is(
  (select approved_revenue from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101) and version = 1),
  1000.00,
  'budget v1 approved_revenue is the accepted_price (total_bid, no override in this family)'
);
select is(
  (select planned_economic_profit from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101) and version = 1),
  230.00,
  'budget v1 planned_economic_profit = accepted_price(1000) - fully-loaded cost(770)'
);
select is(
  (select planned_profit_pct from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101) and version = 1),
  23.00,
  'budget v1 planned_profit_pct = 230/1000 * 100'
);
select is(
  (select overhead_rate from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101) and version = 1),
  23::numeric,
  'budget v1 overhead_rate is the estimate rate snapshot (fix round F1: explicit ::numeric cast)'
);
select is(
  (select labor_rate from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101) and version = 1),
  26::numeric,
  'budget v1 labor_rate is the estimate rate snapshot (fix round F1: explicit ::numeric cast)'
);
select is(
  (select count(*) from public.job_events
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101)
      and function_name = 'schedule_estimate'),
  1::bigint,
  'exactly one job_events row logs the mint'
);
select is(
  (select count(*) from public.integration_outbox
    where aggregate_id = (select job_number from public.jobs where original_estimate_number = 910101)),
  1::bigint,
  'fix round F6: exactly ONE integration_outbox row (job.scheduled only) -- 910101 has no estimate_identity_links row, so ghl.stage.requested must not be enqueued'
);
select ok(
  exists (
    select 1 from public.integration_outbox
     where idempotency_key = 'job.scheduled:' || (select job_number from public.jobs where original_estimate_number = 910101) || ':rev1'
  ),
  'job.scheduled outbox row carries the rev1 idempotency key'
);
select ok(
  not exists (
    select 1 from public.integration_outbox
     where idempotency_key = 'ghl.stage.requested:' || (select job_number from public.jobs where original_estimate_number = 910101) || ':rev1'
  ),
  'fix round F6: no ghl.stage.requested outbox row exists for the unlinked family 910101'
);
select ok(
  (select ghl_contact_id is null from public.jobs where original_estimate_number = 910101),
  'fix round F3: minted job ghl_contact_id is NULL -- family 910101 has no estimate_identity_links row'
);
select ok(
  (select ghl_opportunity_id is null from public.jobs where original_estimate_number = 910101),
  'fix round F3: minted job ghl_opportunity_id is NULL -- family 910101 has no estimate_identity_links row'
);
select is(
  (select scope_summary from public.jobs where original_estimate_number = 910101),
  'Kitchen Demo' || E'\n' || 'Garage Cleanout',
  'fix round F7: minted job scope_summary is the two line-item NAMES, newline-joined, in sort_order'
);
select ok(
  (select scope_summary !~ '\$\d' from public.jobs where original_estimate_number = 910101),
  'fix round F7: minted job scope_summary carries no dollar-amount-looking content'
);

-- ============================================================
-- Section D (44-48): idempotent re-call against the now-ACTIVE job for
-- 910101 -- must return unchanged, ignore the new p_schedule, mint nothing.
-- ============================================================
select lives_ok(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910101 and version = 1),
      jsonb_build_object('crew', 'Crew 3', 'startDate', '2026-11-01', 'endDate', '2026-11-05'),
      null::uuid, 'Test Scheduler Two'
    )
  $sql$,
  'a repeated schedule_estimate call against the active job does not raise'
);
select is(
  (select count(*) from public.jobs where original_estimate_number = 910101),
  1::bigint,
  'still exactly one job row for family 910101 (no second mint)'
);
select is(
  (select crew from public.jobs where original_estimate_number = 910101),
  'Crew 1',
  'the active job crew is UNCHANGED -- the repeated call''s new p_schedule was ignored'
);
select is(
  (select count(*) from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101)),
  1::bigint,
  'still exactly one job_budget_versions row (no second budget minted)'
);
select is(
  (select count(*) from public.integration_outbox
    where aggregate_id = (select job_number from public.jobs where original_estimate_number = 910101)),
  1::bigint,
  'still exactly one integration_outbox row (no new events enqueued on the idempotent re-call)'
);

-- ============================================================
-- Fixture + Section E (49-52): family 910102 -- quoted_price (1000.00)
-- differs from total_bid (1200.00); accepted_price must be the QUOTED
-- price, and budget-v1 profit must be RECOMPUTED, not copied from
-- estimate_financial_details.planned_economic_profit (which is
-- deliberately seeded at a DIFFERENT number, 430.00 = 1200 - 770, to prove
-- the two are not the same value). Zero line items -- the F7 NULL case.
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910102, 'version', 1, 'status', 'sent',
    'client_name', 'Beta LLC', 'client_type', 'Homeowner',
    'labor_method', 'total_hours', 'total_job_hours', 10, 'dump_count', 1,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 260, 'dump_fees', 195, 'total_direct', 455,
    'overhead', 230, 'profit', 315, 'cc_fee', 0, 'total_bid', 1200.00,
    'true_margin_pct', 31.5,
    'quoted_price', 1000.00, 'quote_override_reason', 'fixture: discounted at acceptance',
    'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 10, 'operational_labor_cost', 260, 'materials_cost', 50,
    'rentals_cost', 0, 'expected_dump_cost', 195, 'subcontractors_cost', 0,
    'other_direct_cost', 0, 'allocated_overhead', 230, 'expected_processing_cost', 35,
    'markup_amount', 425, 'customer_price', 1200.00,
    'planned_economic_profit', 430.00, 'planned_profit_pct', 35.83
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910102 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910102-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910102 and version = 1),
  'action', 'accepted',
  'authorization_method', 'email',
  'customer_contact_name', 'Beta Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance for the quoted-price deviation-12 proof'
));

select lives_ok(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910102 and version = 1),
      jsonb_build_object('crew', 'Crew 2', 'startDate', '2026-09-10', 'endDate', '2026-09-10'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  'scheduling the quoted-price family 910102 succeeds'
);
select is(
  (select approved_revenue from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910102) and version = 1),
  1000.00,
  'budget v1 approved_revenue is the QUOTED price (1000), not total_bid (1200) or customer_price (1200)'
);
select is(
  (select planned_economic_profit from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910102) and version = 1),
  230.00,
  'budget v1 planned_economic_profit is RECOMPUTED (1000-770=230), not copied from financial_details (430)'
);
select ok(
  (select scope_summary is null from public.jobs where original_estimate_number = 910102),
  'fix round F7: minted job scope_summary is NULL -- family 910102 has zero line items'
);

-- ============================================================
-- Fixture + Section F (53): family 910103 -- reversal-after-acceptance
-- blocks scheduling.
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910103, 'version', 1, 'status', 'sent',
    'client_name', 'Gamma Inc',
    'labor_method', 'total_hours', 'total_job_hours', 5, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 130, 'dump_fees', 0, 'total_direct', 130,
    'overhead', 115, 'profit', 61.25, 'cc_fee', 0, 'total_bid', 306.25,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 5, 'operational_labor_cost', 130, 'allocated_overhead', 115,
    'markup_amount', 61.25, 'customer_price', 306.25,
    'planned_economic_profit', 61.25, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910103 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910103-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910103 and version = 1),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Gamma Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance, to be reversed'
));

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910103 and version = 1),
  'action', 'reversed',
  'reversal_destination', 'closed_lost',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture reversal for the schedule_estimate reversal-blocks-scheduling test'
));

select throws_like(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910103 and version = 1),
      jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  '%is not the currently accepted version%',
  'scheduling a reversed-acceptance estimate (910103) raises (byte-identical eligibility-1 message)'
);

-- ============================================================
-- Fixture + Section G (54): family 910104 -- direct-insert fixture (NOT
-- via create_estimate_with_items_v2), so it deliberately has NO
-- estimate_financial_details row. Mirrors
-- estimate_commercial_lifecycle_test.sql's 900102/900103 direct-insert
-- pattern.
-- ============================================================
insert into public.estimates (
  estimate_number, version, status,
  labor_method, total_job_hours, markup_pct, labor_rate, overhead_rate, dump_rate, cc_fee_rate,
  labor_cost, dump_fees, total_direct, overhead, profit, cc_fee, total_bid, true_margin_pct,
  client_name
) values (
  910104, 1, 'sent',
  'total_hours', 8, 25, 26, 23, 300, 0.035,
  208, 0, 208, 184, 98, 0, 490, 20,
  'Delta Co'
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910104 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910104-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910104 and version = 1),
  'action', 'accepted',
  'authorization_method', 'text',
  'customer_contact_name', 'Delta Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance with no financial_details row'
));

select throws_like(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910104 and version = 1),
      jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  '%has no estimate_financial_details row%',
  'scheduling an accepted estimate with no financial_details row raises (byte-identical eligibility-3 message)'
);

-- ============================================================
-- Fixture + Section H (55): family 910105 -- v1 accepted, then v2 created
-- and accepted (re-pointing the family's acceptance projection), but NO
-- job ever minted for either version. v1 is now non-current -- scheduling
-- it must be blocked even though v1 itself was never reversed.
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910105, 'version', 1, 'status', 'sent',
    'client_name', 'Epsilon LLC',
    'labor_method', 'total_hours', 'total_job_hours', 5, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 130, 'dump_fees', 0, 'total_direct', 130,
    'overhead', 115, 'profit', 61.25, 'cc_fee', 0, 'total_bid', 306.25,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 5, 'operational_labor_cost', 130, 'allocated_overhead', 115,
    'markup_amount', 61.25, 'customer_price', 306.25,
    'planned_economic_profit', 61.25, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910105 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910105-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910105 and version = 1),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Epsilon Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance of v1, soon to be superseded'
));

select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910105, 'version', 2,
    'supersedes_estimate_id', (select id::text from public.estimates where estimate_number = 910105 and version = 1),
    'status', 'sent',
    'client_name', 'Epsilon LLC',
    'labor_method', 'total_hours', 'total_job_hours', 6, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 156, 'dump_fees', 0, 'total_direct', 156,
    'overhead', 138, 'profit', 73.5, 'cc_fee', 0, 'total_bid', 367.50,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 6, 'operational_labor_cost', 156, 'allocated_overhead', 138,
    'markup_amount', 73.5, 'customer_price', 367.50,
    'planned_economic_profit', 73.5, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910105 and version = 2),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910105-v2'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910105 and version = 2),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Epsilon Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance of v2 -- re-points the family, making v1 non-current'
));

select throws_like(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910105 and version = 1),
      jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  '%is not the currently accepted version%',
  'scheduling the now-non-current v1 of family 910105 raises, even though v1 itself was never reversed'
);

-- ============================================================
-- Fixture + Section I (56-57), fix round F2 idempotent-mismatch: family
-- 910106 -- v1 accepted and SCHEDULED (job minted, still ACTIVE), then v2
-- created and accepted (re-pointing the family WITHOUT ever reversing or
-- cancelling v1's job). Scheduling v2 must raise -- returning the v1-minted
-- job unchanged would silently hide that the family's commercial story
-- moved to a different estimate version.
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910106, 'version', 1, 'status', 'sent',
    'client_name', 'Zeta Co',
    'labor_method', 'total_hours', 'total_job_hours', 5, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 130, 'dump_fees', 0, 'total_direct', 130,
    'overhead', 115, 'profit', 61.25, 'cc_fee', 0, 'total_bid', 306.25,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 5, 'operational_labor_cost', 130, 'allocated_overhead', 115,
    'markup_amount', 61.25, 'customer_price', 306.25,
    'planned_economic_profit', 61.25, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910106 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910106-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910106 and version = 1),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Zeta Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance of v1, to be scheduled then superseded while still active'
));

select schedule_estimate(
  (select id from public.estimates where estimate_number = 910106 and version = 1),
  jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
  null::uuid, 'Test Scheduler'
);

select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910106, 'version', 2,
    'supersedes_estimate_id', (select id::text from public.estimates where estimate_number = 910106 and version = 1),
    'status', 'sent',
    'client_name', 'Zeta Co',
    'labor_method', 'total_hours', 'total_job_hours', 6, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 156, 'dump_fees', 0, 'total_direct', 156,
    'overhead', 138, 'profit', 73.5, 'cc_fee', 0, 'total_bid', 367.50,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 6, 'operational_labor_cost', 156, 'allocated_overhead', 138,
    'markup_amount', 73.5, 'customer_price', 367.50,
    'planned_economic_profit', 73.5, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910106 and version = 2),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910106-v2'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910106 and version = 2),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Zeta Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture: v2 accepted WITHOUT reversing v1 -- v1''s job is still active'
));

select throws_like(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910106 and version = 2),
      jsonb_build_object('crew', 'Crew 2', 'startDate', '2026-09-15', 'endDate', '2026-09-15'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  '%was minted from a different estimate version%',
  'fix round F2 (idempotent-mismatch): scheduling v2 while the family''s ACTIVE job was minted from v1 raises'
);
select is(
  (select original_estimate_id from public.jobs where original_estimate_number = 910106),
  (select id from public.estimates where estimate_number = 910106 and version = 1),
  'fix round F2: the family 910106 job still points at v1 -- the failed v2 attempt did not mutate it'
);

-- ============================================================
-- Fixture + Section J (58-59), fix round F2 reactivation-mismatch: same
-- shape as Section I, but v1's job is CANCELLED first. Scheduling v2 must
-- still raise -- BEFORE ever reaching the reactivate branch -- rather than
-- reviving the cancelled job on v1's now-stale budget/accepted_price.
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910107, 'version', 1, 'status', 'sent',
    'client_name', 'Eta Co',
    'labor_method', 'total_hours', 'total_job_hours', 5, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 130, 'dump_fees', 0, 'total_direct', 130,
    'overhead', 115, 'profit', 61.25, 'cc_fee', 0, 'total_bid', 306.25,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 5, 'operational_labor_cost', 130, 'allocated_overhead', 115,
    'markup_amount', 61.25, 'customer_price', 306.25,
    'planned_economic_profit', 61.25, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910107 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910107-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910107 and version = 1),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Eta Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance of v1, to be scheduled, cancelled, then superseded'
));

select schedule_estimate(
  (select id from public.estimates where estimate_number = 910107 and version = 1),
  jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
  null::uuid, 'Test Scheduler'
);

update public.jobs
   set status_v2 = 'cancelled'::public.job_lifecycle,
       cancelled_at = now(),
       cancellation_reason = 'fixture cancel for the F2 reactivation-mismatch test'
 where original_estimate_number = 910107;

select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910107, 'version', 2,
    'supersedes_estimate_id', (select id::text from public.estimates where estimate_number = 910107 and version = 1),
    'status', 'sent',
    'client_name', 'Eta Co',
    'labor_method', 'total_hours', 'total_job_hours', 6, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 156, 'dump_fees', 0, 'total_direct', 156,
    'overhead', 138, 'profit', 73.5, 'cc_fee', 0, 'total_bid', 367.50,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 6, 'operational_labor_cost', 156, 'allocated_overhead', 138,
    'markup_amount', 73.5, 'customer_price', 367.50,
    'planned_economic_profit', 73.5, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910107 and version = 2),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910107-v2'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910107 and version = 2),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Eta Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture: v2 accepted after v1''s job was cancelled -- must not revive on stale v1 data'
));

select throws_like(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910107 and version = 2),
      jsonb_build_object('crew', 'Crew 2', 'startDate', '2026-09-20', 'endDate', '2026-09-20'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  '%was minted from a different estimate version%',
  'fix round F2 (reactivation-mismatch): scheduling v2 while the family''s CANCELLED job was minted from v1 raises, before reactivation ever runs'
);
select is(
  (select status_v2::text from public.jobs where original_estimate_number = 910107),
  'cancelled',
  'fix round F2: the family 910107 job stays cancelled -- the failed v2 attempt did not reactivate it'
);

-- ============================================================
-- Fixture + Section K (60-64), fix round F3/F6 positive case: family
-- 910108 -- WITH an estimate_identity_links row. The minted job must carry
-- ghl_contact_id/ghl_opportunity_id, and ghl.stage.requested MUST be
-- enqueued (contrast with 910101's no-link case in Section C).
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910108, 'version', 1, 'status', 'sent',
    'client_name', 'Theta Corp',
    'labor_method', 'total_hours', 'total_job_hours', 5, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 130, 'dump_fees', 0, 'total_direct', 130,
    'overhead', 115, 'profit', 61.25, 'cc_fee', 0, 'total_bid', 306.25,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 5, 'operational_labor_cost', 130, 'allocated_overhead', 115,
    'markup_amount', 61.25, 'customer_price', 306.25,
    'planned_economic_profit', 61.25, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910108 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910108-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910108 and version = 1),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Theta Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance for the F3/F6 with-GHL-link positive case'
));

insert into public.estimate_identity_links (
  estimate_number, ghl_contact_id, ghl_opportunity_id, linked_by_name, actor_assurance
) values (
  910108, 'ghlContactFixture0910108', 'ghlOpportunityFixture0910108', 'Test Fixture', 'external_webhook'
);

select lives_ok(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910108 and version = 1),
      jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  'scheduling the linked family 910108 succeeds'
);
select is(
  (select ghl_contact_id from public.jobs where original_estimate_number = 910108),
  'ghlContactFixture0910108',
  'fix round F3: minted job ghl_contact_id is populated from estimate_identity_links'
);
select is(
  (select ghl_opportunity_id from public.jobs where original_estimate_number = 910108),
  'ghlOpportunityFixture0910108',
  'fix round F3: minted job ghl_opportunity_id is populated from estimate_identity_links'
);
select is(
  (select count(*) from public.integration_outbox
    where aggregate_id = (select job_number from public.jobs where original_estimate_number = 910108)),
  2::bigint,
  'fix round F6: TWO integration_outbox rows (job.scheduled AND ghl.stage.requested) -- 910108 has a linked opportunity'
);
select is(
  (select payload->>'ghl_opportunity_id' from public.integration_outbox
    where idempotency_key = 'ghl.stage.requested:' || (select job_number from public.jobs where original_estimate_number = 910108) || ':rev1'),
  'ghlOpportunityFixture0910108',
  'fix round F3/F6: the ghl.stage.requested payload carries the linked opportunity id'
);

-- ============================================================
-- Fixture + Section L (65), fix round F4 eligibility-2 explicit: family
-- 910109 -- estimates.job_number is set via update_estimate_job_number
-- DIRECTLY (simulating a legacy external link, e.g. the still-live
-- ghl-job-webhook promoteEstimateForJob path), not through
-- schedule_estimate. Asserts the exact BYTE-IDENTICAL eligibility-2
-- message, including the job_number it names.
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910109, 'version', 1, 'status', 'sent',
    'client_name', 'Iota LLC',
    'labor_method', 'total_hours', 'total_job_hours', 5, 'dump_count', 0,
    'markup_pct', 25, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 130, 'dump_fees', 0, 'total_direct', 130,
    'overhead', 115, 'profit', 61.25, 'cc_fee', 0, 'total_bid', 306.25,
    'true_margin_pct', 20, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 5, 'operational_labor_cost', 130, 'allocated_overhead', 115,
    'markup_amount', 61.25, 'customer_price', 306.25,
    'planned_economic_profit', 61.25, 'planned_profit_pct', 20.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910109 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910109-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910109 and version = 1),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Iota Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance for the F4 eligibility-2 explicit test'
));

-- A minimal legacy-shaped job row (satisfies jobs_job_number_format and
-- job_name NOT NULL; every other column defaults) to be the FK target of
-- estimates.job_number -- simulating a link set OUTSIDE schedule_estimate.
insert into public.jobs (job_number, job_name) values ('JOB-9109900', 'JOB-9109900 - Legacy Test Link');

select update_estimate_job_number(
  (select id from public.estimates where estimate_number = 910109 and version = 1),
  'JOB-9109900', null::uuid, 'Test Fixture'
);

select throws_like(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910109 and version = 1),
      jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  '%already has job_number JOB-9109900 set (linked outside schedule_estimate)%',
  'fix round F4: scheduling an estimate whose job_number was set outside schedule_estimate raises the exact byte-identical eligibility-2 message'
);

-- ============================================================
-- Fixture + Section M, re-review R1: family 910110 -- accepted_price of
-- $1.00 against a fully-loaded cost over $1,000,000 (rentals_cost alone).
-- Proves the F8 clamp actually executes: v_planned_profit_pct is declared
-- plain `numeric` (not numeric(7,2)) precisely so the raw, wildly
-- out-of-range computed ratio (-100,000,000.00) can be assigned WITHOUT
-- raising "numeric field overflow", and only THEN gets bounded to
-- numeric(7,2)'s representable range before the job_budget_versions
-- insert. If the clamp were dead code (R1's finding: a numeric(7,2)
-- variable declaration enforces its typmod at every assignment, including
-- the computing one, before the clamp line ever runs), this schedule call
-- would raise instead of succeeding.
-- ============================================================
select create_estimate_with_items_v2(
  jsonb_build_object(
    'estimate_number', 910110, 'version', 1, 'status', 'sent',
    'client_name', 'Kappa Co',
    'labor_method', 'total_hours', 'total_job_hours', 1, 'dump_count', 0,
    'markup_pct', 0, 'labor_rate', 26, 'overhead_rate', 23, 'dump_rate', 300,
    'cc_fee_rate', 0.035, 'labor_cost', 1, 'dump_fees', 0, 'total_direct', 1,
    'overhead', 0, 'profit', 0, 'cc_fee', 0, 'total_bid', 1.00,
    'true_margin_pct', 0, 'created_by_name', 'Test Fixture'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'productive_hours', 1, 'operational_labor_cost', 1, 'materials_cost', 0,
    'rentals_cost', 1000000, 'expected_dump_cost', 0, 'subcontractors_cost', 0,
    'other_direct_cost', 0, 'allocated_overhead', 0, 'expected_processing_cost', 0,
    'markup_amount', 0, 'customer_price', 1.00,
    'planned_economic_profit', 0.00, 'planned_profit_pct', 0.00
  )
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values (
  (select id from public.estimates where estimate_number = 910110 and version = 1),
  'ghl', 'Test Presenter', 'selected_identity', 'hash-fixture-910110-v1'
);

select record_estimate_acceptance_event(jsonb_build_object(
  'estimate_id', (select id::text from public.estimates where estimate_number = 910110 and version = 1),
  'action', 'accepted',
  'authorization_method', 'verbal',
  'customer_contact_name', 'Kappa Contact',
  'recorded_by_name', 'Test Actor',
  'actor_assurance', 'selected_identity',
  'note', 'fixture acceptance for the re-review R1 planned_profit_pct clamp proof'
));

select lives_ok(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910110 and version = 1),
      jsonb_build_object('crew', 'Crew 1', 'startDate', '2026-09-01', 'endDate', '2026-09-01'),
      null::uuid, 'Test Scheduler'
    )
  $sql$,
  're-review R1: scheduling family 910110 (accepted_price $1.00 against a >$1,000,000 fully-loaded cost) succeeds instead of raising a numeric field overflow'
);
select is(
  (select planned_profit_pct from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910110) and version = 1),
  -99999.99,
  're-review R1: budget v1 planned_profit_pct is clamped to exactly -99999.99, not the raw -100,000,000.00 ratio'
);

-- ============================================================
-- Section N (was M pre-R1; 80-93): cancelled-job reactivation, reusing
-- 910101's job (minted in Section C, still status_v2='scheduled' at this
-- point since Section D's idempotent re-call left it untouched).
-- ============================================================
update public.jobs
   set status_v2 = 'cancelled'::public.job_lifecycle,
       cancelled_at = now(),
       cancellation_reason = 'fixture cancel for the reactivation test'
 where original_estimate_number = 910101;

select lives_ok(
  $sql$
    select schedule_estimate(
      (select id from public.estimates where estimate_number = 910101 and version = 1),
      jsonb_build_object('crew', 'Crew 2', 'startDate', '2026-10-01', 'endDate', '2026-10-03'),
      null::uuid, 'Test Reactivator'
    )
  $sql$,
  'rescheduling the cancelled job for family 910101 does not raise'
);
select is(
  (select count(*) from public.jobs where original_estimate_number = 910101),
  1::bigint,
  'still exactly one job row for family 910101 -- reactivation, not a second mint'
);
select is(
  (select status_v2::text from public.jobs where original_estimate_number = 910101),
  'scheduled',
  'reactivated job status_v2 is back to scheduled'
);
select is(
  (select crew from public.jobs where original_estimate_number = 910101),
  'Crew 2',
  'reactivated job crew IS updated to the new p_schedule (unlike the active-job idempotent case in Section D)'
);
select is(
  (select start_date from public.jobs where original_estimate_number = 910101),
  '2026-10-01'::date,
  'reactivated job start_date matches the new p_schedule'
);
select is(
  (select end_date from public.jobs where original_estimate_number = 910101),
  '2026-10-03'::date,
  'reactivated job end_date matches the new p_schedule'
);
select ok(
  (select cancelled_at is null from public.jobs where original_estimate_number = 910101),
  'reactivated job cancelled_at is cleared'
);
select ok(
  (select cancellation_reason is null from public.jobs where original_estimate_number = 910101),
  'reactivated job cancellation_reason is cleared'
);
select is(
  (select calendar_sync_revision from public.jobs where original_estimate_number = 910101),
  2::bigint,
  'reactivated job calendar_sync_revision incremented from 1 to 2'
);
select is(
  (select current_budget_version from public.jobs where original_estimate_number = 910101),
  1,
  'reactivated job current_budget_version is still 1 -- budget v1 is retained, not re-minted'
);
select is(
  (select count(*) from public.job_budget_versions
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101)),
  1::bigint,
  'still exactly one job_budget_versions row after reactivation'
);
select is(
  (select count(*) from public.job_events
    where job_number = (select job_number from public.jobs where original_estimate_number = 910101)
      and function_name = 'schedule_estimate'),
  2::bigint,
  'job_events now carries two schedule_estimate rows (mint + reactivate)'
);
select is(
  (select count(*) from public.integration_outbox
    where aggregate_id = (select job_number from public.jobs where original_estimate_number = 910101)),
  2::bigint,
  'fix round F6: integration_outbox now carries TWO rows for this job (job.scheduled at rev1 + rev2 -- 910101 has no GHL link, so no ghl.stage.requested rows ever)'
);
select ok(
  exists (
    select 1 from public.integration_outbox
     where idempotency_key = 'job.scheduled:' || (select job_number from public.jobs where original_estimate_number = 910101) || ':rev2'
  ),
  'the reactivation enqueued a fresh job.scheduled outbox row at rev2'
);

-- ============================================================
-- Section O (94): outbox idempotency_key UNIQUE constraint is really
-- enforced -- a raw duplicate insert against a live key from Section C
-- raises, proving the "same idempotency key is never delivered twice"
-- invariant is backed by a real DB constraint, not just RPC-level
-- discipline.
-- ============================================================
select throws_like(
  $sql$
    insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
    values (
      'job.scheduled', 'job',
      (select job_number from public.jobs where original_estimate_number = 910101),
      'job.scheduled:' || (select job_number from public.jobs where original_estimate_number = 910101) || ':rev1',
      '{}'::jsonb
    )
  $sql$,
  '%duplicate key value violates unique constraint%',
  'a raw duplicate insert against an existing idempotency_key raises a real unique-constraint violation'
);

select * from finish();
rollback;
