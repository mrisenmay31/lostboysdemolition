-- BL-7 assertions (v2 Task 0B). Assertions 1-7 are the v2 spec's original
-- seven, verbatim. 4, 5, 6 pass PRE-migration on a faithful live clone:
-- they are regression pins (no re-grant of the legacy definers; trigger
-- not lost), not red/green targets. 8-19 are the red-phase teeth: they
-- fail until the migration lands, and 8-9 specifically prove the
-- handle_new_auth_user() body/search_path actually changed -- which 1-7
-- alone cannot detect. 19 assertions total (fix round 1, 2026-08-18):
-- assertions 18-19 pin the deviation-8 ACL posture (explicit table grants +
-- anon revoke on workforce_profiles).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;
select plan(19);

-- 1-7: spec assertions, verbatim (description args added, fix round 1:
-- without them Postgres resolves the wrong pgTAP overload for has_table/
-- has_column/policy_cmd_is and these could never pass)
select has_table('public', 'workforce_profiles', 'workforce_profiles table exists');
select has_column('public', 'workforce_profiles', 'auth_user_id', 'auth_user_id column exists');
select has_column('public', 'workforce_profiles', 'role', 'role column exists');
select function_privs_are(
  'public', 'get_my_role', array[]::text[], 'authenticated', array[]::text[]
);
select function_privs_are(
  'public', 'get_my_crew_id', array[]::text[], 'authenticated', array[]::text[]
);
-- fix round 1: pin table and function, not just trigger name
select isnt_empty(
  $$select 1 from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal and tgrelid = 'auth.users'::regclass and tgfoid = 'public.handle_new_auth_user()'::regprocedure$$
);
select policies_are('public', 'workforce_profiles',
  array['workforce_self_read','workforce_owner_all']);

-- 8-9: the actual BL-7 fix (red pre-migration even on production)
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_auth_user'),
  'handle_new_auth_user() has search_path pinned to public, pg_temp'
);
select ok(
  (select p.prosrc like '%workforce_profiles%' and p.prosrc not like '%insert into users %'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_auth_user'),
  'handle_new_auth_user() inserts into workforce_profiles, not legacy users'
);

-- 10: RLS actually enabled
select ok(
  (select c.relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'workforce_profiles'),
  'RLS is enabled on workforce_profiles'
);

-- 11-15: the recursion-breaking helper's full contract
select has_function('public', 'is_workforce_owner', array[]::name[]);
select is_definer('public', 'is_workforce_owner', array[]::name[]);
select function_privs_are(
  'public', 'is_workforce_owner', array[]::text[], 'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'is_workforce_owner', array[]::text[], 'anon', array[]::text[]
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_workforce_owner'),
  'is_workforce_owner() has search_path pinned to public, pg_temp'
);

-- 16-17: policy commands, not just names (description args added, fix round 1)
select policy_cmd_is('public', 'workforce_profiles', 'workforce_self_read', 'SELECT', 'workforce_self_read is SELECT-only');
select policy_cmd_is('public', 'workforce_profiles', 'workforce_owner_all', 'ALL', 'workforce_owner_all covers ALL commands');

-- 18-19: deviation-8 table ACL posture (fix round 1)
select table_privs_are('public', 'workforce_profiles', 'anon', array[]::name[], 'anon has no table privileges on workforce_profiles');
select table_privs_are('public', 'workforce_profiles', 'authenticated', array['SELECT','INSERT','UPDATE','DELETE']::name[], 'authenticated holds exactly S/I/U/D on workforce_profiles');

select * from finish();
rollback;
