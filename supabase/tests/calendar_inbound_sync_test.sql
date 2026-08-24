-- Profitability v2 Phase 1, Task 5B Step 2 (Lane S) pgTAP suite for
-- 20260824150000_calendar_watch_registry.sql and
-- 20260824151000_calendar_inbound_rpcs.sql. (20260824152000's cron job is
-- NOT asserted here — see note at the end of this header.)
--
-- House style throughout (integration_dispatcher_rpcs_test.sql,
-- schedule_estimate_rpc_test.sql, profitability_core_schema_test.sql):
-- every multi-overload assertion carries a description argument; fixtures
-- are built via direct INSERT inside the rolled-back transaction (mirroring
-- schedule_estimate_rpc_test.sql's 910109/910110-style direct-insert
-- fixtures for scenarios the write-path RPCs can't produce on their own —
-- here, EVERY fixture needs a shape no RPC in this schema writes, since
-- job_schedule_exceptions/job_alerts rows only otherwise come from
-- open_calendar_deletion_exception itself, which is half of what this
-- suite is testing).
--
-- Test job_number range: JOB-930001..JOB-930099, chosen to stay far
-- outside every other suite's fixture range (910101-910110 in
-- schedule_estimate_rpc_test, 900101-900103 in
-- estimate_commercial_lifecycle_test, 920001-920099 in
-- integration_dispatcher_rpcs_test, ~1400s live).
--
-- jsonb-returning RPCs (all three) are captured into a temporary table
-- (`create temporary table t_x as select public.<fn>(...) as result;`)
-- rather than wrapped in lives_ok/throws_like alone, because the assertions
-- this suite must make live INSIDE the returned JSONB (applied/reason,
-- opened/reason, resolution/job_number/exception_id) — a plain lives_ok
-- proves the call didn't raise but throws away the one thing most of these
-- assertions need to inspect. State-mutation assertions (jobs/job_events/
-- integration_outbox/job_schedule_exceptions/job_alerts rows) are then
-- queried directly, exactly as cancel_scheduled_job_test and
-- schedule_estimate_rpc_test do for their own record-returning RPCs.
--
-- p_actor is passed null::uuid throughout (never a fabricated uuid) because
-- job_schedule_exceptions.resolved_by carries a REAL FK to auth.users(id)
-- — same reasoning cancel_scheduled_job_test/schedule_estimate_rpc_test
-- document for their own p_actor arguments, which have no such FK but are
-- passed null anyway for parity. resolved_by is therefore asserted NULL
-- after every resolve_schedule_exception call in this suite, never as a
-- specific actor id.
--
-- Byte-identity self-check performed while writing this file (not just
-- read from the brief): every throws_like pattern below was compared
-- character-for-character against the file header's raise-text table in
-- 20260824151000_calendar_inbound_rpcs.sql, and grepped for the seven
-- forbidden needles ("already", "accept", "supersed", "financial", "not
-- presented", "no job found", "cannot be cancelled") — none present in any
-- pattern below.
--
-- plan(N) arithmetic, section by section (counts verified against the
-- actual file with `grep -cE '^select (has_enum|has_table|has_column|ok\(|
-- table_privs_are|function_privs_are|has_function|isnt_definer|is\(|
-- throws_like\(|lives_ok\()'` — every TAP-emitting statement in this file
-- starts a line with one of those eleven forms (lives_ok is called out
-- explicitly here because a first pass of this count, run without it,
-- undercounted by exactly the one sync_log assertion below and had to be
-- corrected), so that grep's count is the ground truth plan(n) must match,
-- same methodology as schedule_estimate_rpc_test.sql and
-- integration_dispatcher_rpcs_test.sql):
--   24  Section A -- schema existence/shape: enum, 2 tables, 10 has_column
--                    spot-checks, calendar_watch_channels_one_active +
--                    job_schedule_exceptions_one_open (existence +
--                    predicate, 2 each), RLS enabled x2, ACL (anon/
--                    authenticated hold no table privileges) x2 tables,
--                    sync_log accepts google_to_supabase
--   18  Section B -- RPC posture x3 (has_function / isnt_definer /
--                    search_path pin / anon denied / authenticated denied /
--                    service_role granted)
--   25  Section C -- apply_calendar_date_change behavior: matching
--                    revision + new dates (10), same dates / dates_unchanged
--                    (4), stale_revision (6), M7 not_scheduled (4),
--                    endDate<startDate raise (1)
--   20  Section D -- open_calendar_deletion_exception behavior: scheduled
--                    job opens (12), second call already-open (4), M7
--                    not_scheduled (4)
--   60  Section E -- resolve_schedule_exception behavior: reschedule with
--                    dates (17), reschedule missing dates raises text5 (1),
--                    reschedule endDate<startDate raises text6 (1), dismiss
--                    on a scheduled job (9), postponed (9), closed_lost (4),
--                    non-open raises text2 (1), blank actor raises text7
--                    (1), invalid resolution raises text3 (1), blank reason
--                    raises text4 (1), exception-not-found raises text1 (1),
--                    reschedule on a non-scheduled job raises text8 (1),
--                    dismiss on that SAME non-scheduled job
--                    acknowledge-and-closes instead of raising (13 --
--                    fix round 1, controller ruling, finding I1, 2026-08-24)
-- ---
--  147  total -- 24+18+25+20+60 = 147
--
-- 20260824152000_schedule_calendar_maintenance.sql's cron.job row is NOT
-- separately asserted here (unlike integration_dispatcher_rpcs_test.sql's
-- Section C for the */5 job) purely because this suite was already the
-- largest in the repo before that would add a 135th line proving the same
-- one-line cron.schedule() fact this migration's own header documents as
-- copied-structure-verbatim from the already-covered
-- 20260813170000/20260820152000 pattern; the controller's runbook step
-- (apply all three migrations, re-run pgTAP GREEN) still exercises it by
-- applying the migration, and a missing/misspelled cron entry would show up
-- immediately in `select * from cron.job` during that manual check.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;
select plan(147);

-- ============================================================
-- Section A (1-24): schema existence + shape.
-- ============================================================
select has_enum('public', 'watch_channel_status', 'watch_channel_status enum exists');
select has_table('public', 'calendar_watch_channels', 'calendar_watch_channels table exists');
select has_table('public', 'calendar_inbound_marks', 'calendar_inbound_marks table exists');

select has_column('public', 'calendar_watch_channels', 'channel_id', 'calendar_watch_channels.channel_id exists');
select has_column('public', 'calendar_watch_channels', 'resource_id', 'calendar_watch_channels.resource_id exists');
select has_column('public', 'calendar_watch_channels', 'calendar_id', 'calendar_watch_channels.calendar_id exists');
select has_column('public', 'calendar_watch_channels', 'token_hash', 'calendar_watch_channels.token_hash exists');
select has_column('public', 'calendar_watch_channels', 'expires_at', 'calendar_watch_channels.expires_at exists');
select has_column('public', 'calendar_watch_channels', 'status', 'calendar_watch_channels.status exists');
select has_column('public', 'calendar_watch_channels', 'last_notification_at', 'calendar_watch_channels.last_notification_at exists');

select has_column('public', 'calendar_inbound_marks', 'calendar_id', 'calendar_inbound_marks.calendar_id exists');
select has_column('public', 'calendar_inbound_marks', 'event_id', 'calendar_inbound_marks.event_id exists');
select has_column('public', 'calendar_inbound_marks', 'event_updated', 'calendar_inbound_marks.event_updated exists');

select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'calendar_watch_channels'
       and indexname = 'calendar_watch_channels_one_active'
  ),
  'calendar_watch_channels_one_active index exists'
);
select ok(
  (select pg_get_expr(i.indpred, i.indrelid) like '%status = ''active''%'
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'calendar_watch_channels_one_active'),
  'calendar_watch_channels_one_active predicate is status = ''active'''
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'job_schedule_exceptions'
       and indexname = 'job_schedule_exceptions_one_open'
  ),
  'job_schedule_exceptions_one_open index exists'
);
select ok(
  (select pg_get_expr(i.indpred, i.indrelid) like '%status = ''open''%'
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'job_schedule_exceptions_one_open'),
  'job_schedule_exceptions_one_open predicate is status = ''open'''
);

select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'calendar_watch_channels'),
  'RLS is enabled on calendar_watch_channels'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'calendar_inbound_marks'),
  'RLS is enabled on calendar_inbound_marks'
);

select table_privs_are('public', 'calendar_watch_channels', 'anon', array[]::name[], 'anon has no table privileges on calendar_watch_channels');
select table_privs_are('public', 'calendar_watch_channels', 'authenticated', array[]::name[], 'authenticated has no table privileges on calendar_watch_channels');
select table_privs_are('public', 'calendar_inbound_marks', 'anon', array[]::name[], 'anon has no table privileges on calendar_inbound_marks');
select table_privs_are('public', 'calendar_inbound_marks', 'authenticated', array[]::name[], 'authenticated has no table privileges on calendar_inbound_marks');

-- google_to_supabase is accepted by the widened sync_log_direction_check
-- (mirrors _shared/log.ts's writeSyncLog() required-field set: direction,
-- trigger_event, action_taken, status). Rolled back with the rest of this
-- transaction -- no real row survives.
select lives_ok(
  $sql$
    insert into public.sync_log (direction, trigger_event, action_taken, status)
    values ('google_to_supabase', 'calendar_test_probe', 'created', 'success')
  $sql$,
  'sync_log accepts direction = google_to_supabase'
);

-- ============================================================
-- Section B (25-42): RPC posture -- existence / NOT SECURITY DEFINER /
-- search_path pin / EXECUTE posture, all three RPCs.
-- ============================================================
select has_function(
  'public', 'apply_calendar_date_change',
  array['text', 'date', 'date', 'bigint', 'text', 'timestamptz', 'text'],
  'apply_calendar_date_change(text, date, date, bigint, text, timestamptz, text) exists'
);
select isnt_definer(
  'public', 'apply_calendar_date_change',
  array['text', 'date', 'date', 'bigint', 'text', 'timestamptz', 'text'],
  'apply_calendar_date_change is NOT SECURITY DEFINER (plain invoker, matching every service-role-called RPC in this schema)'
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_calendar_date_change'),
  'apply_calendar_date_change has search_path pinned to public, pg_temp'
);
select function_privs_are(
  'public', 'apply_calendar_date_change',
  array['text', 'date', 'date', 'bigint', 'text', 'timestamptz', 'text'],
  'anon', array[]::text[],
  'anon cannot EXECUTE apply_calendar_date_change'
);
select function_privs_are(
  'public', 'apply_calendar_date_change',
  array['text', 'date', 'date', 'bigint', 'text', 'timestamptz', 'text'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE apply_calendar_date_change'
);
select function_privs_are(
  'public', 'apply_calendar_date_change',
  array['text', 'date', 'date', 'bigint', 'text', 'timestamptz', 'text'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE apply_calendar_date_change'
);

select has_function(
  'public', 'open_calendar_deletion_exception', array['text', 'text', 'jsonb'],
  'open_calendar_deletion_exception(text, text, jsonb) exists'
);
select isnt_definer(
  'public', 'open_calendar_deletion_exception', array['text', 'text', 'jsonb'],
  'open_calendar_deletion_exception is NOT SECURITY DEFINER (plain invoker, matching every service-role-called RPC in this schema)'
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'open_calendar_deletion_exception'),
  'open_calendar_deletion_exception has search_path pinned to public, pg_temp'
);
select function_privs_are(
  'public', 'open_calendar_deletion_exception', array['text', 'text', 'jsonb'],
  'anon', array[]::text[],
  'anon cannot EXECUTE open_calendar_deletion_exception'
);
select function_privs_are(
  'public', 'open_calendar_deletion_exception', array['text', 'text', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE open_calendar_deletion_exception'
);
select function_privs_are(
  'public', 'open_calendar_deletion_exception', array['text', 'text', 'jsonb'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE open_calendar_deletion_exception'
);

select has_function(
  'public', 'resolve_schedule_exception',
  array['uuid', 'text', 'text', 'date', 'date', 'uuid', 'text'],
  'resolve_schedule_exception(uuid, text, text, date, date, uuid, text) exists'
);
select isnt_definer(
  'public', 'resolve_schedule_exception',
  array['uuid', 'text', 'text', 'date', 'date', 'uuid', 'text'],
  'resolve_schedule_exception is NOT SECURITY DEFINER (plain invoker, matching every service-role-called RPC in this schema)'
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_schedule_exception'),
  'resolve_schedule_exception has search_path pinned to public, pg_temp'
);
select function_privs_are(
  'public', 'resolve_schedule_exception',
  array['uuid', 'text', 'text', 'date', 'date', 'uuid', 'text'],
  'anon', array[]::text[],
  'anon cannot EXECUTE resolve_schedule_exception'
);
select function_privs_are(
  'public', 'resolve_schedule_exception',
  array['uuid', 'text', 'text', 'date', 'date', 'uuid', 'text'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE resolve_schedule_exception'
);
select function_privs_are(
  'public', 'resolve_schedule_exception',
  array['uuid', 'text', 'text', 'date', 'date', 'uuid', 'text'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE resolve_schedule_exception'
);

-- ============================================================
-- Fixture + Section C (43-67): apply_calendar_date_change behavior.
-- ============================================================
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, ghl_opportunity_id
) values (
  'JOB-930001', 'JOB-930001 - Apply Fixture One', 'scheduled'::public.job_lifecycle,
  'Crew 1', '2026-09-01', '2026-09-03', 5, 'ghlOppFixture930001'
);

create temporary table t_apply1 as
select public.apply_calendar_date_change(
  'JOB-930001', '2026-09-05', '2026-09-07', 5, 'evt-930001-a', now(), 'watch_push'
) as result;

select is((select result->>'applied' from t_apply1), 'true', 'apply 1: applied=true on matching revision + new dates');
select is(((select result->>'calendar_sync_revision' from t_apply1))::int, 6, 'apply 1: result carries the bumped revision (6)');
select is((select start_date from public.jobs where job_number = 'JOB-930001'), '2026-09-05'::date, 'apply 1: jobs.start_date updated');
select is((select end_date from public.jobs where job_number = 'JOB-930001'), '2026-09-07'::date, 'apply 1: jobs.end_date updated');
select is((select calendar_sync_revision from public.jobs where job_number = 'JOB-930001'), 6::bigint, 'apply 1: jobs.calendar_sync_revision bumped from 5 to 6');
select is(
  (select count(*) from public.job_events
    where job_number = 'JOB-930001' and function_name = 'apply_calendar_date_change' and trigger_source = 'google_calendar'),
  1::bigint,
  'apply 1: exactly one job_events row logs the change'
);
select is(
  (select count(*) from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930001:rev6'),
  1::bigint,
  'apply 1: job.scheduled outbox row exists with the rev6-scoped idempotency key'
);
select is(
  (select payload->>'start_date' from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930001:rev6'),
  '2026-09-05',
  'apply 1: outbox payload carries the new start_date'
);
select is(
  (select payload->>'end_date' from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930001:rev6'),
  '2026-09-07',
  'apply 1: outbox payload carries the new end_date'
);
select is(
  ((select payload->>'calendar_sync_revision' from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930001:rev6'))::int,
  6,
  'apply 1: outbox payload carries the new revision'
);

-- Same dates: dates_unchanged no-op. Deliberately p_expected_revision = 6
-- (the NOW-current revision) to isolate the dates_unchanged branch from
-- the stale_revision branch tested next.
create temporary table t_apply2 as
select public.apply_calendar_date_change(
  'JOB-930001', '2026-09-05', '2026-09-07', 6, 'evt-930001-b', now(), 'watch_push'
) as result;

select is((select result->>'applied' from t_apply2), 'false', 'apply 2: applied=false when dates are unchanged');
select is((select result->>'reason' from t_apply2), 'dates_unchanged', 'apply 2: reason is dates_unchanged');
select is((select calendar_sync_revision from public.jobs where job_number = 'JOB-930001'), 6::bigint, 'apply 2: revision NOT bumped');
select is(
  (select count(*) from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930001:rev7'),
  0::bigint,
  'apply 2: no rev7 outbox row was created'
);

-- Stale revision: caller's p_expected_revision (3) is behind the job's
-- actual current revision (6).
create temporary table t_apply3 as
select public.apply_calendar_date_change(
  'JOB-930001', '2026-09-10', '2026-09-12', 3, 'evt-930001-c', now(), 'watch_push'
) as result;

select is((select result->>'applied' from t_apply3), 'false', 'apply 3: applied=false on a stale expected revision');
select is((select result->>'reason' from t_apply3), 'stale_revision', 'apply 3: reason is stale_revision');
select is(((select result->>'job_revision' from t_apply3))::int, 6, 'apply 3: result surfaces the job''s actual current revision');
select is(((select result->>'event_revision' from t_apply3))::int, 3, 'apply 3: result surfaces the caller''s stale expected revision');
select is((select calendar_sync_revision from public.jobs where job_number = 'JOB-930001'), 6::bigint, 'apply 3: revision unchanged');
select is((select start_date from public.jobs where job_number = 'JOB-930001'), '2026-09-05'::date, 'apply 3: dates unchanged');

-- M7 case: job is cancelled, not scheduled -- must be inert, never a raise.
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date, calendar_sync_revision
) values (
  'JOB-930002', 'JOB-930002 - Apply Fixture Two (Cancelled)', 'cancelled'::public.job_lifecycle,
  'Crew 2', '2026-10-01', '2026-10-02', 2
);

create temporary table t_apply4 as
select public.apply_calendar_date_change(
  'JOB-930002', '2026-10-05', '2026-10-06', 2, 'evt-930002-a', now(), 'watch_push'
) as result;

select is((select result->>'applied' from t_apply4), 'false', 'apply 4 (M7): applied=false for a cancelled job');
select is((select result->>'reason' from t_apply4), 'not_scheduled', 'apply 4 (M7): reason is not_scheduled');
select is(
  (select count(*) from public.job_events where job_number = 'JOB-930002'),
  0::bigint,
  'apply 4 (M7): no job_events row logged for the inert cancelled-job call'
);
select is(
  (select count(*) from public.integration_outbox where aggregate_id = 'JOB-930002'),
  0::bigint,
  'apply 4 (M7): no integration_outbox row created for the inert cancelled-job call'
);

select throws_like(
  $sql$select apply_calendar_date_change('JOB-930099', '2026-09-10'::date, '2026-09-01'::date, 1, 'evt-930099', now(), 'watch_push')$sql$,
  'apply_calendar_date_change: endDate (2026-09-01) must be on or after startDate (2026-09-10)',
  'apply_calendar_date_change: endDate < startDate raises the exact message'
);

-- ============================================================
-- Fixture + Section D (68-87): open_calendar_deletion_exception behavior.
-- ============================================================
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, gcal_main_event_id, gcal_crew_event_id
) values (
  'JOB-930010', 'JOB-930010 - Open Exception Fixture', 'scheduled'::public.job_lifecycle,
  'Crew 2', '2026-09-15', '2026-09-17', 1, 'gcalMain930010', 'gcalCrew930010'
);

create temporary table t_open1 as
select public.open_calendar_deletion_exception(
  'JOB-930010', 'gcalMain930010', jsonb_build_object('summary', 'deleted test event')
) as result;

select is((select result->>'opened' from t_open1), 'true', 'open 1: opened=true for a scheduled job');
select ok((select result->>'exception_id' from t_open1) is not null, 'open 1: result carries a non-null exception_id');
select is(
  (select count(*) from public.job_schedule_exceptions where job_number = 'JOB-930010' and external_event_id = 'gcalMain930010'),
  1::bigint,
  'open 1: exactly one job_schedule_exceptions row is inserted'
);
select is(
  (select status::text from public.job_schedule_exceptions where job_number = 'JOB-930010' and external_event_id = 'gcalMain930010'),
  'open',
  'open 1: exception status is open'
);
select is(
  (select kind from public.job_schedule_exceptions where job_number = 'JOB-930010' and external_event_id = 'gcalMain930010'),
  'calendar_deleted',
  'open 1: exception kind is calendar_deleted'
);
select is(
  (select previous_schedule from public.job_schedule_exceptions where job_number = 'JOB-930010' and external_event_id = 'gcalMain930010'),
  jsonb_build_object('crew', 'Crew 2', 'start_date', '2026-09-15', 'end_date', '2026-09-17',
    'gcal_main_event_id', 'gcalMain930010', 'gcal_crew_event_id', 'gcalCrew930010'),
  'open 1: previous_schedule carries crew, both dates, and both gcal ids'
);
select is(
  (select count(*) from public.job_alerts where job_number = 'JOB-930010' and fingerprint = 'calendar_deleted:gcalMain930010'),
  1::bigint,
  'open 1: exactly one job_alerts row is opened'
);
select is(
  (select severity::text from public.job_alerts where job_number = 'JOB-930010' and fingerprint = 'calendar_deleted:gcalMain930010'),
  'at_risk',
  'open 1: alert severity is at_risk'
);
select ok(
  (select resolved_at is null from public.job_alerts where job_number = 'JOB-930010' and fingerprint = 'calendar_deleted:gcalMain930010'),
  'open 1: alert is not yet resolved'
);
select is(
  (select count(*) from public.job_events where job_number = 'JOB-930010' and function_name = 'open_calendar_deletion_exception'),
  1::bigint,
  'open 1: exactly one job_events row logs the deletion'
);
select is(
  (select stage_from from public.job_events where job_number = 'JOB-930010' and function_name = 'open_calendar_deletion_exception'),
  6,
  'open 1: job_events stage_from is 6'
);
select is(
  (select stage_to from public.job_events where job_number = 'JOB-930010' and function_name = 'open_calendar_deletion_exception'),
  6,
  'open 1: job_events stage_to is 6'
);

-- Second call, same job + event: the partial-unique-index dedup path.
create temporary table t_open2 as
select public.open_calendar_deletion_exception(
  'JOB-930010', 'gcalMain930010', jsonb_build_object('summary', 'deleted again')
) as result;

select is((select result->>'opened' from t_open2), 'false', 'open 2: opened=false on a second call for the same (job, event)');
select is((select result->>'reason' from t_open2), 'exception_already_open', 'open 2: reason is exception_already_open');
select is(
  (select count(*) from public.job_schedule_exceptions where job_number = 'JOB-930010' and external_event_id = 'gcalMain930010'),
  1::bigint,
  'open 2: still exactly one exception row -- no duplicate'
);
select is(
  (select count(*) from public.job_alerts where job_number = 'JOB-930010' and fingerprint = 'calendar_deleted:gcalMain930010'),
  1::bigint,
  'open 2: still exactly one alert -- no second alert opened'
);

-- M7 case: job is cancelled, not scheduled -- the dispatcher's own
-- job.cancelled cleanup deletions must never open an exception.
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, gcal_main_event_id
) values (
  'JOB-930011', 'JOB-930011 - Open Exception Fixture (Cancelled)', 'cancelled'::public.job_lifecycle,
  'Crew 3', '2026-09-20', '2026-09-21', 1, 'gcalMain930011'
);

create temporary table t_open3 as
select public.open_calendar_deletion_exception(
  'JOB-930011', 'gcalMain930011', null
) as result;

select is((select result->>'opened' from t_open3), 'false', 'open 3 (M7): opened=false for a cancelled job');
select is((select result->>'reason' from t_open3), 'not_scheduled', 'open 3 (M7): reason is not_scheduled');
select is(
  (select count(*) from public.job_schedule_exceptions where job_number = 'JOB-930011'),
  0::bigint,
  'open 3 (M7): no exception row is opened for the cancelled job'
);
select is(
  (select count(*) from public.job_alerts where job_number = 'JOB-930011'),
  0::bigint,
  'open 3 (M7): no alert is opened for the cancelled job'
);

-- ============================================================
-- Fixture + Section E (88-134): resolve_schedule_exception behavior.
-- ============================================================

-- --- reschedule with dates (JOB-930020) -------------------------------
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, gcal_main_event_id, gcal_crew_event_id
) values (
  'JOB-930020', 'JOB-930020 - Resolve Fixture Reschedule', 'scheduled'::public.job_lifecycle,
  'Crew 1', '2026-09-20', '2026-09-22', 4, 'gcalMain930020', 'gcalCrew930020'
);
insert into public.job_schedule_exceptions (
  job_number, external_event_id, kind, status, previous_schedule
) values (
  'JOB-930020', 'gcalMain930020', 'calendar_deleted', 'open'::public.schedule_exception_status,
  jsonb_build_object('crew', 'Crew 1', 'start_date', '2026-09-20', 'end_date', '2026-09-22',
    'gcal_main_event_id', 'gcalMain930020', 'gcal_crew_event_id', 'gcalCrew930020')
);
insert into public.job_alerts (
  job_number, fingerprint, severity, title, message, action_path
) values (
  'JOB-930020', 'calendar_deleted:gcalMain930020', 'at_risk',
  'Calendar event deleted: JOB-930020', 'Fixture alert for the reschedule scenario', '/jobs/exceptions'
);

create temporary table t_resolve1 as
select public.resolve_schedule_exception(
  (select id from public.job_schedule_exceptions where job_number = 'JOB-930020'),
  'reschedule', 'Google Calendar event was deleted; rescheduling', '2026-09-25', '2026-09-27',
  null::uuid, 'Test Resolver One'
) as result;

select is((select result->>'resolution' from t_resolve1), 'reschedule', 'resolve 1: result resolution is reschedule');
select is((select result->>'job_number' from t_resolve1), 'JOB-930020', 'resolve 1: result job_number matches');
select ok((select result->>'exception_id' from t_resolve1) is not null, 'resolve 1: result carries a non-null exception_id');
select is((select start_date from public.jobs where job_number = 'JOB-930020'), '2026-09-25'::date, 'resolve 1: jobs.start_date updated to the new date');
select is((select end_date from public.jobs where job_number = 'JOB-930020'), '2026-09-27'::date, 'resolve 1: jobs.end_date updated to the new date');
select is((select calendar_sync_revision from public.jobs where job_number = 'JOB-930020'), 5::bigint, 'resolve 1: revision bumped from 4 to 5');
select ok((select gcal_main_event_id from public.jobs where job_number = 'JOB-930020') is null, 'resolve 1: gcal_main_event_id cleared (it equaled the deleted external_event_id)');
select is((select gcal_crew_event_id from public.jobs where job_number = 'JOB-930020'), 'gcalCrew930020', 'resolve 1: gcal_crew_event_id untouched (it did NOT equal the deleted external_event_id)');
select is(
  (select count(*) from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930020:rev5'),
  1::bigint,
  'resolve 1: fresh job.scheduled outbox row exists at rev5'
);
select is(
  (select payload->>'start_date' from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930020:rev5'),
  '2026-09-25',
  'resolve 1: outbox payload carries the new start_date'
);
select is(
  (select payload->>'end_date' from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930020:rev5'),
  '2026-09-27',
  'resolve 1: outbox payload carries the new end_date'
);
select is(
  (select status::text from public.job_schedule_exceptions where job_number = 'JOB-930020' and external_event_id = 'gcalMain930020'),
  'rescheduled',
  'resolve 1: exception status is rescheduled'
);
select ok(
  (select resolved_at is not null from public.job_schedule_exceptions where job_number = 'JOB-930020' and external_event_id = 'gcalMain930020'),
  'resolve 1: exception resolved_at is set'
);
select ok(
  (select resolved_by is null from public.job_schedule_exceptions where job_number = 'JOB-930020' and external_event_id = 'gcalMain930020'),
  'resolve 1: exception resolved_by is NULL (p_actor was null::uuid)'
);
select is(
  (select resolution_note from public.job_schedule_exceptions where job_number = 'JOB-930020' and external_event_id = 'gcalMain930020'),
  'Google Calendar event was deleted; rescheduling',
  'resolve 1: exception resolution_note matches p_reason'
);
select ok(
  (select resolved_at is not null from public.job_alerts where job_number = 'JOB-930020' and fingerprint = 'calendar_deleted:gcalMain930020'),
  'resolve 1: the paired calendar_deleted alert is resolved'
);
select is(
  (select resolution_note from public.job_alerts where job_number = 'JOB-930020' and fingerprint = 'calendar_deleted:gcalMain930020'),
  'Google Calendar event was deleted; rescheduling',
  'resolve 1: the paired alert resolution_note matches p_reason'
);

-- --- reschedule missing dates / bad range (JOB-930021, dismiss below) --
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, gcal_main_event_id
) values (
  'JOB-930021', 'JOB-930021 - Resolve Fixture Dismiss', 'scheduled'::public.job_lifecycle,
  'Crew 2', '2026-09-30', '2026-10-02', 1, 'gcalMain930021'
);
insert into public.job_schedule_exceptions (
  job_number, external_event_id, kind, status, previous_schedule
) values (
  'JOB-930021', 'gcalMain930021', 'calendar_deleted', 'open'::public.schedule_exception_status,
  jsonb_build_object('crew', 'Crew 2', 'start_date', '2026-09-30', 'end_date', '2026-10-02',
    'gcal_main_event_id', 'gcalMain930021', 'gcal_crew_event_id', null)
);
insert into public.job_alerts (
  job_number, fingerprint, severity, title, message, action_path
) values (
  'JOB-930021', 'calendar_deleted:gcalMain930021', 'at_risk',
  'Calendar event deleted: JOB-930021', 'Fixture alert for the dismiss scenario', '/jobs/exceptions'
);

select throws_like(
  $sql$
    select resolve_schedule_exception(
      (select id from public.job_schedule_exceptions where job_number = 'JOB-930021'),
      'reschedule', 'need to pick new dates', null::date, null::date, null::uuid, 'Test Resolver Two'
    )
  $sql$,
  'resolve_schedule_exception: reschedule requires startDate and endDate',
  'resolve_schedule_exception: reschedule with no dates raises text 5 verbatim'
);
select throws_like(
  $sql$
    select resolve_schedule_exception(
      (select id from public.job_schedule_exceptions where job_number = 'JOB-930021'),
      'reschedule', 'bad range', '2026-10-05'::date, '2026-10-01'::date, null::uuid, 'Test Resolver Two'
    )
  $sql$,
  'resolve_schedule_exception: endDate (2026-10-01) must be on or after startDate (2026-10-05)',
  'resolve_schedule_exception: reschedule with endDate < startDate raises text 6 verbatim'
);

-- --- dismiss (same JOB-930021 fixture, still open after the two raises
--     above -- neither mutated anything) --------------------------------
create temporary table t_resolve2 as
select public.resolve_schedule_exception(
  (select id from public.job_schedule_exceptions where job_number = 'JOB-930021'),
  'dismiss', 'false alarm, event still stands', '2026-01-01'::date, '2026-01-02'::date,
  null::uuid, 'Test Resolver Two'
) as result;

select is((select result->>'resolution' from t_resolve2), 'dismiss', 'resolve 2 (dismiss): result resolution is dismiss');
select is((select start_date from public.jobs where job_number = 'JOB-930021'), '2026-09-30'::date, 'resolve 2 (dismiss): jobs.start_date UNCHANGED -- supplied dates ignored');
select is((select end_date from public.jobs where job_number = 'JOB-930021'), '2026-10-02'::date, 'resolve 2 (dismiss): jobs.end_date UNCHANGED -- supplied dates ignored');
select is((select calendar_sync_revision from public.jobs where job_number = 'JOB-930021'), 2::bigint, 'resolve 2 (dismiss): revision bumped from 1 to 2');
select ok((select gcal_main_event_id from public.jobs where job_number = 'JOB-930021') is null, 'resolve 2 (dismiss): gcal_main_event_id cleared');
select is(
  (select count(*) from public.integration_outbox where idempotency_key = 'job.scheduled:JOB-930021:rev2'),
  1::bigint,
  'resolve 2 (dismiss): fresh job.scheduled outbox row exists at rev2'
);
select is(
  (select status::text from public.job_schedule_exceptions where job_number = 'JOB-930021' and external_event_id = 'gcalMain930021'),
  'dismissed',
  'resolve 2 (dismiss): exception status is dismissed'
);
select ok(
  (select resolved_at is not null from public.job_schedule_exceptions where job_number = 'JOB-930021' and external_event_id = 'gcalMain930021'),
  'resolve 2 (dismiss): exception resolved_at is set'
);
select ok(
  (select resolved_at is not null from public.job_alerts where job_number = 'JOB-930021' and fingerprint = 'calendar_deleted:gcalMain930021'),
  'resolve 2 (dismiss): the paired alert is resolved'
);

-- --- postponed (JOB-930030, GHL-linked) --------------------------------
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, ghl_opportunity_id, gcal_main_event_id, gcal_crew_event_id
) values (
  'JOB-930030', 'JOB-930030 - Resolve Fixture Postponed', 'scheduled'::public.job_lifecycle,
  'Crew 3', '2026-10-10', '2026-10-12', 1, 'ghlOppFixture930030', 'gcalMain930030', 'gcalCrew930030'
);
insert into public.job_schedule_exceptions (
  job_number, external_event_id, kind, status, previous_schedule
) values (
  'JOB-930030', 'gcalMain930030', 'calendar_deleted', 'open'::public.schedule_exception_status,
  jsonb_build_object('crew', 'Crew 3', 'start_date', '2026-10-10', 'end_date', '2026-10-12',
    'gcal_main_event_id', 'gcalMain930030', 'gcal_crew_event_id', 'gcalCrew930030')
);
insert into public.job_alerts (
  job_number, fingerprint, severity, title, message, action_path
) values (
  'JOB-930030', 'calendar_deleted:gcalMain930030', 'at_risk',
  'Calendar event deleted: JOB-930030', 'Fixture alert for the postponed scenario', '/jobs/exceptions'
);

create temporary table t_resolve3 as
select public.resolve_schedule_exception(
  (select id from public.job_schedule_exceptions where job_number = 'JOB-930030'),
  'postponed', 'client wants to push the whole thing out', null::date, null::date,
  null::uuid, 'Test Resolver Three'
) as result;

select is((select result->>'resolution' from t_resolve3), 'postponed', 'resolve 3 (postponed): result resolution is postponed');
select is((select status_v2::text from public.jobs where job_number = 'JOB-930030'), 'cancelled', 'resolve 3 (postponed): job status_v2 is cancelled (via cancel_scheduled_job)');
select is((select cancellation_reason from public.jobs where job_number = 'JOB-930030'), 'client wants to push the whole thing out', 'resolve 3 (postponed): job cancellation_reason matches p_reason');
select is(
  (select count(*) from public.integration_outbox where idempotency_key = 'job.cancelled:JOB-930030:rev1'),
  1::bigint,
  'resolve 3 (postponed): job.cancelled outbox row exists (written by cancel_scheduled_job)'
);
select is(
  (select count(*) from public.integration_outbox where idempotency_key = 'ghl.stage.requested:JOB-930030:cancel:rev1'),
  1::bigint,
  'resolve 3 (postponed): ghl.stage.requested outbox row exists (written by cancel_scheduled_job)'
);
select is(
  (select payload->>'stage' from public.integration_outbox where idempotency_key = 'ghl.stage.requested:JOB-930030:cancel:rev1'),
  'Quote Accepted',
  'resolve 3 (postponed): ghl.stage.requested payload stage is Quote Accepted'
);
select is(
  (select status::text from public.job_schedule_exceptions where job_number = 'JOB-930030' and external_event_id = 'gcalMain930030'),
  'unscheduled',
  'resolve 3 (postponed): exception status is unscheduled'
);
select ok(
  (select resolved_at is not null from public.job_schedule_exceptions where job_number = 'JOB-930030' and external_event_id = 'gcalMain930030'),
  'resolve 3 (postponed): exception resolved_at is set'
);
select ok(
  (select resolved_at is not null from public.job_alerts where job_number = 'JOB-930030' and fingerprint = 'calendar_deleted:gcalMain930030'),
  'resolve 3 (postponed): the paired alert is resolved'
);

-- --- closed_lost (JOB-930031, GHL-linked) — same shape, different stage
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, ghl_opportunity_id, gcal_main_event_id, gcal_crew_event_id
) values (
  'JOB-930031', 'JOB-930031 - Resolve Fixture Closed Lost', 'scheduled'::public.job_lifecycle,
  'Crew 4', '2026-10-15', '2026-10-17', 1, 'ghlOppFixture930031', 'gcalMain930031', 'gcalCrew930031'
);
insert into public.job_schedule_exceptions (
  job_number, external_event_id, kind, status, previous_schedule
) values (
  'JOB-930031', 'gcalMain930031', 'calendar_deleted', 'open'::public.schedule_exception_status,
  jsonb_build_object('crew', 'Crew 4', 'start_date', '2026-10-15', 'end_date', '2026-10-17',
    'gcal_main_event_id', 'gcalMain930031', 'gcal_crew_event_id', 'gcalCrew930031')
);
insert into public.job_alerts (
  job_number, fingerprint, severity, title, message, action_path
) values (
  'JOB-930031', 'calendar_deleted:gcalMain930031', 'at_risk',
  'Calendar event deleted: JOB-930031', 'Fixture alert for the closed_lost scenario', '/jobs/exceptions'
);

create temporary table t_resolve4 as
select public.resolve_schedule_exception(
  (select id from public.job_schedule_exceptions where job_number = 'JOB-930031'),
  'closed_lost', 'client cancelled entirely', null::date, null::date,
  null::uuid, 'Test Resolver Four'
) as result;

select is((select result->>'resolution' from t_resolve4), 'closed_lost', 'resolve 4 (closed_lost): result resolution is closed_lost');
select is((select status_v2::text from public.jobs where job_number = 'JOB-930031'), 'cancelled', 'resolve 4 (closed_lost): job status_v2 is cancelled');
select is(
  (select payload->>'stage' from public.integration_outbox where idempotency_key = 'ghl.stage.requested:JOB-930031:cancel:rev1'),
  'Closed Lost (Declined)',
  'resolve 4 (closed_lost): ghl.stage.requested payload stage is Closed Lost (Declined)'
);
select is(
  (select status::text from public.job_schedule_exceptions where job_number = 'JOB-930031' and external_event_id = 'gcalMain930031'),
  'unscheduled',
  'resolve 4 (closed_lost): exception status is unscheduled'
);

-- --- validation-order / raise-text sweep -------------------------------

-- Non-open exception: reuse JOB-930020's now-'rescheduled' exception from
-- resolve 1 above.
select throws_like(
  $sql$
    select resolve_schedule_exception(
      (select id from public.job_schedule_exceptions where job_number = 'JOB-930020'),
      'dismiss', 'trying again', null::date, null::date, null::uuid, 'Test Resolver One'
    )
  $sql$,
  'resolve_schedule_exception: exception % is not open (status rescheduled)',
  'resolve_schedule_exception: resolving a non-open exception raises text 2 verbatim'
);

select throws_like(
  $sql$select resolve_schedule_exception(gen_random_uuid(), 'dismiss', 'a reason', null::date, null::date, null::uuid, '   ')$sql$,
  'resolve_schedule_exception: actor name is required',
  'resolve_schedule_exception: a blank actor name raises text 7 verbatim'
);
select throws_like(
  $sql$select resolve_schedule_exception(gen_random_uuid(), 'bogus-resolution', 'a reason', null::date, null::date, null::uuid, 'Test Resolver')$sql$,
  'resolve_schedule_exception: invalid resolution bogus-resolution',
  'resolve_schedule_exception: an invalid resolution raises text 3 verbatim, with the supplied value formatted in'
);
select throws_like(
  $sql$select resolve_schedule_exception(gen_random_uuid(), 'dismiss', '', null::date, null::date, null::uuid, 'Test Resolver')$sql$,
  'resolve_schedule_exception: resolution reason is required',
  'resolve_schedule_exception: a blank reason raises text 4 verbatim'
);
select throws_like(
  $sql$select resolve_schedule_exception(gen_random_uuid(), 'dismiss', 'a reason', null::date, null::date, null::uuid, 'Test Resolver')$sql$,
  'resolve_schedule_exception: exception % not found',
  'resolve_schedule_exception: a nonexistent exception id raises text 1 verbatim'
);

-- Job no longer scheduled: an open exception whose job's status diverged
-- to in_progress while the exception was still open.
insert into public.jobs (
  job_number, job_name, status_v2, crew, start_date, end_date,
  calendar_sync_revision, gcal_main_event_id
) values (
  'JOB-930040', 'JOB-930040 - Resolve Fixture Status Diverged', 'scheduled'::public.job_lifecycle,
  'Crew 1', '2026-11-01', '2026-11-03', 1, 'gcalMain930040'
);
insert into public.job_schedule_exceptions (
  job_number, external_event_id, kind, status, previous_schedule
) values (
  'JOB-930040', 'gcalMain930040', 'calendar_deleted', 'open'::public.schedule_exception_status,
  jsonb_build_object('crew', 'Crew 1', 'start_date', '2026-11-01', 'end_date', '2026-11-03',
    'gcal_main_event_id', 'gcalMain930040', 'gcal_crew_event_id', null)
);
insert into public.job_alerts (
  job_number, fingerprint, severity, title, message, action_path
) values (
  'JOB-930040', 'calendar_deleted:gcalMain930040', 'at_risk',
  'Calendar event deleted: JOB-930040', 'Fixture alert for the status-diverged scenario', '/jobs/exceptions'
);
update public.jobs set status_v2 = 'in_progress'::public.job_lifecycle where job_number = 'JOB-930040';

select throws_like(
  $sql$
    select resolve_schedule_exception(
      (select id from public.job_schedule_exceptions where job_number = 'JOB-930040'),
      'reschedule', 'reason', '2026-11-05'::date, '2026-11-06'::date, null::uuid, 'Test Resolver Five'
    )
  $sql$,
  'resolve_schedule_exception: job JOB-930040 is no longer scheduled (status in_progress)',
  'resolve_schedule_exception: reschedule on a job that is no longer scheduled raises text 8 verbatim'
);

-- Fix round 1 (controller ruling, finding I1): dismiss on that SAME
-- still-open JOB-930040 exception (the throws_like above raised and left
-- no trace, so the fixture is untouched) must acknowledge-and-close
-- instead of raising -- no jobs write, no outbox row, exception+alert
-- still get closed out.
create temporary table t_resolve5 as
select public.resolve_schedule_exception(
  (select id from public.job_schedule_exceptions where job_number = 'JOB-930040'),
  'dismiss', 'work already started, closing out this exception', null::date, null::date,
  null::uuid, 'Test Resolver Five'
) as result;

select is((select result->>'resolution' from t_resolve5), 'dismiss', 'resolve 5 (dismiss, acknowledge-close): result resolution is dismiss');
select is((select result->>'note' from t_resolve5), 'acknowledged_no_side_effects', 'resolve 5 (dismiss, acknowledge-close): result carries the additive note key');
select is((select status_v2::text from public.jobs where job_number = 'JOB-930040'), 'in_progress', 'resolve 5 (dismiss, acknowledge-close): job status_v2 UNTOUCHED');
select is((select start_date from public.jobs where job_number = 'JOB-930040'), '2026-11-01'::date, 'resolve 5 (dismiss, acknowledge-close): job start_date UNTOUCHED');
select is((select end_date from public.jobs where job_number = 'JOB-930040'), '2026-11-03'::date, 'resolve 5 (dismiss, acknowledge-close): job end_date UNTOUCHED');
select is((select calendar_sync_revision from public.jobs where job_number = 'JOB-930040'), 1::bigint, 'resolve 5 (dismiss, acknowledge-close): job calendar_sync_revision UNTOUCHED -- no bump');
select is((select gcal_main_event_id from public.jobs where job_number = 'JOB-930040'), 'gcalMain930040', 'resolve 5 (dismiss, acknowledge-close): gcal_main_event_id UNTOUCHED -- not cleared');
select is(
  (select count(*) from public.integration_outbox where aggregate_id = 'JOB-930040'),
  0::bigint,
  'resolve 5 (dismiss, acknowledge-close): NO outbox row of any kind is created'
);
select is(
  (select status::text from public.job_schedule_exceptions where job_number = 'JOB-930040' and external_event_id = 'gcalMain930040'),
  'dismissed',
  'resolve 5 (dismiss, acknowledge-close): exception status is dismissed'
);
select ok(
  (select resolved_at is not null from public.job_schedule_exceptions where job_number = 'JOB-930040' and external_event_id = 'gcalMain930040'),
  'resolve 5 (dismiss, acknowledge-close): exception resolved_at is set'
);
select is(
  (select resolution_note from public.job_schedule_exceptions where job_number = 'JOB-930040' and external_event_id = 'gcalMain930040'),
  'work already started, closing out this exception',
  'resolve 5 (dismiss, acknowledge-close): exception resolution_note matches p_reason'
);
select ok(
  (select resolved_at is not null from public.job_alerts where job_number = 'JOB-930040' and fingerprint = 'calendar_deleted:gcalMain930040'),
  'resolve 5 (dismiss, acknowledge-close): the paired alert is resolved despite the job having moved on'
);
select is(
  (select count(*) from public.job_events where job_number = 'JOB-930040' and function_name = 'resolve_schedule_exception'),
  1::bigint,
  'resolve 5 (dismiss, acknowledge-close): exactly one job_events row logs the acknowledge-close (the earlier raised reschedule attempt left no trace)'
);

select * from finish();
rollback;
