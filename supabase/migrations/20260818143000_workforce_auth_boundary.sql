-- BL-7 fix + v2 Task 0B foundation: workforce_profiles, the isolated auth
-- boundary for foremen + Dane's financial routes. Closes the open item
-- 20260817130000_security_revoke_legacy_definers.sql ("Fix 1") deliberately
-- left unresolved: handle_new_auth_user() has been a silent no-op since the
-- table was created. That migration explains why in detail -- summary here
-- for this file's own record: GoTrue connects as `supabase_auth_admin`,
-- whose search_path is `auth` (checked via pg_db_role_setting), and the old
-- handle_new_auth_user() body was an UNQUALIFIED
-- `insert into users (id, email) ... on conflict (id) do nothing`. With
-- search_path=auth in effect at fire time, that unqualified `users` resolved
-- to `auth.users` -- the row that had just landed -- so the insert collided
-- with it on the PK and `on conflict do nothing` swallowed the conflict
-- every time. Live proof at the time "Fix 1" was written: auth.users had 1
-- row, public.users had 0. "Fix 1" declined to just pin search_path=public
-- on the old body, because doing so would have flipped the no-op into a
-- real insert into the legacy public.users table (default role='employee'),
-- silently activating the 7 live RLS policies that key off get_my_role() /
-- get_my_crew_id() for whichever account happened to sign up next -- a real
-- behavior change buried in what that migration's stated purpose was
-- config/ACL hardening only. It left the decision open for an owner.
--
-- Decisions (Matt, 2026-08-18): v2 Task 0B ratified per
-- docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md
-- (BL-7 resolved by an isolated `workforce_profiles` boundary, not by
-- reactivating the legacy `users`/`crews`/`time_entries` schema). Applying
-- this migration to production was approved the same day. Eight deviations
-- from the v2 spec's literal Task 0B text -- the owner-lookup helper to
-- break RLS self-reference recursion, the ACL/grant statements, the
-- explicit table-privilege revoke-then-grant, the backfill insert, and
-- related detail -- were reviewed and approved via
-- docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md before this
-- file was written; the SQL below matches that approved design, not a
-- fresh interpretation of the spec.
--
-- Blast radius: one new, fully isolated table (workforce_profiles) plus one
-- new SECURITY DEFINER helper (is_workforce_owner()) and two new policies
-- (the repo's first `create policy` statements). handle_new_auth_user() is
-- replaced (CREATE OR REPLACE, preserving its live ACL shape and its
-- attachment to on_auth_user_created) so it now targets
-- workforce_profiles, not legacy `users` -- this is the one behavioral
-- change "Fix 1" deferred, now made deliberately with the new isolated
-- target instead of the legacy table. Zero columns, rows, policies, or
-- grants on the legacy `users`, `crews`, or `time_entries` tables are
-- touched -- their 12 live RLS policies (users 3, crews 2, time_entries 7)
-- are untouched. Seven of the twelve depend on get_my_role()/
-- get_my_crew_id() -- those are the ones the 2026-08-17 "Fix 3" counted;
-- the remaining five are self-service policies that call neither, and were
-- undercounted before 2026-08-18. get_my_role()/get_my_crew_id() are NOT
-- re-granted to authenticated by this migration; that re-grant question
-- stays open, tracked under BL-7, for whoever builds Task 8's foreman auth
-- to decide with full view of this table's shape. Exactly one existing
-- auth.users row is backfilled a pending/inactive profile. No application
-- code reads workforce_profiles yet -- Task 8 is the first consumer.
-- Section 6 replaces the trigger in place with a single CREATE OR REPLACE
-- TRIGGER statement inside this migration's transaction -- see Section 6's
-- own comment for why (fix round 1: a plain drop+create there would 42501
-- on production).

-- 1. Table ------------------------------------------------------------
create table if not exists public.workforce_profiles (
  auth_user_id     uuid primary key references auth.users (id) on delete cascade,
  display_name     text not null,
  role             text not null default 'pending'
                     check (role in ('pending','owner','foreman')),
  crew_external_id text,
  active           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column public.workforce_profiles.crew_external_id is
  'Opaque external crew key. NOT a FK to legacy public.crews -- BL-7 forbids '
  'coupling to the legacy tables. Set by the Task 8 owner-activation action; '
  'null until assigned.';

alter table public.workforce_profiles enable row level security;

-- 2. Table ACL. Supabase default privileges PRE-GRANT ALL to authenticated
-- (not just anon/service_role) on new public tables -- authenticated MUST
-- be in this revoke list, or the S/I/U/D grant below only ADDS to an
-- already-full ACL instead of DEFINING it. That matters concretely: RLS
-- does NOT gate TRUNCATE, so without this revoke any authenticated user
-- could truncate workforce_profiles outright, policies notwithstanding
-- (fix round 2, found by the production dry-run: revoke without
-- `authenticated` here left REFERENCES/TRIGGER/TRUNCATE still granted).
-- anon has no policy here either, so remove its grants entirely
-- (permission denied, not silent 0 rows).
revoke all on table public.workforce_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.workforce_profiles to authenticated;
grant all on table public.workforce_profiles to service_role;

-- 3. Owner-lookup helper. A policy on workforce_profiles cannot subquery
-- workforce_profiles (42P17 infinite recursion). SECURITY DEFINER owned by
-- postgres (table owner bypasses RLS; no FORCE on this table) breaks the
-- cycle. search_path pinned, everything schema-qualified, pg_temp last --
-- the full anti-BL-7 treatment.
create or replace function public.is_workforce_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select wp.role = 'owner' and wp.active
       from public.workforce_profiles wp
      where wp.auth_user_id = auth.uid()),
    false
  );
$$;

-- authenticated MUST hold EXECUTE: RLS quals evaluate as the querying role
-- (the 20260817130000 "Fix 3" lesson). anon gets nothing.
revoke all on function public.is_workforce_owner() from public, anon, authenticated;
grant execute on function public.is_workforce_owner() to authenticated, service_role;

-- 4. Policies (the repo's first create policy statements -- deliberate:
-- Task 8 foreman auth consumes exactly these) -------------------------
drop policy if exists workforce_self_read on public.workforce_profiles;
create policy workforce_self_read on public.workforce_profiles
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists workforce_owner_all on public.workforce_profiles;
create policy workforce_owner_all on public.workforce_profiles
  for all to authenticated
  using ((select public.is_workforce_owner()))
  with check ((select public.is_workforce_owner()));
-- ((select ...)) wrappers -> initplan, evaluated once per statement.

-- 5. Replace handle_new_auth_user() (body per the v2 spec, verbatim).
-- CREATE OR REPLACE keeps the live ACL and trigger attachment on prod;
-- sets proconfig (the search_path pin BL-7 deliberately deferred).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Total expression -- NULL email (phone/anon auth) or blank metadata can
  -- never abort a signup (fix round 1: the prior 2-arg coalesce could
  -- yield NULL into a NOT NULL column and raise inside an AFTER INSERT
  -- trigger, aborting the real auth.users insert).
  insert into public.workforce_profiles (auth_user_id, display_name, role, active)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'user-' || left(new.id::text, 8)
    ),
    'pending',
    false
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

-- Load-bearing on a fresh branch (fresh CREATE grants PUBLIC execute);
-- belt-and-braces on prod (live ACL is already exactly this).
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to supabase_auth_admin, service_role;

-- 6. Trigger: fix round 1 -- a plain drop-then-create against auth.users
-- FAILS on production with 42501 (dropping a trigger there requires table
-- OWNERSHIP; auth.users is owned by supabase_auth_admin, and postgres is
-- not a member and not superuser -- it holds only the grantable TRIGGER
-- privilege). A faithful branch masked this because branch replay can
-- reproduce the DDL but not the exact ownership graph. CREATE OR REPLACE
-- TRIGGER (PG 14+) needs only the TRIGGER privilege, which postgres does
-- hold on auth.users, and replaces the definition in place -- no
-- trigger-less instant, identical end-state on prod (trigger already
-- exists) and on any fresh branch (trigger absent -> created). Accuracy
-- note: the replace still takes a brief ACCESS EXCLUSIVE lock on
-- auth.users for the statement's duration -- it blocks concurrent logins
-- briefly, it does not fail them.
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 7. Backfill: the 1 existing auth.users row predates the fixed trigger and
-- would otherwise never get a profile. Inserted as pending/inactive; the
-- first-owner promotion is a service_role action (bypasses RLS), which
-- bootstraps workforce_owner_all.
-- Total expression -- NULL email (phone/anon auth) or blank metadata can
-- never abort a signup (same fix as Section 5).
insert into public.workforce_profiles (auth_user_id, display_name, role, active)
select u.id,
       coalesce(
         nullif(u.raw_user_meta_data ->> 'display_name', ''),
         nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
         'user-' || left(u.id::text, 8)
       ),
       'pending', false
from auth.users u
on conflict (auth_user_id) do nothing;
