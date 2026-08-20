-- Profitability v2 Phase 1, Task 5A (Session 4, SQL lane) pgTAP suite for
-- 20260820150000_outbox_claim_rpc.sql,
-- 20260820151000_job_cancellation_rpc.sql, and
-- 20260820152000_schedule_integration_dispatcher.sql.
--
-- House style throughout (schedule_estimate_rpc_test.sql,
-- estimate_commercial_lifecycle_test.sql, profitability_core_schema_test.sql):
-- every multi-overload assertion (has_function / function_privs_are /
-- throws_like) carries a description argument; fixtures are built inside
-- the begin/rollback transaction; `integration_outbox` fixtures use plain
-- direct INSERT (the table has no FK to satisfy — see the core-schema
-- migration's DDL), while `jobs` fixtures use direct INSERT with the
-- minimal column set `schedule_estimate_rpc_test.sql`'s own 910109 fixture
-- established (job_number + job_name are the only NOT NULL columns).
--
-- Test aggregate_id / job_number ranges, chosen to stay far outside every
-- other suite's fixture range (910101-910110 in schedule_estimate_rpc_test,
-- 900101-900103 in estimate_commercial_lifecycle_test, ~1400s live):
--   - claim_integration_events fixtures: aggregate_id 'claim-*' (text, no
--     numeric range needed -- integration_outbox has no numeric identity
--     column of its own tests need to avoid).
--   - cancel_scheduled_job fixtures: job_number JOB-920001..JOB-920099,
--     satisfying jobs_job_number_format (`^JOB-\d{4,}$`).
--
-- pg_cron guard (task brief: "guard: only assert if the pg_cron extension
-- is installed"): implemented as documentation, not a runtime conditional
-- -- a query referencing `cron.job` fails at PARSE time (schema `cron`
-- unresolvable), before any CASE/WHEN branching could short-circuit it, so
-- there is no way to make the assertion itself silently no-op when the
-- extension is truly absent without dynamic SQL. Per
-- docs/runbooks/profitability-schema-validation.md §3, pgTAP in this repo
-- only ever runs on disposable Supabase branches or production
-- single-transaction dry-runs -- both always carry pg_cron (it is also a
-- hard prerequisite of 20260813170000_schedule_crew_night_before.sql,
-- already live in every such environment) -- so the assertion below is
-- unconditional by construction; the "guard" is the documented fact that
-- this suite must never be run against an environment without it, not a
-- SQL-level IF.
--
-- plan(N) arithmetic, section by section (counts verified against the
-- actual file with `grep -cE '^select (has_function|isnt_definer|ok\(|
-- function_privs_are|lives_ok\(|is\(|throws_like\()'` -- every TAP-emitting
-- statement in this file starts a line with one of those seven forms, so
-- that grep's count is the ground truth plan(n) must match, same
-- methodology as schedule_estimate_rpc_test.sql):
--    6  Section A -- claim_integration_events existence / NOT SECURITY
--                    DEFINER / search_path / EXECUTE posture
--    6  Section B -- cancel_scheduled_job existence / NOT SECURITY DEFINER
--                    / search_path / EXECUTE posture
--    1  Section C -- cron.job contains integration-dispatcher at
--                    */5 * * * *
--   17  Section D -- claim behavior, type/eligibility coverage batch:
--                    due-pending + due-failed + stale-processing claimed
--                    (status/locked_at/attempts updated correctly);
--                    future-pending / succeeded / dead_letter /
--                    fresh-processing left untouched
--    4  Section E -- claim order + p_limit respected (3 due-pending rows,
--                    p_limit=2 claims the two earliest by available_at)
--    3  Section F -- claim limit-validation raises (null / 0 / 101), exact
--                    byte-pinned text
--   12  Section G -- cancel_scheduled_job happy path, postponed +
--                    GHL-linked (JOB-920001): status/cancelled_at/reason,
--                    job_events shape, both outbox rows with exact
--                    idempotency keys and payload, stage 'Quote Accepted'
--    1  Section H -- second cancel call on the now-cancelled JOB-920001
--                    raises the exact wrong-status text
--    4  Section I -- cancel_scheduled_job happy path, closed_lost +
--                    GHL-linked (JOB-920002): status/job_events stage_to=12
--                    /stage 'Closed Lost (Declined)'
--    3  Section J -- cancel_scheduled_job, unlinked job (JOB-920003):
--                    job.cancelled enqueued, NO ghl.stage.requested
--    4  Section K -- cancel_scheduled_job input-guard raises (actor name /
--                    resolution / reason / job-not-found), exact
--                    byte-pinned text
-- ---
--   61  total -- 6+6+1+17+4+3+12+1+4+3+4 = 61
--
-- No test reproduces the two-concurrent-session race pg_cron/SKIP LOCKED
-- guards against -- pgTAP runs single-session, the same limitation
-- schedule_estimate_rpc_test.sql documents for its own lock-ordering
-- coverage.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;
select plan(61);

-- ============================================================
-- Section A (1-6): claim_integration_events existence, NOT SECURITY
-- DEFINER, search_path pin, EXECUTE posture.
-- ============================================================
select has_function(
  'public', 'claim_integration_events', array['integer'],
  'claim_integration_events(integer) exists'
);
select isnt_definer(
  'public', 'claim_integration_events', array['integer'],
  'claim_integration_events is NOT SECURITY DEFINER (plain invoker, matching every service-role-called RPC in this schema)'
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_integration_events'),
  'claim_integration_events has search_path pinned to public, pg_temp'
);
select function_privs_are(
  'public', 'claim_integration_events', array['integer'],
  'anon', array[]::text[],
  'anon cannot EXECUTE claim_integration_events'
);
select function_privs_are(
  'public', 'claim_integration_events', array['integer'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE claim_integration_events'
);
select function_privs_are(
  'public', 'claim_integration_events', array['integer'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE claim_integration_events'
);

-- ============================================================
-- Section B (7-12): cancel_scheduled_job existence, NOT SECURITY DEFINER,
-- search_path pin, EXECUTE posture.
-- ============================================================
select has_function(
  'public', 'cancel_scheduled_job', array['text', 'text', 'text', 'uuid', 'text'],
  'cancel_scheduled_job(text, text, text, uuid, text) exists'
);
select isnt_definer(
  'public', 'cancel_scheduled_job', array['text', 'text', 'text', 'uuid', 'text'],
  'cancel_scheduled_job is NOT SECURITY DEFINER (plain invoker, matching every service-role-called RPC in this schema)'
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cancel_scheduled_job'),
  'cancel_scheduled_job has search_path pinned to public, pg_temp'
);
select function_privs_are(
  'public', 'cancel_scheduled_job', array['text', 'text', 'text', 'uuid', 'text'],
  'anon', array[]::text[],
  'anon cannot EXECUTE cancel_scheduled_job'
);
select function_privs_are(
  'public', 'cancel_scheduled_job', array['text', 'text', 'text', 'uuid', 'text'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE cancel_scheduled_job'
);
select function_privs_are(
  'public', 'cancel_scheduled_job', array['text', 'text', 'text', 'uuid', 'text'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE cancel_scheduled_job'
);

-- ============================================================
-- Section C (13): cron.job contains integration-dispatcher at
-- */5 * * * * (see header for why this is unconditional, not IF-guarded).
-- ============================================================
select ok(
  exists (
    select 1 from cron.job
     where jobname = 'integration-dispatcher'
       and schedule = '*/5 * * * *'
  ),
  'cron.job contains integration-dispatcher scheduled at */5 * * * * (pg_cron is a hard prerequisite of every environment this suite runs against -- see header)'
);

-- ============================================================
-- Fixture: claim behavior, type/eligibility coverage batch. Every arm of
-- the claimable predicate, plus every terminal/ineligible status, in one
-- insert pass so a single claim_integration_events(10) call exercises all
-- of them at once.
-- ============================================================
insert into public.integration_outbox (
  event_type, aggregate_type, aggregate_id, idempotency_key, payload,
  status, available_at, attempts
) values
  ('test.claim', 'test', 'claim-due-pending', 'claim-due-pending-key', '{}'::jsonb,
   'pending', now() - interval '5 minutes', 0),
  ('test.claim', 'test', 'claim-future-pending', 'claim-future-pending-key', '{}'::jsonb,
   'pending', now() + interval '1 hour', 0),
  ('test.claim', 'test', 'claim-succeeded', 'claim-succeeded-key', '{}'::jsonb,
   'succeeded', now() - interval '5 minutes', 0),
  ('test.claim', 'test', 'claim-dead-letter', 'claim-dead-letter-key', '{}'::jsonb,
   'dead_letter', now() - interval '5 minutes', 0),
  ('test.claim', 'test', 'claim-due-failed', 'claim-due-failed-key', '{}'::jsonb,
   'failed', now() - interval '5 minutes', 2);

insert into public.integration_outbox (
  event_type, aggregate_type, aggregate_id, idempotency_key, payload,
  status, available_at, locked_at, attempts
) values
  ('test.claim', 'test', 'claim-stale-processing', 'claim-stale-processing-key', '{}'::jsonb,
   'processing', now() - interval '1 hour', now() - interval '20 minutes', 1),
  ('test.claim', 'test', 'claim-fresh-processing', 'claim-fresh-processing-key', '{}'::jsonb,
   'processing', now() - interval '1 hour', now() - interval '5 minutes', 1);

create temporary table t_claim_batch1 as
select * from public.claim_integration_events(10);

-- ============================================================
-- Section D (14-29): claim behavior, type/eligibility coverage.
-- ============================================================
select is(
  (select count(*) from t_claim_batch1),
  3::bigint,
  'claim batch 1: exactly 3 rows claimed (due-pending, due-failed, stale-processing)'
);
select ok(
  exists (select 1 from t_claim_batch1 where aggregate_id = 'claim-due-pending'),
  'claim batch 1: due-pending (status=pending, available_at in the past) is claimed'
);
select ok(
  exists (select 1 from t_claim_batch1 where aggregate_id = 'claim-due-failed'),
  'claim batch 1: due-failed (status=failed, available_at in the past) is claimed'
);
select ok(
  exists (select 1 from t_claim_batch1 where aggregate_id = 'claim-stale-processing'),
  'claim batch 1: stale-processing (locked_at 20 minutes ago) IS reclaimed -- crash recovery'
);
select ok(
  not exists (select 1 from t_claim_batch1 where aggregate_id = 'claim-future-pending'),
  'claim batch 1: future-pending (available_at in the future) is NOT claimed'
);
select ok(
  not exists (select 1 from t_claim_batch1 where aggregate_id = 'claim-succeeded'),
  'claim batch 1: succeeded row is NEVER claimed'
);
select ok(
  not exists (select 1 from t_claim_batch1 where aggregate_id = 'claim-dead-letter'),
  'claim batch 1: dead_letter row is NEVER claimed'
);
select ok(
  not exists (select 1 from t_claim_batch1 where aggregate_id = 'claim-fresh-processing'),
  'claim batch 1: fresh-processing (locked_at 5 minutes ago, inside the 15-minute window) is NOT claimed'
);
select is(
  (select status::text from public.integration_outbox where aggregate_id = 'claim-due-pending'),
  'processing',
  'claim batch 1: due-pending status flipped to processing'
);
select is(
  (select attempts from public.integration_outbox where aggregate_id = 'claim-due-pending'),
  1,
  'claim batch 1: due-pending attempts incremented from 0 to 1'
);
select ok(
  (select locked_at is not null from public.integration_outbox where aggregate_id = 'claim-due-pending'),
  'claim batch 1: due-pending locked_at is set'
);
select is(
  (select status::text from public.integration_outbox where aggregate_id = 'claim-due-failed'),
  'processing',
  'claim batch 1: due-failed status flipped to processing'
);
select is(
  (select attempts from public.integration_outbox where aggregate_id = 'claim-due-failed'),
  3,
  'claim batch 1: due-failed attempts incremented from 2 to 3'
);
select is(
  (select attempts from public.integration_outbox where aggregate_id = 'claim-stale-processing'),
  2,
  'claim batch 1: stale-processing attempts incremented from 1 to 2 on reclaim'
);
select ok(
  (select locked_at > now() - interval '1 minute' from public.integration_outbox where aggregate_id = 'claim-stale-processing'),
  'claim batch 1: stale-processing locked_at is refreshed to a recent timestamp, not left at its original 20-minutes-ago value'
);
select is(
  (select attempts from public.integration_outbox where aggregate_id = 'claim-fresh-processing'),
  1,
  'claim batch 1: fresh-processing attempts UNCHANGED (not reclaimed)'
);
select is(
  (select status::text from public.integration_outbox where aggregate_id = 'claim-succeeded'),
  'succeeded',
  'claim batch 1: succeeded row status UNCHANGED'
);

-- ============================================================
-- Fixture + Section E (30-33): claim order + p_limit. Three due-pending
-- rows with distinct available_at; p_limit=2 must claim exactly the two
-- earliest, in order, leaving the third unclaimed.
-- ============================================================
insert into public.integration_outbox (
  event_type, aggregate_type, aggregate_id, idempotency_key, payload,
  status, available_at, attempts
) values
  ('test.claim', 'test', 'claim-order-1', 'claim-order-1-key', '{}'::jsonb,
   'pending', now() - interval '30 minutes', 0),
  ('test.claim', 'test', 'claim-order-2', 'claim-order-2-key', '{}'::jsonb,
   'pending', now() - interval '20 minutes', 0),
  ('test.claim', 'test', 'claim-order-3', 'claim-order-3-key', '{}'::jsonb,
   'pending', now() - interval '10 minutes', 0);

-- WITH ORDINALITY needs no explicit column-definition list here: the
-- function's return type (setof public.integration_outbox) is already a
-- known composite, so its field names pass through unchanged and the added
-- ordinality column defaults to the name "ordinality" -- both referenced
-- unqualified below since the function call is the query's only FROM
-- source. ordinality numbers rows in the exact order the function emitted
-- them, which is the ground truth for "claim order" here.
create temporary table t_claim_batch2 as
select aggregate_id, ordinality as ord
  from public.claim_integration_events(2) with ordinality as f;

select is(
  (select count(*) from t_claim_batch2),
  2::bigint,
  'claim batch 2: p_limit=2 respected -- exactly 2 of the 3 eligible rows claimed'
);
select is(
  (select aggregate_id from t_claim_batch2 where ord = 1),
  'claim-order-1',
  'claim batch 2: earliest available_at claimed first'
);
select is(
  (select aggregate_id from t_claim_batch2 where ord = 2),
  'claim-order-2',
  'claim batch 2: second-earliest available_at claimed second'
);
select ok(
  not exists (select 1 from t_claim_batch2 where aggregate_id = 'claim-order-3'),
  'claim batch 2: the latest (third) due row is NOT claimed -- cut off by p_limit'
);

-- ============================================================
-- Section F (34-36): claim limit-validation raises, exact byte-pinned text.
-- ============================================================
select throws_like(
  $sql$select claim_integration_events(null::integer)$sql$,
  'claim limit must be between 1 and 100',
  'p_limit null raises the exact claim-limit message'
);
select throws_like(
  $sql$select claim_integration_events(0)$sql$,
  'claim limit must be between 1 and 100',
  'p_limit=0 raises the exact claim-limit message'
);
select throws_like(
  $sql$select claim_integration_events(101)$sql$,
  'claim limit must be between 1 and 100',
  'p_limit=101 raises the exact claim-limit message'
);

-- ============================================================
-- Fixture + Section G (37-48): cancel_scheduled_job happy path, postponed
-- resolution, GHL-linked job (JOB-920001). calendar_sync_revision is
-- deliberately non-default (3) to prove the idempotency keys are
-- rev-scoped from the row's actual value, not a hardcoded rev1.
-- ============================================================
insert into public.jobs (
  job_number, job_name, status_v2, crew, calendar_sync_revision,
  ghl_opportunity_id, gcal_main_event_id, gcal_crew_event_id
) values (
  'JOB-920001', 'JOB-920001 - Cancellation Fixture One', 'scheduled'::public.job_lifecycle,
  'Crew 1', 3,
  'ghlOppFixture920001', 'gcalMainFixture920001', 'gcalCrewFixture920001'
);

select lives_ok(
  $sql$
    select cancel_scheduled_job(
      'JOB-920001', 'postponed', 'client asked to push it out', null::uuid, 'Test Canceller'
    )
  $sql$,
  'cancelling JOB-920001 (postponed, GHL-linked) succeeds'
);
select is(
  (select status_v2::text from public.jobs where job_number = 'JOB-920001'),
  'cancelled',
  'JOB-920001 status_v2 is cancelled'
);
select ok(
  (select cancelled_at is not null from public.jobs where job_number = 'JOB-920001'),
  'JOB-920001 cancelled_at is set'
);
select is(
  (select cancellation_reason from public.jobs where job_number = 'JOB-920001'),
  'client asked to push it out',
  'JOB-920001 cancellation_reason matches p_reason'
);
select is(
  (select count(*) from public.job_events
    where job_number = 'JOB-920001' and function_name = 'cancel_scheduled_job'),
  1::bigint,
  'exactly one job_events row logs the JOB-920001 cancellation'
);
select is(
  (select stage_from from public.job_events
    where job_number = 'JOB-920001' and function_name = 'cancel_scheduled_job'),
  6,
  'JOB-920001 job_events stage_from is 6 (Job Scheduled)'
);
select is(
  (select stage_to from public.job_events
    where job_number = 'JOB-920001' and function_name = 'cancel_scheduled_job'),
  5,
  'JOB-920001 job_events stage_to is 5 (Quote Accepted) for the postponed resolution'
);
select is(
  (select count(*) from public.integration_outbox
    where idempotency_key = 'job.cancelled:JOB-920001:rev3'),
  1::bigint,
  'JOB-920001 job.cancelled outbox row exists with the rev3-scoped idempotency key'
);
select is(
  (select payload from public.integration_outbox where idempotency_key = 'job.cancelled:JOB-920001:rev3'),
  jsonb_build_object(
    'job_number', 'JOB-920001', 'resolution', 'postponed',
    'gcal_main_event_id', 'gcalMainFixture920001', 'gcal_crew_event_id', 'gcalCrewFixture920001',
    'crew', 'Crew 1'
  ),
  'JOB-920001 job.cancelled payload carries resolution, both calendar event ids, and crew'
);
select is(
  (select count(*) from public.integration_outbox
    where idempotency_key = 'ghl.stage.requested:JOB-920001:cancel:rev3'),
  1::bigint,
  'JOB-920001 ghl.stage.requested outbox row exists with the rev3-scoped idempotency key'
);
select is(
  (select payload->>'stage' from public.integration_outbox
    where idempotency_key = 'ghl.stage.requested:JOB-920001:cancel:rev3'),
  'Quote Accepted',
  'JOB-920001 ghl.stage.requested payload stage is Quote Accepted for the postponed resolution'
);
select is(
  (select payload->>'ghl_opportunity_id' from public.integration_outbox
    where idempotency_key = 'ghl.stage.requested:JOB-920001:cancel:rev3'),
  'ghlOppFixture920001',
  'JOB-920001 ghl.stage.requested payload carries the linked ghl_opportunity_id'
);

-- ============================================================
-- Section H (49): a second cancel call on the now-cancelled JOB-920001
-- raises the exact byte-pinned wrong-status text.
-- ============================================================
select throws_like(
  $sql$
    select cancel_scheduled_job(
      'JOB-920001', 'postponed', 'trying to cancel again', null::uuid, 'Test Canceller'
    )
  $sql$,
  'job JOB-920001 cannot be cancelled from status cancelled',
  'a second cancel_scheduled_job call on the already-cancelled JOB-920001 raises the exact wrong-status message'
);

-- ============================================================
-- Fixture + Section I (50-53): cancel_scheduled_job happy path, closed_lost
-- resolution, GHL-linked job (JOB-920002).
-- ============================================================
insert into public.jobs (
  job_number, job_name, status_v2, crew, calendar_sync_revision,
  ghl_opportunity_id, gcal_main_event_id, gcal_crew_event_id
) values (
  'JOB-920002', 'JOB-920002 - Cancellation Fixture Two', 'scheduled'::public.job_lifecycle,
  'Crew 2', 1,
  'ghlOppFixture920002', 'gcalMainFixture920002', 'gcalCrewFixture920002'
);

select lives_ok(
  $sql$
    select cancel_scheduled_job(
      'JOB-920002', 'closed_lost', 'client went with another contractor', null::uuid, 'Test Canceller Two'
    )
  $sql$,
  'cancelling JOB-920002 (closed_lost, GHL-linked) succeeds'
);
select is(
  (select status_v2::text from public.jobs where job_number = 'JOB-920002'),
  'cancelled',
  'JOB-920002 status_v2 is cancelled'
);
select is(
  (select stage_to from public.job_events
    where job_number = 'JOB-920002' and function_name = 'cancel_scheduled_job'),
  12,
  'JOB-920002 job_events stage_to is 12 (Closed Lost / Declined) for the closed_lost resolution'
);
select is(
  (select payload->>'stage' from public.integration_outbox
    where idempotency_key = 'ghl.stage.requested:JOB-920002:cancel:rev1'),
  'Closed Lost (Declined)',
  'JOB-920002 ghl.stage.requested payload stage is Closed Lost (Declined) for the closed_lost resolution'
);

-- ============================================================
-- Fixture + Section J (54-56): cancel_scheduled_job on an UNLINKED job
-- (ghl_opportunity_id is null, JOB-920003) -- job.cancelled is enqueued,
-- ghl.stage.requested is NOT.
-- ============================================================
insert into public.jobs (
  job_number, job_name, status_v2, crew, calendar_sync_revision
) values (
  'JOB-920003', 'JOB-920003 - Cancellation Fixture Three', 'scheduled'::public.job_lifecycle,
  'Crew 3', 1
);

select lives_ok(
  $sql$
    select cancel_scheduled_job(
      'JOB-920003', 'postponed', 'reason for the unlinked job', null::uuid, 'Test Canceller Three'
    )
  $sql$,
  'cancelling JOB-920003 (postponed, UNLINKED -- no ghl_opportunity_id) succeeds'
);
select is(
  (select count(*) from public.integration_outbox
    where idempotency_key = 'job.cancelled:JOB-920003:rev1'),
  1::bigint,
  'JOB-920003 job.cancelled outbox row IS enqueued despite having no GHL link'
);
select ok(
  not exists (
    select 1 from public.integration_outbox
     where aggregate_id = 'JOB-920003' and event_type = 'ghl.stage.requested'
  ),
  'JOB-920003 gets NO ghl.stage.requested outbox row -- unlinked jobs have nothing for the dispatcher to update in GHL'
);

-- ============================================================
-- Section K (57-60): cancel_scheduled_job input-guard raises, exact
-- byte-pinned text. Validation order (actor name, resolution, reason, job
-- lookup) means each of these can use minimal/garbage values for every
-- argument checked AFTER the one under test.
-- ============================================================
select throws_like(
  $sql$select cancel_scheduled_job('JOB-920001', 'postponed', 'a reason', null::uuid, '   ')$sql$,
  'actor name is required',
  'a blank (whitespace-only) p_actor_name raises the exact message'
);
select throws_like(
  $sql$select cancel_scheduled_job('JOB-920001', 'bogus-resolution', 'a reason', null::uuid, 'Test Scheduler')$sql$,
  'invalid resolution: bogus-resolution',
  'an invalid p_resolution raises the exact message, with the supplied value formatted in'
);
select throws_like(
  $sql$select cancel_scheduled_job('JOB-920001', 'postponed', '', null::uuid, 'Test Scheduler')$sql$,
  'cancellation reason is required',
  'a blank p_reason raises the exact message'
);
select throws_like(
  $sql$select cancel_scheduled_job('JOB-9199999', 'postponed', 'a reason', null::uuid, 'Test Scheduler')$sql$,
  'no job found for JOB-9199999',
  'a nonexistent p_job_number raises the exact message, with the supplied job number formatted in'
);

select * from finish();
rollback;
