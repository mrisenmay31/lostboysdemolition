-- Profitability v2 Phase 1, Task 5A (Session 4, SQL lane) — outbox claim
-- RPC. First half of the outbound integration dispatcher: an
-- `integration-dispatcher` edge function (sibling supabase/functions/ lane,
-- not touched by this migration) will call this RPC on a cron tick to pull
-- a batch of `integration_outbox` rows, mark them claimed, and hand them
-- off for delivery (Slack / GHL / Calendar). `integration_outbox` itself and
-- `integration_event_status` (`pending|processing|succeeded|failed|
-- dead_letter`) were created by
-- 20260819151000_profitability_core_schema.sql — this migration adds no new
-- table, enum, or column, only the claim function.
--
-- PLAIN plpgsql, NOT SECURITY DEFINER — same BL-7 reasoning documented at
-- length in 20260819170000_schedule_estimate_rpc.sql's header (and, before
-- that, mark_job_reconciliation_required's header in the core-schema
-- migration): every RPC in this schema that is called by a service-role
-- caller is plain INVOKER, never DEFINER, so that if `authenticated`
-- EXECUTE is ever granted to it in the future (v2 Task 8), it runs with the
-- CALLER's own privileges and RLS applies normally, rather than silently
-- inheriting the owner's (service-role-equivalent) bypass. `search_path =
-- public, pg_temp` is pinned regardless (phase-1 plan deviation 3).
--
-- Crash-recovery ruling (orchestrator ruling R2, per the task brief): a
-- worker that claims a batch and then dies mid-batch (function timeout,
-- deploy restart, uncaught exception) must not strand those rows in
-- 'processing' forever — nothing else would ever pick them back up. So the
-- claimable set is the UNION of two arms:
--   1. status IN ('pending','failed') AND available_at <= now() — the
--      ordinary "ready to (re)try" set. Both pending and failed are
--      claimable identically; a caller distinguishes a fresh attempt from a
--      retry only via `attempts`, which this function always increments.
--   2. status = 'processing' AND locked_at < now() - interval '15 minutes'
--      — a claim considered abandoned. 15 minutes is well beyond any single
--      dispatcher invocation's realistic run time (the sibling cron
--      migration's own net.http_post carries a 55-second
--      timeout_milliseconds), so a row still 'processing' past that window
--      can only mean the worker that claimed it never got to update it
--      again — never a live, still-working claim.
-- Claiming a stale-processing row does NOT reset `attempts` to account for
-- the abandoned attempt separately; the increment below counts THIS claim
-- as one attempt, same as any other. `succeeded` and `dead_letter` rows are
-- terminal and are never claimable under either arm.
--
-- FOR UPDATE SKIP LOCKED ordering: the `claimable` CTE below carries a
-- FOR UPDATE clause, which PostgreSQL always materializes (a WITH query
-- containing FOR UPDATE/FOR SHARE is never inlined into the parent query,
-- regardless of Postgres version) — so it is evaluated exactly once,
-- locking exactly the LIMIT rows chosen by `available_at asc, created_at
-- asc`, before the UPDATE CTE ever runs against that same locked row set.
-- SKIP LOCKED means a second concurrent dispatcher invocation (e.g. two
-- overlapping cron fires under load) simply claims the NEXT-oldest
-- available rows instead of blocking on rows the first invocation already
-- has locked — the two invocations partition the claimable set rather than
-- serializing on it.
--
-- Claim-order preservation: `available_at` and `created_at` are never
-- written by the UPDATE below, so re-applying the identical `ORDER BY
-- available_at asc, created_at asc` on the final SELECT (over the `updated`
-- CTE) reproduces exactly the order the `claimable` CTE selected — this is
-- how "return the updated rows, preserving claim order" is satisfied
-- without needing a synthetic row-number column.
create or replace function public.claim_integration_events(p_limit integer)
returns setof public.integration_outbox
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'claim limit must be between 1 and 100';
  end if;

  return query
  with claimable as (
    select o.id, o.available_at, o.created_at
      from public.integration_outbox o
     where (o.status in ('pending', 'failed') and o.available_at <= now())
        or (o.status = 'processing' and o.locked_at < now() - interval '15 minutes')
     order by o.available_at asc, o.created_at asc
     limit p_limit
     for update skip locked
  ),
  updated as (
    update public.integration_outbox o
       set status = 'processing',
           locked_at = now(),
           attempts = o.attempts + 1
      from claimable c
     where o.id = c.id
    returning o.*
  )
  select u.*
    from updated u
   order by u.available_at asc, u.created_at asc;
end;
$$;

revoke all on function public.claim_integration_events(integer)
  from public, anon, authenticated;
grant execute on function public.claim_integration_events(integer)
  to service_role;
