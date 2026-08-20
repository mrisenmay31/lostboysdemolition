-- Profitability v2 Phase 1, Task 5A (Session 4, SQL lane) — scheduled-job
-- cancellation RPC.
--
-- v2 decision ledger (verbatim, task brief): "A scheduled cancellation
-- preserves the job and all facts. Postponed/reschedulable work returns GHL
-- to `Quote Accepted`; definitively lost work moves to `Closed Lost
-- (Declined)`." This function is the ONLY writer of that transition for a
-- `scheduled` job — it never touches `job_budget_versions`, any `estimates`
-- row, or `calendar_sync_revision`; cancellation is a status change plus an
-- audit trail, not a rewrite of the job's commercial facts. A
-- postponed cancellation is reversible by the EXISTING `schedule_estimate`
-- reactivation branch (20260819170000_schedule_estimate_rpc.sql), which
-- bumps `calendar_sync_revision` on reschedule — so a second
-- cancel_scheduled_job call after such a reschedule computes fresh
-- idempotency keys from the bumped revision automatically; the rev-scoping
-- below is deliberate, not incidental.
--
-- ⚠️ BYTE-IDENTITY CONSTRAINT (task brief, cross-lane API): the web lane's
-- error classifier pattern-matches on these five raise texts verbatim.
-- Their wording MUST NOT CHANGE, and none of them may contain the
-- substrings "already", "accept", "supersed", "financial", or "not
-- presented" (those collide with classifyScheduleError's needles for a
-- DIFFERENT RPC's errors):
--   1. 'actor name is required'
--   2. 'invalid resolution: %'                          (p_resolution)
--   3. 'cancellation reason is required'
--   4. 'no job found for %'                              (p_job_number)
--   5. 'job % cannot be cancelled from status %'         (job_number, status_v2::text)
-- Validation order matches this list exactly: actor name, then resolution,
-- then reason, then the job lookup, then the status check — each guard
-- fires before any database read that isn't already required by an earlier
-- guard, so a caller gets the cheapest possible failure for a given bad
-- input.
--
-- House patterns mirrored, verbatim (see schedule_estimate_rpc's header for
-- the fuller versions of these):
--   - PLAIN plpgsql, NOT SECURITY DEFINER. Every RPC in this schema reached
--     by a service-role caller is INVOKER, so a future `authenticated`
--     grant (v2 Task 8) runs with the caller's own privileges and RLS
--     applies normally, instead of silently inheriting a DEFINER's
--     service-role-equivalent bypass. See schedule_estimate's header for the
--     fuller argument (BL-7 / workforce_profiles).
--   - `search_path = public, pg_temp` pinned (phase-1 plan deviation 3);
--     EXECUTE revoked from public/anon/authenticated, granted to
--     service_role only.
--   - `select ... for update` before the status check, so two concurrent
--     cancel_scheduled_job calls against the SAME job serialize: the loser
--     blocks until the winner's transaction commits, then re-reads the now-
--     'cancelled' row and raises the wrong-status text instead of racing
--     into a double cancellation.
--   - job_events insert shape (job_number, stage_from, stage_to,
--     function_name, trigger_source, ghl_opportunity_id, action_summary,
--     status, payload_in) matches schedule_estimate's and
--     mark_job_reconciliation_required's writers.
--   - integration_outbox insert shape (event_type, aggregate_type,
--     aggregate_id, idempotency_key, payload) with
--     `on conflict (idempotency_key) do nothing`, matching every other
--     outbox writer in this schema.
--
-- Scope note (task brief, "5A scope"): this RPC only cancels a job that is
-- currently `scheduled` — it does not handle in_progress/completed jobs or
-- any other lifecycle transition. A job in any other status_v2 hits the
-- wrong-status raise, by design.
create or replace function public.cancel_scheduled_job(
  p_job_number text,
  p_resolution text,
  p_reason text,
  p_actor uuid,
  p_actor_name text
) returns public.jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job          public.jobs;
  v_actor_name   text;
  v_reason       text;
  v_stage_to     integer;
  v_ghl_stage    text;
begin
  -- ── Required-argument guards, in the exact order the byte-identity
  --    constraint above documents. ─────────────────────────────────────────
  v_actor_name := nullif(btrim(coalesce(p_actor_name, '')), '');
  if v_actor_name is null then
    raise exception 'actor name is required';
  end if;

  if p_resolution is null or p_resolution not in ('postponed', 'closed_lost') then
    raise exception 'invalid resolution: %', p_resolution;
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'cancellation reason is required';
  end if;

  -- ── Lock the job row. Two concurrent calls against the same job number
  --    serialize here; the loser re-reads the (now already-cancelled) row
  --    below and hits the wrong-status raise rather than racing.
  select * into v_job
    from public.jobs
   where job_number = p_job_number
   for update;

  if not found then
    raise exception 'no job found for %', p_job_number;
  end if;

  -- 5A scope: only a scheduled-not-started job is cancellable here.
  if v_job.status_v2 is distinct from 'scheduled'::public.job_lifecycle then
    raise exception 'job % cannot be cancelled from status %', v_job.job_number, v_job.status_v2::text;
  end if;

  -- ── Status change only. Cancellation preserves all facts: no touch to
  --    calendar_sync_revision, job_budget_versions, or any estimates row.
  update public.jobs
     set status_v2 = 'cancelled'::public.job_lifecycle,
         cancelled_at = now(),
         cancellation_reason = v_reason,
         updated_at = now()
   where job_number = v_job.job_number
   returning * into v_job;

  v_stage_to := case p_resolution when 'postponed' then 5 else 12 end;

  insert into public.job_events (
    job_number, stage_from, stage_to, function_name, trigger_source,
    ghl_opportunity_id, action_summary, status, payload_in
  ) values (
    v_job.job_number, 6, v_stage_to, 'cancel_scheduled_job', 'app_schedule',
    v_job.ghl_opportunity_id,
    format('Job %s cancelled (%s) by %s: %s', v_job.job_number, p_resolution, v_actor_name, v_reason),
    'success',
    jsonb_build_object(
      'job_number', p_job_number,
      'resolution', p_resolution,
      'reason', v_reason,
      'actor', p_actor,
      'actor_name', v_actor_name
    )
  );

  -- job.cancelled — always enqueued, revision-scoped so a later
  -- reschedule-then-cancel cycle (schedule_estimate's reactivation branch
  -- bumps calendar_sync_revision) gets a fresh key rather than colliding
  -- with this one.
  insert into public.integration_outbox (
    event_type, aggregate_type, aggregate_id, idempotency_key, payload
  ) values (
    'job.cancelled', 'job', v_job.job_number,
    'job.cancelled:' || v_job.job_number || ':rev' || v_job.calendar_sync_revision::text,
    jsonb_build_object(
      'job_number', v_job.job_number,
      'resolution', p_resolution,
      'gcal_main_event_id', v_job.gcal_main_event_id,
      'gcal_crew_event_id', v_job.gcal_crew_event_id,
      'crew', v_job.crew
    )
  )
  on conflict (idempotency_key) do nothing;

  -- ghl.stage.requested — only when a GHL opportunity is actually linked.
  -- An unlinked job has nothing for the dispatcher to update in GHL;
  -- enqueueing anyway would create an outbox row that can never succeed.
  if v_job.ghl_opportunity_id is not null then
    v_ghl_stage := case p_resolution
      when 'postponed' then 'Quote Accepted'
      else 'Closed Lost (Declined)'
    end;

    insert into public.integration_outbox (
      event_type, aggregate_type, aggregate_id, idempotency_key, payload
    ) values (
      'ghl.stage.requested', 'job', v_job.job_number,
      'ghl.stage.requested:' || v_job.job_number || ':cancel:rev' || v_job.calendar_sync_revision::text,
      jsonb_build_object(
        'stage', v_ghl_stage,
        'job_number', v_job.job_number,
        'ghl_opportunity_id', v_job.ghl_opportunity_id
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return v_job;
end;
$$;

revoke all on function public.cancel_scheduled_job(text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_scheduled_job(text, text, text, uuid, text)
  to service_role;
