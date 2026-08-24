-- Profitability v2 Phase 1, Task 5B Step 2 (Lane S) — inbound Google
-- Calendar sync RPCs. Companion to
-- 20260824150000_calendar_watch_registry.sql (schema this file writes
-- against) and 20260824152000_schedule_calendar_maintenance.sql (the cron
-- job that drives the edge function calling these RPCs).
--
-- Three RPCs, all plain plpgsql (NOT SECURITY DEFINER) — see
-- 20260819170000_schedule_estimate_rpc.sql's header for the fuller
-- argument (BL-7 / workforce_profiles): every RPC in this schema reached
-- by a service-role caller is INVOKER, so a future `authenticated` grant
-- (v2 Task 8) runs with the caller's own privileges and RLS applies
-- normally, instead of silently inheriting a DEFINER's service-role-
-- equivalent bypass. `search_path = public, pg_temp` pinned on all three
-- (phase-1 plan deviation 3); EXECUTE revoked from public/anon/
-- authenticated, granted to service_role only.
--
-- ⚠️ BYTE-IDENTITY CONSTRAINT (task brief, cross-lane API): the web lane's
-- error classifier and the function lane's benign-skip detection
-- pattern-match on these EIGHT raise texts, all from
-- resolve_schedule_exception, verbatim. Their wording MUST NOT CHANGE, and
-- none of them may contain the substrings "already", "accept", "supersed",
-- "financial", "not presented", "no job found", or "cannot be cancelled"
-- (those collide with sibling classifiers matching a DIFFERENT RPC's
-- errors — cancel_scheduled_job's and schedule_estimate's):
--   1. 'resolve_schedule_exception: exception % not found'
--   2. 'resolve_schedule_exception: exception % is not open (status %)'
--   3. 'resolve_schedule_exception: invalid resolution %'
--   4. 'resolve_schedule_exception: resolution reason is required'
--   5. 'resolve_schedule_exception: reschedule requires startDate and endDate'
--   6. 'resolve_schedule_exception: endDate (%) must be on or after startDate (%)'
--   7. 'resolve_schedule_exception: actor name is required'
--   8. 'resolve_schedule_exception: job % is no longer scheduled (status %)'
-- Validation order matches this list exactly: actor name (7), resolution
-- (3), reason (4), exception lookup (1), open check (2), then
-- per-resolution date checks (5, 6) — each guard fires before any database
-- read that isn't already required by an earlier guard.
--
-- apply_calendar_date_change's and open_calendar_deletion_exception's own
-- raises are NOT on the byte-identity list (only resolve_schedule_exception
-- is a cross-lane classifier target) but still avoid the same forbidden
-- substrings as a matter of house discipline.
--
-- ── M7 (plan decision, referenced throughout) ───────────────────────────
-- The dispatcher's OWN job.cancelled cleanup deletes the managed main/crew
-- Calendar events as an ordinary side effect of cancellation
-- (integration-dispatcher's job.cancelled handler). Google's push
-- notification for THAT deletion arrives at the inbound webhook exactly
-- like an externally-caused deletion would. Both apply_calendar_date_change
-- and open_calendar_deletion_exception guard on `status_v2 = 'scheduled'`
-- and return a `false`/reason JSONB (never a raise) when the job is not
-- scheduled — this is what makes the dispatcher's own cleanup deletions
-- inert here instead of opening a spurious exception or writing over a
-- cancelled job's dates. A raise would be wrong: the caller (the inbound
-- edge function) needs to tell "this is an expected echo of our own write"
-- apart from "this input was malformed," and only the JSONB result lets it
-- do that without parsing exception text.
--
-- House patterns mirrored, verbatim (see cancel_scheduled_job's and
-- schedule_estimate's headers for the fuller versions):
--   - `select ... for update` before any status check, so concurrent calls
--     against the SAME job/exception serialize instead of racing.
--   - job_events insert shape (job_number, stage_from, stage_to,
--     function_name, trigger_source, ghl_opportunity_id, action_summary,
--     status, payload_in).
--   - integration_outbox insert shape (event_type, aggregate_type,
--     aggregate_id, idempotency_key, payload) with
--     `on conflict (idempotency_key) do nothing`. The `job.scheduled`
--     idempotency key and payload shape
--     ('job.scheduled:<job>:rev<new>', {job_number, crew, start_date,
--     end_date, calendar_sync_revision}) reproduce
--     schedule_estimate_rpc's outbox writer exactly, so the SAME dispatcher
--     handler (integration-dispatcher's job.scheduled case) mirrors an
--     inbound-driven date change without any dispatcher-side change.
--
-- Design decisions:
--   1. resolve_schedule_exception's `reschedule` and `dismiss` resolutions
--      share ONE "job still scheduled" guard (raise text 8), fired after
--      the shared date-shape checks, because both write jobs.start_date/
--      end_date (dismiss writing the job's OWN current values back) and
--      both clear a stale gcal_*_event_id and both re-enqueue
--      `job.scheduled` — the two branches are the same write shape with
--      different date sources, so they share the same precondition. This
--      is an interpretation of the task brief, which states the guard
--      explicitly only for `reschedule`; the report accompanying this
--      migration flags it for confirmation.
--   2. open_calendar_deletion_exception's alert `message` names which
--      calendar (main or crew) the deleted event belonged to, derived by
--      comparing p_external_event_id against the job's own
--      gcal_main_event_id/gcal_crew_event_id — "unrecognized" when it
--      matches neither (e.g. a stale event id from before a prior
--      reschedule already replaced it).
create function public.apply_calendar_date_change(
  p_job_number text,
  p_start_date date,
  p_end_date date,
  p_expected_revision bigint,
  p_event_id text,
  p_event_updated timestamptz,
  p_source text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs;
  v_new_revision bigint;
begin
  if p_job_number is null or p_start_date is null or p_end_date is null
     or p_expected_revision is null then
    raise exception 'apply_calendar_date_change: p_job_number, p_start_date, p_end_date, p_expected_revision are required';
  end if;
  if p_end_date < p_start_date then
    raise exception 'apply_calendar_date_change: endDate (%) must be on or after startDate (%)', p_end_date, p_start_date;
  end if;

  select * into v_job from public.jobs where job_number = p_job_number for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'job_not_found');
  end if;

  -- M7: the status check IS the guard separating a live schedule from a
  -- cancelled job whose rev the cancel path deliberately did not bump.
  if v_job.status_v2 is distinct from 'scheduled'::public.job_lifecycle then
    return jsonb_build_object('applied', false, 'reason', 'not_scheduled');
  end if;

  -- Echo termination FIRST: after the dispatcher mirrors an inbound edit,
  -- the resulting notifications see event dates equal to canonical dates
  -- and stop here regardless of revision bookkeeping.
  if v_job.start_date = p_start_date and v_job.end_date = p_end_date then
    return jsonb_build_object('applied', false, 'reason', 'dates_unchanged');
  end if;

  -- Revision guard (plan decision 8), re-checked under the row lock so a
  -- racing app edit cannot interleave between the TS comparator and this
  -- write. Higher-than-current is impossible via any current writer —
  -- treated as stale, surfaced in the reason for the caller to log.
  if v_job.calendar_sync_revision is distinct from p_expected_revision then
    return jsonb_build_object('applied', false, 'reason', 'stale_revision',
      'job_revision', v_job.calendar_sync_revision, 'event_revision', p_expected_revision);
  end if;

  v_new_revision := v_job.calendar_sync_revision + 1;

  update public.jobs
     set start_date = p_start_date,
         end_date = p_end_date,
         calendar_sync_revision = v_new_revision,
         updated_at = now()
   where job_number = v_job.job_number
   returning * into v_job;

  insert into public.job_events (
    job_number, stage_from, stage_to, function_name, trigger_source,
    ghl_opportunity_id, action_summary, status, payload_in
  ) values (
    v_job.job_number, 6, 6, 'apply_calendar_date_change', 'google_calendar',
    v_job.ghl_opportunity_id,
    format('Schedule dates updated from Google Calendar (%s): %s to %s', p_source, p_start_date, p_end_date),
    'success',
    jsonb_build_object('event_id', p_event_id, 'event_updated', p_event_updated,
      'source', p_source, 'start_date', p_start_date, 'end_date', p_end_date,
      'calendar_sync_revision', v_new_revision)
  );

  -- Mirror through the EXISTING dispatcher machinery (plan decision 3):
  -- rev-scoped key = fresh delivery; the dispatcher's update path rewrites
  -- both projections (including the originating event, a harmless
  -- idempotent PUT) and re-notifies the crew per ruling R7.
  insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
  values (
    'job.scheduled', 'job', v_job.job_number,
    'job.scheduled:' || v_job.job_number || ':rev' || v_new_revision::text,
    jsonb_build_object('job_number', v_job.job_number, 'crew', v_job.crew,
      'start_date', p_start_date, 'end_date', p_end_date,
      'calendar_sync_revision', v_new_revision)
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('applied', true, 'calendar_sync_revision', v_new_revision);
end;
$$;

revoke all on function public.apply_calendar_date_change(text, date, date, bigint, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_calendar_date_change(text, date, date, bigint, text, timestamptz, text)
  to service_role;

-- open_calendar_deletion_exception — never touches jobs.status_v2, GHL, or
-- the stored gcal ids (per the spec's "do not update jobs.status_v2 or GHL
-- automatically"). A non-scheduled job is inert here for the SAME M7
-- reason as apply_calendar_date_change: the dispatcher's own job.cancelled
-- cleanup deletes the managed Calendar events, and that must never open an
-- exception for a job that is already, correctly, no longer scheduled.
create function public.open_calendar_deletion_exception(
  p_job_number text,
  p_external_event_id text,
  p_incoming_event jsonb
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs;
  v_exception_id uuid;
  v_calendar_label text;
begin
  if p_job_number is null or p_external_event_id is null then
    raise exception 'open_calendar_deletion_exception: p_job_number and p_external_event_id are required';
  end if;

  select * into v_job from public.jobs where job_number = p_job_number for update;
  if not found then
    return jsonb_build_object('opened', false, 'reason', 'job_not_found');
  end if;

  -- M7: the dispatcher's own job.cancelled cleanup deletions land here and
  -- must be inert — only a genuinely external deletion against a
  -- still-scheduled job is exceptional.
  if v_job.status_v2 is distinct from 'scheduled'::public.job_lifecycle then
    return jsonb_build_object('opened', false, 'reason', 'not_scheduled');
  end if;

  insert into public.job_schedule_exceptions (job_number, external_event_id, kind, previous_schedule, incoming_event)
  values (
    v_job.job_number, p_external_event_id, 'calendar_deleted',
    jsonb_build_object('crew', v_job.crew, 'start_date', v_job.start_date,
      'end_date', v_job.end_date, 'gcal_main_event_id', v_job.gcal_main_event_id,
      'gcal_crew_event_id', v_job.gcal_crew_event_id),
    p_incoming_event
  )
  on conflict (job_number, external_event_id) where status = 'open' do nothing
  returning id into v_exception_id;

  if v_exception_id is null then
    return jsonb_build_object('opened', false, 'reason', 'exception_already_open');
  end if;

  v_calendar_label := case
    when p_external_event_id = v_job.gcal_main_event_id then 'main'
    when p_external_event_id = v_job.gcal_crew_event_id then 'crew'
    else 'unrecognized'
  end;

  -- Design decision 2 (file header): plain insert with 23505 swallowed via
  -- an exception block, deliberately NOT an ON CONFLICT clause — the
  -- job_schedule_exceptions_one_open dedup above already prevents a second
  -- open exception for this (job, event) pair from ever reaching this
  -- point, so this is defense-in-depth against a job_alerts-level
  -- collision from a DIFFERENT source (e.g. a fingerprint reused by a
  -- future caller), not a demonstrated live race for this call path today.
  begin
    insert into public.job_alerts (
      job_number, fingerprint, severity, title, message, action_path
    ) values (
      v_job.job_number,
      'calendar_deleted:' || p_external_event_id,
      'at_risk',
      'Calendar event deleted: ' || v_job.job_number,
      format('The %s calendar event for %s to %s was deleted externally.',
        v_calendar_label, v_job.start_date, v_job.end_date),
      '/jobs/exceptions'
    );
  exception when unique_violation then
    null;
  end;

  insert into public.job_events (
    job_number, stage_from, stage_to, function_name, trigger_source,
    ghl_opportunity_id, action_summary, status, payload_in
  ) values (
    v_job.job_number, 6, 6, 'open_calendar_deletion_exception', 'google_calendar',
    v_job.ghl_opportunity_id,
    format('Calendar event %s (%s) deleted externally for %s — exception opened', p_external_event_id, v_calendar_label, v_job.job_number),
    'success',
    jsonb_build_object('external_event_id', p_external_event_id, 'exception_id', v_exception_id,
      'calendar', v_calendar_label, 'incoming_event', p_incoming_event)
  );

  return jsonb_build_object('opened', true, 'exception_id', v_exception_id);
end;
$$;

revoke all on function public.open_calendar_deletion_exception(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.open_calendar_deletion_exception(text, text, jsonb)
  to service_role;

-- resolve_schedule_exception — the human-facing resolution of an open
-- job_schedule_exceptions row (see /jobs/exceptions, the action_path both
-- open_calendar_deletion_exception and mark_job_reconciliation_required
-- point at for their respective alert classes). Validation order = the
-- byte-identity raise-text order documented in the file header.
create function public.resolve_schedule_exception(
  p_exception_id uuid,
  p_resolution text,
  p_reason text,
  p_start_date date,
  p_end_date date,
  p_actor uuid,
  p_actor_name text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor_name    text;
  v_reason        text;
  v_exception     public.job_schedule_exceptions;
  v_job           public.jobs;
  v_new_revision  bigint;
  v_new_status    public.schedule_exception_status;
  v_alert_fingerprint text;
begin
  -- ── Required-argument / shape guards, in byte-identity raise-text order
  --    (file header): actor name (7) -> resolution (3) -> reason (4) ->
  --    exception lookup (1) -> open check (2) -> per-resolution date
  --    checks (5, 6). ─────────────────────────────────────────────────────
  v_actor_name := nullif(btrim(coalesce(p_actor_name, '')), '');
  if v_actor_name is null then
    raise exception 'resolve_schedule_exception: actor name is required';
  end if;

  if p_resolution is null or p_resolution not in ('reschedule', 'postponed', 'closed_lost', 'dismiss') then
    raise exception 'resolve_schedule_exception: invalid resolution %', p_resolution;
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'resolve_schedule_exception: resolution reason is required';
  end if;

  select * into v_exception from public.job_schedule_exceptions where id = p_exception_id for update;
  if not found then
    raise exception 'resolve_schedule_exception: exception % not found', p_exception_id;
  end if;

  if v_exception.status is distinct from 'open'::public.schedule_exception_status then
    raise exception 'resolve_schedule_exception: exception % is not open (status %)', p_exception_id, v_exception.status::text;
  end if;

  if p_resolution = 'reschedule' then
    if p_start_date is null or p_end_date is null then
      raise exception 'resolve_schedule_exception: reschedule requires startDate and endDate';
    end if;
    if p_end_date < p_start_date then
      raise exception 'resolve_schedule_exception: endDate (%) must be on or after startDate (%)', p_end_date, p_start_date;
    end if;
  end if;

  v_alert_fingerprint := 'calendar_deleted:' || v_exception.external_event_id;

  if p_resolution in ('reschedule', 'dismiss') then
    -- Design decision 1 (file header): reschedule and dismiss share this
    -- guard — both write jobs.start_date/end_date (dismiss writing the
    -- job's OWN current values back), both clear a stale gcal_*_event_id,
    -- both re-enqueue job.scheduled, so both need the job to still be
    -- 'scheduled' for that write to mean anything.
    select * into v_job from public.jobs where job_number = v_exception.job_number for update;
    if not found or v_job.status_v2 is distinct from 'scheduled'::public.job_lifecycle then
      raise exception 'resolve_schedule_exception: job % is no longer scheduled (status %)',
        v_exception.job_number, coalesce(v_job.status_v2::text, 'unknown');
    end if;

    v_new_revision := v_job.calendar_sync_revision + 1;

    if p_resolution = 'reschedule' then
      update public.jobs
         set start_date = p_start_date,
             end_date = p_end_date,
             calendar_sync_revision = v_new_revision,
             gcal_main_event_id = case when v_job.gcal_main_event_id = v_exception.external_event_id then null else v_job.gcal_main_event_id end,
             gcal_crew_event_id = case when v_job.gcal_crew_event_id = v_exception.external_event_id then null else v_job.gcal_crew_event_id end,
             updated_at = now()
       where job_number = v_job.job_number
       returning * into v_job;
      v_new_status := 'rescheduled'::public.schedule_exception_status;
    else
      -- dismiss: the job's CURRENT dates, unchanged — any p_start_date/
      -- p_end_date supplied by the caller are ignored. The dispatcher
      -- recreates the managed event at the SAME dates.
      update public.jobs
         set calendar_sync_revision = v_new_revision,
             gcal_main_event_id = case when v_job.gcal_main_event_id = v_exception.external_event_id then null else v_job.gcal_main_event_id end,
             gcal_crew_event_id = case when v_job.gcal_crew_event_id = v_exception.external_event_id then null else v_job.gcal_crew_event_id end,
             updated_at = now()
       where job_number = v_job.job_number
       returning * into v_job;
      v_new_status := 'dismissed'::public.schedule_exception_status;
    end if;

    insert into public.job_events (
      job_number, stage_from, stage_to, function_name, trigger_source,
      ghl_opportunity_id, action_summary, status, payload_in
    ) values (
      v_job.job_number, 6, 6, 'resolve_schedule_exception', 'app_schedule',
      v_job.ghl_opportunity_id,
      format('Schedule exception %s resolved as %s for %s by %s', p_exception_id, p_resolution, v_job.job_number, v_actor_name),
      'success',
      jsonb_build_object('exception_id', p_exception_id, 'resolution', p_resolution,
        'start_date', v_job.start_date, 'end_date', v_job.end_date,
        'calendar_sync_revision', v_new_revision)
    );

    -- Same idempotency-key/payload shape as apply_calendar_date_change and
    -- schedule_estimate's own job.scheduled writer — the SAME dispatcher
    -- handler recreates the managed event(s) for whichever branch ran.
    insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
    values (
      'job.scheduled', 'job', v_job.job_number,
      'job.scheduled:' || v_job.job_number || ':rev' || v_new_revision::text,
      jsonb_build_object('job_number', v_job.job_number, 'crew', v_job.crew,
        'start_date', v_job.start_date, 'end_date', v_job.end_date,
        'calendar_sync_revision', v_new_revision)
    )
    on conflict (idempotency_key) do nothing;
  else
    -- postponed / closed_lost: reuse cancel_scheduled_job verbatim — buys
    -- the status-guard, audit, job.cancelled + ghl.stage.requested
    -- enqueues, and cancel_scheduled_job's own byte-pinned raise texts for
    -- free (a job no longer cancellable surfaces THAT function's raise,
    -- which the web classifier already routes — see this file's header).
    perform public.cancel_scheduled_job(v_exception.job_number, p_resolution, v_reason, p_actor, v_actor_name);
    v_new_status := 'unscheduled'::public.schedule_exception_status;
  end if;

  update public.job_schedule_exceptions
     set status = v_new_status,
         resolved_at = now(),
         resolved_by = p_actor,
         resolution_note = v_reason
   where id = p_exception_id;

  -- Resolve the paired alert, for all four resolutions alike.
  update public.job_alerts
     set resolved_at = now(),
         resolution_note = v_reason
   where job_number = v_exception.job_number
     and fingerprint = v_alert_fingerprint
     and resolved_at is null;

  return jsonb_build_object('resolution', p_resolution, 'job_number', v_exception.job_number, 'exception_id', p_exception_id);
end;
$$;

revoke all on function public.resolve_schedule_exception(uuid, text, text, date, date, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_schedule_exception(uuid, text, text, date, date, uuid, text)
  to service_role;
