-- Profitability v2 Phase 1, Task 4 (Session 3, Lane 4a) — atomic
-- schedule-to-job promotion.
--
-- schedule_estimate() is the one action that mints JOB-XXXX going forward
-- (v2 doc, Task 4, lines 1142-1237; phase-1 plan Task 4 row). It is the
-- ONLY writer of job_budget_versions version 1. Until the Phase 1 gate
-- flips ENABLE_GHL_ACCEPTANCE_JOB_CREATION to 'false' (lane 4c, a sibling
-- migration-free task touching only supabase/functions/ghl-job-webhook),
-- the legacy Quote-Accepted minting path in ghl-job-webhook keeps working
-- unchanged — this migration does not touch that function or its behavior.
-- During that coexistence window a legacy-minted job can already hold
-- estimates.job_number for a family (set via ghl-job-webhook's
-- promoteEstimateForJob -> update_estimate_job_number); this RPC's
-- eligibility check 2 below (estimates.job_number IS NULL) is what refuses
-- to mint a second, competing job for that family.
--
-- ⚠️ BYTE-IDENTITY CONSTRAINT (fix round, adversarial review): lane 4b's
-- web-side classifyScheduleError() pattern-matches on the exact text of
-- three raises below to route them to distinct UI messages. Their wording
-- MUST NOT CHANGE:
--   1. 'schedule_estimate: estimate % is not the currently accepted version of family % — cannot schedule'
--   2. 'schedule_estimate: estimate % already has job_number % set (linked outside schedule_estimate) — refusing to mint a second job'
--   3. 'schedule_estimate: estimate % has no estimate_financial_details row — cannot mint a budget'
-- Every OTHER raise this function adds uses deliberately distinct wording
-- (they classify as 'other' web-side, which is acceptable — see the fix
-- round's F2/F3 additions below).
--
-- House patterns mirrored, verbatim:
--   - Lock ordering (F3 label collision note: this file's own "F3" numbers
--     below refer to THIS session's fix-round findings, not
--     20260819161000_estimate_commercial_lifecycle.sql's F3 lock-order
--     fix, which is the pattern being MIRRORED here): resolve
--     estimate_number FIRST via an UNLOCKED read (estimate_number is
--     immutable — enforce_estimate_immutability never watches it — so an
--     unlocked read is always consistent), THEN take the family lock ONCE
--     in the SAME deterministic order record_estimate_acceptance_event
--     uses (`where estimate_number = v_number order by id for update`),
--     THEN lock estimate_acceptance_state (same order: family row(s)
--     first, then the state row — matching record_estimate_acceptance_event's
--     reversal branch) — so schedule_estimate and
--     record_estimate_acceptance_event can never lock-order-invert against
--     each other on the same family.
--
--     Concurrency note (fix-round correction — the ORIGINAL version of this
--     comment claimed "Postgres has no gap locks, so [a same-family mint
--     race] is possible even under the FOR UPDATE scan above"; that
--     overstated the risk and taught the wrong mental model): the family
--     FOR UPDATE scan above locks EVERY estimates row sharing
--     estimate_number = v_number, and two concurrent schedule_estimate
--     calls against the SAME family necessarily contend for that SAME row
--     set — so the second caller blocks at the family-lock step until the
--     first caller's transaction commits or rolls back. Two
--     schedule_estimate calls on ONE family are therefore fully
--     serialized by this lock alone; they cannot race each other into the
--     jobs INSERT below. What "no gap locks" correctly describes is a
--     DIFFERENT, narrower risk: this lock says nothing about some
--     OTHER, not-yet-existing write path into jobs.original_estimate_number
--     that doesn't take the same family lock (there is no such path today
--     — schedule_estimate is the sole writer of that column). The
--     unique_violation catch on the mint INSERT below (design decision 4)
--     is retained as defense-in-depth against exactly that hypothetical
--     future writer, not because it is reachable via two concurrent calls
--     to THIS function today.
--   - Required-argument guards up front, one raise per missing field,
--     `<function>: <msg>` message prefix (mark_job_reconciliation_required,
--     record_estimate_acceptance_event).
--   - Actor context for the audit trigger is set via the EXISTING
--     update_estimate_job_number RPC, called directly (not reimplemented)
--     so the estimate_mutations_audit row is byte-for-byte identical to any
--     other job_number write, per the task brief's explicit permission to
--     do this ("Do not call the RPC wrapper if inlining is cleaner — but
--     the audit row must appear identically").
--   - search_path = public, pg_temp pinned (phase-1 plan deviation 3);
--     EXECUTE revoked from public/anon/authenticated, explicitly granted to
--     service_role.
--
-- PLAIN plpgsql, NOT SECURITY DEFINER (fix round F5 — reversed from this
-- migration's first draft, which used SECURITY DEFINER for stated
-- "forward compatibility" reasons the adversarial review showed were
-- actively dangerous): every other estimates-writing RPC in this schema
-- (record_estimate_acceptance_event, create_estimate_with_items_v2,
-- update_estimate_job_number, mark_job_reconciliation_required) is plain
-- plpgsql on the stated reasoning that callers are already service_role
-- (which bypasses RLS regardless of DEFINER/INVOKER) — see
-- mark_job_reconciliation_required's header in
-- 20260819151000_profitability_core_schema.sql. The first draft made this
-- function SECURITY DEFINER instead, reasoning that a future v2 Task 8
-- grant of `authenticated` EXECUTE on operational routes would then let an
-- authenticated foreman's session run with the owner's (service-role-
-- equivalent) privileges. The review's correction: that is exactly
-- backwards for THIS table set. `workforce_profiles` (BL-7,
-- 20260818143000_workforce_auth_boundary.sql) exists specifically so a
-- brand-new signup defaults to role='pending'/active=false and is denied
-- by RLS until an owner promotes them — a SECURITY DEFINER
-- schedule_estimate, if ever granted to `authenticated`, would let ANY
-- authenticated session (including a pending, unapproved signup) execute
-- with the DEFINER's (effectively service-role) privileges and bypass
-- that RLS gate entirely, which is the one thing BL-7 was built to
-- prevent. Plain INVOKER rights mean a future `authenticated` grant would
-- run with the CALLER's own privileges, so RLS on every table this
-- function touches would apply normally — the correct posture for a
-- function that might someday be reachable by a non-service-role session.
-- search_path remains pinned regardless (deviation 3 applies to every
-- function this session creates), but it is no longer load-bearing against
-- privilege escalation now that the function is INVOKER, not DEFINER.
--
-- Design decisions made where the task brief left room (see also the
-- implementer's self-report in the session record):
--   1. calendar_sync_revision starts at 1 on MINT (not the column's own
--      default of 0) — "rev1" names the first real schedule action, "rev0"
--      is never observed. Reactivation increments from whatever the job's
--      current value is (1, 2, 3, ...).
--   2. Reactivation does NOT change jobs.original_estimate_id/
--      original_estimate_number, and does NOT refresh jobs.estimate_value —
--      both stay pinned to whichever estimate version FIRST minted the job,
--      consistent with "retain budget v1" (budget v1's source_estimate_id
--      is likewise never touched again).
--   2b (fix round F2, MAJOR, demonstrated): decision 2 alone was unsafe —
--      it let a family whose acceptance MOVED to a different estimate
--      version (v1 scheduled → cancelled+reversed → v2 accepted at a
--      different price) revive the SAME cancelled job on v1's now-stale
--      budget/accepted_price, via schedule_estimate(v2's id), because
--      eligibility 1 only checks that p_estimate_id IS the current
--      accepted version — it says nothing about whether that version is
--      the SAME one the existing job was originally minted from. Fixed:
--      immediately after the "does a job already exist for this family"
--      lookup, before EITHER the idempotent-return branch or the
--      reactivate branch runs, this function now raises if
--      `v_existing_job.original_estimate_id IS DISTINCT FROM
--      p_estimate_id` — implemented as ONE guard gating entry to both
--      branches (equivalent to, and simpler than, duplicating the same
--      check inside each branch separately). A mismatch here means the
--      family's commercial story diverged from its operational job and
--      needs a human decision (manual resolution or a future change
--      order), not an automatic silent revival.
--   3. jobs.ghl_contact_id / ghl_opportunity_id ARE SET at mint (fix round
--      F3 — reversed from this migration's first draft, which left them
--      NULL). Sourced from estimate_identity_links (PK estimate_number —
--      a deterministic, at-most-one-row lookup; NULL/NULL when no link
--      exists for the family, which stays legal since jobs.ghl_opportunity_id
--      has no NOT NULL constraint and Postgres permits multiple NULLs
--      under a UNIQUE index). This is what makes ghl-job-webhook's
--      launch_workflow compatibility check and its Quote Accepted
--      idempotency lookup (`jobs where ghl_opportunity_id = opportunityId`)
--      actually find app-minted jobs, and turns the live
--      jobs_ghl_opportunity_id UNIQUE constraint into a real DB-level
--      backstop against a legacy job and an app-minted job both claiming
--      the same GHL opportunity (see the mint-insert exception handler's
--      new jobs_ghl_opportunity_id_key branch below). Deliberately NOT
--      re-derived or re-written on reactivation — by the time reactivation
--      code runs, F2's mismatch guard has already confirmed
--      v_existing_job.original_estimate_id = p_estimate_id, so the job's
--      EXISTING ghl_contact_id/ghl_opportunity_id (set once, at original
--      mint) are still correct and are read directly off v_job after the
--      UPDATE rather than re-queried. jobs.client_contact_name /
--      business_name are still left NULL on mint (unchanged from the
--      first draft) — estimates carries one client_name field, not the
--      contact/company split jobs.client_contact_name vs client_name
--      encodes (see CLAUDE.md's clientLabel() note) — there is no lossless
--      source to populate them from here.
--   4. Race safety on the mint INSERT: wrapped in its own sub-block so a
--      unique_violation is caught and dispatched by CONSTRAINT NAME
--      (via GET STACKED DIAGNOSTICS) rather than raising an opaque
--      duplicate-key error:
--        - jobs_original_estimate_number_key: re-resolves and returns the
--          winner's row (idempotent-loser outcome). See the concurrency
--          note above the lock-ordering paragraph for why this branch is
--          defense-in-depth, not a demonstrated live race for two calls on
--          the SAME family.
--        - jobs_ghl_opportunity_id_key (fix round F3): a DIFFERENT
--          family's job (very likely a still-live LEGACY mint from
--          ghl-job-webhook, since that is the only other writer of this
--          column during the Phase 1 coexistence window) already holds
--          this GHL opportunity. Refuses with an explanatory raise,
--          distinct wording from the byte-identity-pinned messages above —
--          does NOT attempt to resolve or return anything, since there is
--          no correct row to hand back.
--        - anything else: unexpected (jobs_job_number_key colliding would
--          mean next_job_number() is broken). Fix round: instead of
--          constructing a NEW raise exception (which would replace the
--          original SQLSTATE 23505 with a generic P0001), this now emits a
--          RAISE NOTICE for context and then a bare `raise;` — a bare
--          re-raise inside a plpgsql EXCEPTION handler preserves the
--          original error's SQLSTATE and message verbatim, which is more
--          useful to an operator than a hand-written substitute.
--   5. jobs.scope_summary IS POPULATED at mint (fix round F7): names ONLY
--      from estimate_line_items, joined newline-separated in sort_order —
--      deliberately excludes hours, dump_count, materials_cost, AND each
--      line item's free-text `description` column (unlike the analogous
--      TS renderer buildScopeSummaryFromLineItems in
--      ghl-job-webhook/handlers.ts, which does include description). This
--      is a narrower, more conservative reading than that TS renderer:
--      `description` is free text an estimator typed, and free text is
--      exactly the risk class _shared/job.ts's stripCurrencyFromScopeText
--      guards against elsewhere in this codebase (job_details can carry a
--      dollar figure or percentage). `name` is drawn from the controlled
--      scope_library vocabulary and carries no such risk. NULL when the
--      estimate has zero line items (quick-mode estimates carry their
--      scope in job_details instead — this RPC does not read job_details).
--      This implements the adversarial review's option (a); flagging here,
--      per the review's own instruction, that it is PENDING Matt's
--      explicit confirmation in the session ledger before being treated as
--      final. jobs.start_time is left NULL by this RPC — there is no
--      source for it anywhere in the app scheduling flow (it mirrors GHL's
--      free-text Job Start Time field, which only the legacy webhook path
--      populates); recorded here for Matt, not silently decided.
--   6. ghl.stage.requested is enqueued ONLY when a GHL opportunity is
--      actually linked (fix round F6): both at mint (v_ghl_opportunity_id
--      not null) and at reactivation (v_job.ghl_opportunity_id not null,
--      read off the row rather than re-derived — see decision 3). A family
--      with no estimate_identity_links row has nothing for the dispatcher
--      to update in GHL; enqueueing the event anyway would create an
--      outbox row that can never succeed, retries to attempt 5, dead-
--      letters, and opens a spurious job_alert. job.scheduled always
--      enqueues regardless — Calendar/Slack projection has no such
--      precondition.
--   7. planned_profit_pct is CLAMPED to ±99999.99 (fix round F8) — the
--      widest value numeric(7,2) can represent (5 integer digits + 2
--      decimal) — rather than letting a pathological accepted_price/cost
--      ratio abort the whole schedule action on a numeric field overflow.
--      The clamp is a documented last-resort guard, not a claim that a
--      clamped percentage is meaningful; a job that hits this bound has a
--      broken estimate and needs a human look regardless of what this
--      column says.
--      ⚠️ Re-review R1 correction: F8's first draft declared
--      v_planned_profit_pct as numeric(7,2), which made the clamp DEAD
--      CODE — plpgsql enforces a variable's own typmod at every
--      assignment, so the computing assignment itself would have raised
--      "numeric field overflow" before the clamp line ever ran, on the
--      exact pathological ratio the clamp exists to survive. Fixed by
--      declaring the variable plain `numeric` (see its declaration above)
--      so the clamp actually executes before the value ever reaches a
--      numeric(7,2) slot. Covered by a dedicated pgTAP case (family
--      910110: accepted_price of $1.00 against a $1,000,000+ cost) proving
--      the schedule action succeeds and the stored value is exactly
--      -99999.99, not a raised error.
--
-- Fully-loaded cost basis for the recomputed budget-v1 profit (deviation
-- 12's Task 4 half): operational_labor_cost + materials_cost + rentals_cost
-- + expected_dump_cost + subcontractors_cost + other_direct_cost (the
-- "operational direct" bundle) + allocated_overhead +
-- expected_processing_cost. Deliberately EXCLUDES
-- risk_pricing_allowance / processing_pricing_allowance / discount_amount —
-- those are pricing/markup inputs on the way to customer_price, not costs.
-- round(numeric, 2) is Postgres's native round-half-away-from-zero for the
-- numeric type (not banker's rounding — that distinction only bites
-- floating-point types), so plain round(x, 2) is the correct half-up cent
-- rounding here without needing a hand-rolled helper the way
-- _shared/pricing.ts's roundToCent works around float64.
create function public.schedule_estimate(
  p_estimate_id uuid,
  p_schedule jsonb,
  p_actor uuid,
  p_actor_name text
) returns public.jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_number int;
  v_row record;
  v_target record;
  v_found_target boolean := false;
  v_state record;
  v_existing_job public.jobs;
  v_job public.jobs;
  v_details record;
  v_crew text;
  v_start_date date;
  v_end_date date;
  v_actor_name text;
  v_job_number text;
  v_job_name text;
  v_client_label text;
  v_fully_loaded_cost numeric(12,2);
  v_planned_profit numeric(12,2);
  -- Re-review R1: deliberately PLAIN numeric, not numeric(7,2). plpgsql
  -- enforces a variable's declared typmod at every ASSIGNMENT, not just at
  -- the eventual column write -- so a numeric(7,2) declaration would have
  -- raised "numeric field overflow" on the computing assignment below,
  -- before the F8 clamp two lines later ever got a chance to run, making
  -- the clamp dead code. Plain numeric holds the raw (possibly huge)
  -- computed value; the clamp then bounds it to numeric(7,2)'s
  -- representable range BEFORE it reaches job_budget_versions.planned_profit_pct,
  -- which is the numeric(7,2) column.
  v_planned_profit_pct numeric;
  v_new_revision bigint;
  v_ghl_contact_id text;
  v_ghl_opportunity_id text;
  v_scope_summary text;
  v_constraint text;
begin
  -- ── Required-argument guards, house pattern ────────────────────────────
  if p_estimate_id is null then
    raise exception 'schedule_estimate: p_estimate_id is required';
  end if;

  v_actor_name := nullif(btrim(coalesce(p_actor_name, '')), '');
  if v_actor_name is null then
    raise exception 'schedule_estimate: p_actor_name is required';
  end if;

  if p_schedule is null or jsonb_typeof(p_schedule) is distinct from 'object' then
    raise exception 'schedule_estimate: p_schedule must be a non-null JSON object';
  end if;

  v_crew := nullif(btrim(coalesce(p_schedule->>'crew', '')), '');
  if v_crew is null then
    raise exception 'schedule_estimate: p_schedule.crew is required and must be non-blank';
  end if;

  begin
    v_start_date := (nullif(p_schedule->>'startDate', ''))::date;
  exception when others then
    raise exception 'schedule_estimate: p_schedule.startDate is not a valid date (%)', p_schedule->>'startDate';
  end;
  if v_start_date is null then
    raise exception 'schedule_estimate: p_schedule.startDate is required';
  end if;

  begin
    v_end_date := (nullif(p_schedule->>'endDate', ''))::date;
  exception when others then
    raise exception 'schedule_estimate: p_schedule.endDate is not a valid date (%)', p_schedule->>'endDate';
  end;
  if v_end_date is null then
    raise exception 'schedule_estimate: p_schedule.endDate is required';
  end if;

  if v_end_date < v_start_date then
    raise exception 'schedule_estimate: p_schedule.endDate (%) must be on or after startDate (%)',
      v_end_date, v_start_date;
  end if;

  -- ── Resolve family, unlocked (lock-ordering pattern mirrored from
  --    record_estimate_acceptance_event's own F3 fix) ────────────────────
  select estimate_number into v_number
    from public.estimates
   where id = p_estimate_id;

  if not found then
    raise exception 'schedule_estimate: estimate % not found', p_estimate_id;
  end if;

  -- ── Lock the family, ONE deterministic scan — same order as
  --    record_estimate_acceptance_event, so the two functions can never
  --    lock-order-invert against each other on the same family (and, per
  --    the concurrency note in the file header, this fully serializes two
  --    schedule_estimate calls on the SAME family by itself). Reads every
  --    column this function needs off the SAME locked scan.
  for v_row in
    select id, estimate_number, job_number, client_name, client_type,
           client_phone, job_address, city, labor_rate, overhead_rate
      from public.estimates
     where estimate_number = v_number
     order by id
     for update
  loop
    if v_row.id = p_estimate_id then
      v_target := v_row;
      v_found_target := true;
    end if;
  end loop;

  if not v_found_target then
    -- Defensive, should be unreachable: v_estimate_id resolved to v_number
    -- moments ago and estimates rows are never deleted
    -- (enforce_estimate_no_delete).
    raise exception 'schedule_estimate: estimate % not found in family % after lock', p_estimate_id, v_number;
  end if;

  -- ── Lock the acceptance-state projection for this family (same lock
  --    ORDER as record_estimate_acceptance_event's reversal branch: family
  --    first, then acceptance_state).
  select current_estimate_id, accepted, accepted_price
    into v_state
    from public.estimate_acceptance_state
   where estimate_number = v_number
   for update;

  -- Eligibility 1 (⚠️ BYTE-IDENTICAL raise text, see file header): p_estimate_id
  -- must be exactly the CURRENT, ACCEPTED projection for its family.
  -- Acceptance currency comes ONLY from estimate_acceptance_state —
  -- estimate_acceptance_events has no monotonic ordering (same-transaction
  -- events share created_at) — never derived by ordering the event log.
  -- Covers: no acceptance state at all, a reversed acceptance, and a
  -- non-current (superseded-since-accepted) version being passed in.
  if not found or not v_state.accepted or v_state.current_estimate_id is distinct from p_estimate_id then
    raise exception
      'schedule_estimate: estimate % is not the currently accepted version of family % — cannot schedule',
      p_estimate_id, v_number;
  end if;

  -- ── Look for an existing operational job for this FAMILY (family key =
  --    estimate_number, via jobs.original_estimate_number, which is
  --    UNIQUE). Locked so two concurrent schedule_estimate calls against an
  --    ALREADY-EXISTING job serialize cleanly.
  select * into v_existing_job
    from public.jobs
   where original_estimate_number = v_number
   for update;

  if found then
    -- Fix round F2 (MAJOR, demonstrated — see decision 2b in the file
    -- header): gates BOTH branches below. A family whose acceptance moved
    -- to a different estimate version than whichever one originally
    -- minted this job must not be silently returned-unchanged OR
    -- reactivated on stale data — either outcome would hide the mismatch.
    if v_existing_job.original_estimate_id is distinct from p_estimate_id then
      raise exception
        'schedule_estimate: job % for family % was minted from a different estimate version (%) than the one being scheduled (%) — resolve manually or via a change order',
        v_existing_job.job_number, v_number, v_existing_job.original_estimate_id, p_estimate_id;
    end if;

    if v_existing_job.status_v2 is distinct from 'cancelled'::public.job_lifecycle then
      -- Idempotent re-call: job is active AND was minted from this exact
      -- estimate version. Return it UNCHANGED — no mint, no second budget
      -- row, no new outbox events (a blind retry of an already-scheduled
      -- job must not re-enqueue work). Any new crew/dates in p_schedule
      -- are deliberately ignored here; that is not what this call path is
      -- for (see design decisions in the file header).
      return v_existing_job;
    end if;

    -- ── REACTIVATE the same JOB-XXXX (design decisions 1-2 in file
    --    header: original_estimate_id/number and estimate_value are NOT
    --    touched; budget v1 and current_budget_version are retained
    --    as-is; ghl_contact_id/ghl_opportunity_id are likewise NOT
    --    re-derived — see decision 3 — the F2 guard above already proved
    --    this job's identity fields are still correct for p_estimate_id).
    v_new_revision := v_existing_job.calendar_sync_revision + 1;

    update public.jobs
       set status_v2 = 'scheduled'::public.job_lifecycle,
           crew = v_crew,
           start_date = v_start_date,
           end_date = v_end_date,
           cancelled_at = null,
           cancellation_reason = null,
           calendar_sync_revision = v_new_revision,
           updated_at = now()
     where job_number = v_existing_job.job_number
     returning * into v_job;

    insert into public.job_events (
      job_number, stage_from, stage_to, function_name, trigger_source,
      ghl_opportunity_id, action_summary, status, payload_in
    ) values (
      v_job.job_number, 5, 6, 'schedule_estimate', 'app_schedule',
      v_job.ghl_opportunity_id,
      format('Reactivated cancelled job %s — rescheduled by %s', v_job.job_number, v_actor_name),
      'success',
      jsonb_build_object(
        'estimate_id', p_estimate_id, 'crew', v_crew,
        'start_date', v_start_date, 'end_date', v_end_date,
        'calendar_sync_revision', v_new_revision
      )
    );

    insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
    values (
      'job.scheduled', 'job', v_job.job_number,
      'job.scheduled:' || v_job.job_number || ':rev' || v_new_revision::text,
      jsonb_build_object(
        'job_number', v_job.job_number, 'crew', v_crew,
        'start_date', v_start_date, 'end_date', v_end_date,
        'calendar_sync_revision', v_new_revision
      )
    )
    on conflict (idempotency_key) do nothing;

    -- Fix round F6: only when this job actually has a linked opportunity.
    if v_job.ghl_opportunity_id is not null then
      insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
      values (
        'ghl.stage.requested', 'job', v_job.job_number,
        'ghl.stage.requested:' || v_job.job_number || ':rev' || v_new_revision::text,
        jsonb_build_object(
          'stage', 'Job Scheduled', 'job_number', v_job.job_number,
          'ghl_opportunity_id', v_job.ghl_opportunity_id
        )
      )
      on conflict (idempotency_key) do nothing;
    end if;

    return v_job;
  end if;

  -- ===================== MINT path =====================

  -- Eligibility 2 (⚠️ BYTE-IDENTICAL raise text, see file header): this
  -- SPECIFIC estimate version must not already carry a job_number.
  -- Distinct from the family-wide jobs lookup above: a legacy
  -- ghl-job-webhook mint (still live until the Phase 1 gate flips the
  -- flag) sets estimates.job_number via promoteEstimateForJob but does NOT
  -- populate jobs.original_estimate_number — so the lookup above can find
  -- nothing while this estimate is already spoken for. Catch it here
  -- rather than minting a second, competing job.
  if v_target.job_number is not null then
    raise exception
      'schedule_estimate: estimate % already has job_number % set (linked outside schedule_estimate) — refusing to mint a second job',
      p_estimate_id, v_target.job_number;
  end if;

  -- Eligibility 3 (⚠️ BYTE-IDENTICAL raise text, see file header): financial
  -- details must exist — this is the ONLY source for budget v1.
  select
    productive_hours, operational_labor_cost, materials_cost, rentals_cost,
    expected_dump_cost, subcontractors_cost, other_direct_cost,
    allocated_overhead, expected_processing_cost
    into v_details
    from public.estimate_financial_details
   where estimate_id = p_estimate_id;

  if not found then
    raise exception
      'schedule_estimate: estimate % has no estimate_financial_details row — cannot mint a budget',
      p_estimate_id;
  end if;

  -- Fix round F3: resolve the family's GHL identity link, if any, BEFORE
  -- the insert so it can be written onto the new job row directly. NULL
  -- for both columns (found or not) is legal and expected for a family
  -- with no link yet.
  select l.ghl_contact_id, l.ghl_opportunity_id
    into v_ghl_contact_id, v_ghl_opportunity_id
    from public.estimate_identity_links l
   where l.estimate_number = v_number;

  -- Fix round F7: names only, newline-joined, sort_order preserved. NULL
  -- (string_agg over zero rows) when the estimate has no line items — see
  -- decision 5 in the file header for what this deliberately excludes and
  -- why.
  select string_agg(eli.name, E'\n' order by eli.sort_order)
    into v_scope_summary
    from public.estimate_line_items eli
   where eli.estimate_id = p_estimate_id;

  -- ── Mint + insert. Wrapped so a lost race resolves cleanly instead of
  --    raising an opaque duplicate-key error — see design decision 4 in
  --    the file header for the three dispatch branches.
  select public.next_job_number() into v_job_number;

  v_client_label := coalesce(nullif(btrim(coalesce(v_target.client_name, '')), ''), 'Client');
  v_job_name := v_job_number || ' – ' || v_client_label
    || case when nullif(btrim(coalesce(v_target.city, '')), '') is not null
         then ' – ' || v_target.city
         else ''
       end;

  begin
    insert into public.jobs (
      job_number, job_name, client_name, client_type, job_address, city,
      client_phone, estimate_value, status_v2, launch_workflow,
      original_estimate_id, original_estimate_number, current_budget_version,
      crew, start_date, end_date, calendar_sync_revision,
      ghl_contact_id, ghl_opportunity_id, scope_summary
    ) values (
      v_job_number, v_job_name, v_target.client_name, v_target.client_type,
      v_target.job_address, v_target.city, v_target.client_phone,
      v_state.accepted_price, 'scheduled'::public.job_lifecycle, true,
      p_estimate_id, v_number, 1,
      v_crew, v_start_date, v_end_date, 1,
      v_ghl_contact_id, v_ghl_opportunity_id, v_scope_summary
    )
    returning * into v_job;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'jobs_original_estimate_number_key' then
      select * into v_job from public.jobs where original_estimate_number = v_number;
      if not found then
        raise exception
          'schedule_estimate: lost the original_estimate_number race for family % but re-select found no row — investigate',
          v_number;
      end if;
      return v_job;
    elsif v_constraint = 'jobs_ghl_opportunity_id_key' then
      -- Fix round F3: a DIFFERENT job (most likely a still-live legacy
      -- ghl-job-webhook mint during the Phase 1 coexistence window) already
      -- holds this GHL opportunity. No correct row to hand back — refuse.
      raise exception
        'schedule_estimate: GHL opportunity % is linked to a different job — cannot mint a duplicate; resolve manually',
        v_ghl_opportunity_id;
    else
      -- Fix round: bare re-raise preserves the original SQLSTATE/message
      -- (e.g. an unexpected jobs_job_number_key collision, which would
      -- mean next_job_number() itself is broken) instead of masking it
      -- behind a hand-written substitute.
      raise notice
        'schedule_estimate: unexpected unique_violation (constraint %) minting a job for family % — re-raising original error',
        v_constraint, v_number;
      raise;
    end if;
  end;

  -- ── Budget v1, sourced from estimate_financial_details EXCEPT
  --    approved_revenue (the deviation-12 accepted_price pin) and the
  --    recomputed profit fields (file header: "fully-loaded cost basis").
  v_fully_loaded_cost := round(
    coalesce(v_details.operational_labor_cost, 0) + coalesce(v_details.materials_cost, 0)
    + coalesce(v_details.rentals_cost, 0) + coalesce(v_details.expected_dump_cost, 0)
    + coalesce(v_details.subcontractors_cost, 0) + coalesce(v_details.other_direct_cost, 0)
    + coalesce(v_details.allocated_overhead, 0) + coalesce(v_details.expected_processing_cost, 0),
    2
  );
  v_planned_profit := round(v_state.accepted_price - v_fully_loaded_cost, 2);
  v_planned_profit_pct := case
    when v_state.accepted_price = 0 then 0
    else round((v_planned_profit / v_state.accepted_price) * 100, 2)
  end;
  -- Fix round F8: clamp to the numeric(7,2) column's representable range
  -- (±99999.99) instead of letting a pathological ratio abort the whole
  -- schedule action on a numeric field overflow. See decision 7.
  v_planned_profit_pct := greatest(least(v_planned_profit_pct, 99999.99), -99999.99);

  insert into public.job_budget_versions (
    job_number, version, source_estimate_id, approved_revenue, productive_hours,
    direct_labor_cost, materials_cost, rentals_cost, dump_cost, subcontractors_cost,
    other_direct_cost, allocated_overhead, payment_processing_cost,
    planned_economic_profit, planned_profit_pct, overhead_rate, labor_rate,
    created_by, created_by_name
  ) values (
    v_job.job_number, 1, p_estimate_id, v_state.accepted_price, v_details.productive_hours,
    v_details.operational_labor_cost, v_details.materials_cost, v_details.rentals_cost,
    v_details.expected_dump_cost, v_details.subcontractors_cost, v_details.other_direct_cost,
    v_details.allocated_overhead, v_details.expected_processing_cost,
    v_planned_profit, v_planned_profit_pct, v_target.overhead_rate, v_target.labor_rate,
    p_actor, v_actor_name
  );

  -- ── estimates.job_number, via the EXISTING RPC (not reimplemented) so
  --    the estimate_mutations_audit row is identical to any other
  --    job_number write (task brief, verbatim permission — see file
  --    header).
  perform public.update_estimate_job_number(p_estimate_id, v_job.job_number, p_actor, v_actor_name);

  insert into public.job_events (
    job_number, stage_from, stage_to, function_name, trigger_source,
    ghl_opportunity_id, action_summary, status, payload_in
  ) values (
    v_job.job_number, 5, 6, 'schedule_estimate', 'app_schedule',
    v_ghl_opportunity_id,
    format('Job %s scheduled from estimate family %s by %s', v_job.job_number, v_number, v_actor_name),
    'success',
    jsonb_build_object(
      'estimate_id', p_estimate_id, 'estimate_number', v_number,
      'crew', v_crew, 'start_date', v_start_date, 'end_date', v_end_date
    )
  );

  insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
  values (
    'job.scheduled', 'job', v_job.job_number,
    'job.scheduled:' || v_job.job_number || ':rev1',
    jsonb_build_object(
      'job_number', v_job.job_number, 'crew', v_crew,
      'start_date', v_start_date, 'end_date', v_end_date,
      'calendar_sync_revision', 1
    )
  )
  on conflict (idempotency_key) do nothing;

  -- Fix round F6: only when this family actually has a linked opportunity
  -- — an unlinked family has nothing for the dispatcher to update in GHL,
  -- and enqueueing anyway would create an event that can never succeed.
  if v_ghl_opportunity_id is not null then
    insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
    values (
      'ghl.stage.requested', 'job', v_job.job_number,
      'ghl.stage.requested:' || v_job.job_number || ':rev1',
      jsonb_build_object(
        'stage', 'Job Scheduled', 'job_number', v_job.job_number,
        'ghl_opportunity_id', v_ghl_opportunity_id
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return v_job;
end;
$$;

revoke all on function public.schedule_estimate(uuid, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.schedule_estimate(uuid, jsonb, uuid, text)
  to service_role;
