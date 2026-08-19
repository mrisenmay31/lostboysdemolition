-- Profitability v2 Phase 1, Task 2 (Session 2, Lane 2b) — commercial
-- acceptance lifecycle.
--
-- The four tables + two enums from the v2 spec
-- (docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md,
-- lines 883-935), verbatim, with these approved modifications recorded in
-- docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md:
--
--   Deviation 12 (accepted-price pin at acceptance — resolves the Session 1
--   review escalation, "OPEN DESIGN ITEM for Session 2"): the immutable
--   `estimate_acceptance_events` row is where the accepted commercial price
--   gets pinned, by construction — append-only, so it can never drift after
--   the fact. `estimate_acceptance_events` gains `accepted_price
--   numeric(12,2)`, required (not null) on `accepted` events, and
--   `>= 0` when present. `estimate_acceptance_state` gains its own
--   `accepted_price numeric(12,2)` mirroring the CURRENT acceptance (null
--   whenever `accepted = false`). `record_estimate_acceptance_event` below
--   computes it SERVER-SIDE, inside the row lock, from
--   `coalesce(estimates.quoted_price, estimates.total_bid)` — never from a
--   client-supplied number. This is v2 Task 4's `approved_revenue` source
--   for `job_budget_versions` v1 going forward (Task 4 is a later session;
--   this migration only lays the pin down).
--
--   Deviations 1-4 (phase-1 plan): every multi-overload pgTAP assertion in
--   the companion test file carries a description argument; every new
--   table gets an explicit `revoke ... from public, anon, authenticated`
--   (RLS enabled, no policies — service_role bypasses RLS and keeps default
--   access, Task 8 adds authenticated policies once operational routes
--   exist); `search_path = public, pg_temp` is pinned on every function this
--   migration creates, with EXECUTE revoked from public/anon/authenticated
--   (no explicit service_role grant, matching every RPC in this schema —
--   service_role keeps EXECUTE via Supabase's default per-schema grants);
--   filename uses the 2026-08-19+ prefix so repo ordering matches the
--   applied migration head.
--
-- `customer_authorization_method` already exists
-- (20260819151000_profitability_core_schema.sql, Task 1) and is reused here
-- as-is — not recreated.
--
-- Append-only enforcement (house `enforce_estimate_line_item_immutability`
-- pattern, 20260814160000_phase_b_estimates_fixups.sql — an unconditional
-- raise on UPDATE/DELETE, not a watched-column blacklist like
-- `enforce_estimate_immutability`): applied to `estimate_acceptance_events`
-- ("Do not overwrite or delete an accepted event" — v2 doc, Task 2 Step 6)
-- and `estimate_presentations` (an immutable version/hash snapshot).
-- `estimate_identity_links` and `estimate_acceptance_state` are
-- DELIBERATELY LEFT MUTABLE — they are projections/registries, not
-- event/version history: `estimate_identity_links` is corrected by the app
-- if a link was mis-set (no versioning concept applies to "which GHL
-- contact/opportunity does this estimate family point at"), and
-- `estimate_acceptance_state` is by definition a projection that
-- `record_estimate_acceptance_event` re-derives and overwrites on every new
-- event — that is its entire purpose, so making it immutable would be
-- self-contradictory. The companion test file pins both as
-- currently-trigger-free (vacuous pre-migration; see that file's header).

-- ============================================================
-- 1. Enums.
-- ============================================================
create type public.estimate_acceptance_action as enum ('accepted', 'reversed');
create type public.actor_assurance as enum ('authenticated', 'selected_identity', 'external_webhook');

-- ============================================================
-- 2. Tables.
-- ============================================================

-- Canonical estimate-family (estimate_number) -> GHL contact/opportunity
-- relationship. `ghl_push_state` (20260814220000_phase_b2_ghl_push_state.sql)
-- remains per-VERSION delivery bookkeeping only (estimate-doc IDs, push
-- timestamps, attempts, errors) and is never read as identity authority —
-- this table is (v2 doc, Task 2 Step 6).
create table public.estimate_identity_links (
  estimate_number integer primary key,
  ghl_contact_id text not null,
  ghl_opportunity_id text not null unique,
  linked_by_name text not null,
  actor_assurance public.actor_assurance not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.estimate_identity_links is
  'Canonical estimate-family (estimate_number) -> GHL contact/opportunity link. '
  'One active opportunity per family (ghl_opportunity_id unique). Mutable registry, not '
  'versioned history -- ghl_push_state stays per-version delivery bookkeeping only.';

-- One immutable presentation snapshot per estimate VERSION (unique on
-- estimate_id, not estimate_number) -- presenting a later version creates a
-- new row, it does not touch an earlier version's presentation.
create table public.estimate_presentations (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null unique references public.estimates(id),
  presented_via text not null check (presented_via in ('ghl', 'email', 'print', 'other')),
  presented_by_name text not null,
  actor_assurance public.actor_assurance not null,
  snapshot_hash text not null,
  presented_at timestamptz not null default now()
);

comment on table public.estimate_presentations is
  'Immutable record that a specific estimate VERSION was presented to the customer, with a '
  'content hash of what was shown. One row per estimate_id -- required before that version can '
  'be accepted (record_estimate_acceptance_event enforces this).';

-- Append-only acceptance/reversal event log. Deviation 12: accepted_price
-- pinned at acceptance time, required on 'accepted' events, computed
-- server-side by record_estimate_acceptance_event below.
create table public.estimate_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id),
  action public.estimate_acceptance_action not null,
  authorization_method public.customer_authorization_method,
  customer_contact_name text,
  accepted_price numeric(12, 2) check (accepted_price is null or accepted_price >= 0),
  effective_at timestamptz not null,
  recorded_by_auth_user_id uuid references auth.users(id),
  recorded_by_name text not null,
  actor_assurance public.actor_assurance not null,
  note text not null,
  evidence_paths text[] not null default '{}',
  supersedes_event_id uuid references public.estimate_acceptance_events(id),
  reversal_destination text check (reversal_destination in ('quote_sent', 'closed_lost')),
  created_at timestamptz not null default now(),
  check (
    (action = 'accepted' and authorization_method is not null and customer_contact_name is not null)
    or
    (action = 'reversed' and reversal_destination is not null)
  ),
  -- Deviation 12: the price pin. Kept as its own named constraint, separate
  -- from the action-shape check above, so the companion test file can
  -- assert its existence independently (pg_get_constraintdef, schema-
  -- filtered per the A7 lesson in profitability_core_schema_test.sql).
  constraint estimate_acceptance_events_accepted_price_required_on_accept
    check (action <> 'accepted' or accepted_price is not null)
);

comment on table public.estimate_acceptance_events is
  'Append-only acceptance/reversal event log. Never updated or deleted (house immutability '
  'trigger). accepted_price pins the commercial price at the moment of acceptance (deviation 12) '
  '-- computed server-side by record_estimate_acceptance_event, never trusted from the caller.';

-- Mutable projection: current acceptance state per estimate FAMILY
-- (estimate_number), re-derived by record_estimate_acceptance_event on
-- every event. Scheduling (a later task) reads only this projection, so it
-- can never select a reversed acceptance.
create table public.estimate_acceptance_state (
  estimate_number integer primary key,
  current_estimate_id uuid not null references public.estimates(id),
  accepted boolean not null,
  current_acceptance_event_id uuid references public.estimate_acceptance_events(id),
  accepted_price numeric(12, 2),
  last_event_id uuid not null references public.estimate_acceptance_events(id),
  updated_at timestamptz not null default now(),
  -- Deviation 12 (this migration's own addition, not spec-verbatim):
  -- accepted_price mirrors the current acceptance exactly -- present iff
  -- accepted, absent iff not. record_estimate_acceptance_event maintains
  -- this by construction; the check is DB-level defense-in-depth, matching
  -- the house preference for enforcing invariants at the table over trusting
  -- the one writer to always get it right (see job_checklists' analogous
  -- checklist_type <-> work_complete checks in the Task 1 core-schema
  -- migration).
  constraint estimate_acceptance_state_price_matches_accepted
    check ((accepted and accepted_price is not null) or (not accepted and accepted_price is null))
);

comment on table public.estimate_acceptance_state is
  'Mutable projection of the CURRENT acceptance state per estimate family (estimate_number). '
  'Re-derived on every event by record_estimate_acceptance_event -- this is a registry, not '
  'history; estimate_acceptance_events is the append-only history.';

-- ============================================================
-- 3. Supporting index. estimate_id is a foreign key on
--    estimate_acceptance_events but Postgres does not auto-index FK
--    columns; record_estimate_acceptance_event and the eventual read side
--    both look events up by estimate_id.
-- ============================================================
create index idx_estimate_acceptance_events_estimate_id
  on public.estimate_acceptance_events (estimate_id);

-- ============================================================
-- 4. RLS + explicit revokes (deviation 2) -- enabled, no policies, on all
--    4 tables this migration creates.
-- ============================================================
alter table public.estimate_identity_links enable row level security;
alter table public.estimate_presentations enable row level security;
alter table public.estimate_acceptance_events enable row level security;
alter table public.estimate_acceptance_state enable row level security;

revoke all on table public.estimate_identity_links from public, anon, authenticated;
revoke all on table public.estimate_presentations from public, anon, authenticated;
revoke all on table public.estimate_acceptance_events from public, anon, authenticated;
revoke all on table public.estimate_acceptance_state from public, anon, authenticated;

-- ============================================================
-- 5. Immutability triggers -- estimate_acceptance_events and
--    estimate_presentations only (see header for why identity_links and
--    acceptance_state stay mutable).
-- ============================================================
create function public.enforce_estimate_acceptance_events_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'estimate acceptance events are immutable — do not overwrite or delete an accepted event (id %)',
    coalesce(old.id, new.id);
  return old;
end $$;

create trigger estimate_acceptance_events_immutable
  before update or delete on public.estimate_acceptance_events
  for each row execute function public.enforce_estimate_acceptance_events_immutability();

create function public.enforce_estimate_presentations_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'estimate presentations are immutable — present a new estimate version instead (id %)',
    coalesce(old.id, new.id);
  return old;
end $$;

create trigger estimate_presentations_immutable
  before update or delete on public.estimate_presentations
  for each row execute function public.enforce_estimate_presentations_immutability();

revoke all on function public.enforce_estimate_acceptance_events_immutability() from public, anon, authenticated;
revoke all on function public.enforce_estimate_presentations_immutability() from public, anon, authenticated;

-- ============================================================
-- 6. record_estimate_acceptance_event -- the single write path for
--    estimate_acceptance_events + estimate_acceptance_state.
--
--    Locking (F3, fix round -- lock-order inversion, deadlock reproduced by
--    the reviewer): the brief's literal instruction was "lock the estimate
--    row FOR UPDATE, then widen to the family". The FIRST cut of this
--    function did exactly that -- single-row FOR UPDATE, then a family-wide
--    FOR UPDATE -- and two concurrent acceptances on two DIFFERENT versions
--    of the SAME family deadlocked: session A locks v1 then waits on the
--    family scan (which includes v2, held by B); session B locks v2 then
--    waits on the family scan (which includes v1, held by A). Classic lock-
--    order inversion. Fixed per the reviewer's verified pattern: resolve
--    estimate_number FIRST with an UNLOCKED read (estimate_number is an
--    immutable column -- see enforce_estimate_immutability -- so an
--    unlocked read of it is always consistent), THEN take the family lock
--    ONCE, in a single deterministic order (`where estimate_number = v_number
--    order by id for update`), and read every column this function needs
--    (id, estimate_number, status, quoted_price, total_bid) off THAT same
--    locked scan -- no second lock. Every concurrent caller against one
--    family now acquires the same rows in the same order, so two calls on
--    different versions can never deadlock against each other. The
--    reviewer verified this exact pattern deadlock-free with concurrent
--    sessions.
--
--    Still true, and still the reason a family-wide lock is taken instead
--    of a single-row lock: estimate_acceptance_state is keyed by
--    estimate_number (the family), not estimate_id (one specific version)
--    -- two concurrent calls against two different versions of the same
--    family would not block each other under a single-row lock, and could
--    race on the estimate_acceptance_state upsert below. Locking the whole
--    family (which, since estimates rows are never updated by any other
--    writer, costs nothing beyond a normal row lock) closes that gap.
--
--    NOTE (F2, fix round): a double-reverse retry -- calling this function
--    with action='reversed' a second time against a family whose
--    acceptance was already reversed -- now RAISES ("no active acceptance
--    to reverse") instead of silently no-oping. The earlier version's
--    upsert-only reversal branch had no such guard, so a stale-tab or
--    retried reversal against a NEVER-accepted version could silently wipe
--    the family's live acceptance and repoint current_estimate_id at a
--    version nobody ever accepted. Callers (lane 2d's
--    reverseEstimateAcceptance in particular) must handle this raise
--    deliberately rather than treating it as an idempotent no-op.
-- ============================================================
create function public.record_estimate_acceptance_event(
  p_event jsonb
) returns public.estimate_acceptance_events
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_event public.estimate_acceptance_events;
  v_number int;
  v_target record;
  v_found_target boolean := false;
  v_row record;
  v_state record;
  v_estimate_id uuid;
  v_action_text text;
  v_action public.estimate_acceptance_action;
  v_recorded_by_name text;
  v_actor_assurance_text text;
  v_actor_assurance public.actor_assurance;
  v_note text;
  v_accepted_price numeric(12, 2);
  v_evidence_paths text[];
  v_supersedes_event_id uuid;
begin
  -- Required-field guards up front, house pattern (A8 in
  -- mark_job_reconciliation_required, 20260819151000_profitability_core_schema.sql):
  -- a NULL/missing argument is a caller bug and must surface immediately and
  -- clearly here, not three layers away as an opaque NOT NULL violation.
  v_estimate_id := nullif(p_event->>'estimate_id', '')::uuid;
  if v_estimate_id is null then
    raise exception 'record_estimate_acceptance_event: estimate_id is required';
  end if;

  v_action_text := nullif(p_event->>'action', '');
  if v_action_text is null then
    raise exception 'record_estimate_acceptance_event: action is required';
  end if;
  -- Cast validates legality of the value: an illegal action raises a clear
  -- native Postgres "invalid input value for enum" error immediately.
  v_action := v_action_text::public.estimate_acceptance_action;

  v_recorded_by_name := nullif(p_event->>'recorded_by_name', '');
  if v_recorded_by_name is null then
    raise exception 'record_estimate_acceptance_event: recorded_by_name is required';
  end if;

  v_actor_assurance_text := nullif(p_event->>'actor_assurance', '');
  if v_actor_assurance_text is null then
    raise exception 'record_estimate_acceptance_event: actor_assurance is required';
  end if;
  -- Same validate-via-cast pattern: an illegal actor_assurance value raises
  -- immediately, satisfying "validate actor_assurance is a legal enum
  -- value" from the task brief.
  v_actor_assurance := v_actor_assurance_text::public.actor_assurance;

  v_note := nullif(p_event->>'note', '');
  if v_note is null then
    raise exception 'record_estimate_acceptance_event: note is required';
  end if;

  -- F3: resolve the family FIRST, unlocked -- see function header. Fails
  -- fast with a clean "not found" if the id is simply wrong, before taking
  -- any lock at all.
  select estimate_number into v_number
    from public.estimates
   where id = v_estimate_id;

  if not found then
    raise exception 'record_estimate_acceptance_event: estimate % not found', v_estimate_id;
  end if;

  -- F3: the ONE lock this function takes -- every row in the family, in a
  -- single deterministic (order by id) scan. Reads every column later logic
  -- needs (status for F1, quoted_price/total_bid for the price pin) off
  -- this same locked scan; no second lock is taken anywhere below.
  for v_row in
    select id, estimate_number, status, quoted_price, total_bid
      from public.estimates
     where estimate_number = v_number
     order by id
     for update
  loop
    if v_row.id = v_estimate_id then
      v_target := v_row;
      v_found_target := true;
    end if;
  end loop;

  -- Guard via the boolean flag, never by reading a field off v_target
  -- directly: a PL/pgSQL `record` variable that has never been assigned a
  -- row raises "record ... is not assigned yet" on field access, rather
  -- than evaluating the field as NULL -- so `v_target.id is null` would
  -- itself be the wrong kind of unsafe here if this branch were ever hit.
  if not v_found_target then
    -- Defensive, should be unreachable: v_estimate_id resolved to v_number
    -- moments ago and estimates rows are never deleted (enforce_estimate_no_delete),
    -- so the family scan above must include it. Guarded rather than trusted.
    raise exception 'record_estimate_acceptance_event: estimate % not found in family % after lock', v_estimate_id, v_number;
  end if;

  -- F13: supersedes_event_id, when supplied, must reference an existing
  -- event belonging to THIS SAME estimate family -- not a dangling id, and
  -- not an event that happens to belong to a different family (which the FK
  -- to estimate_acceptance_events alone would never catch, since the FK only
  -- proves the id exists SOMEWHERE, not that it exists in this family).
  v_supersedes_event_id := nullif(p_event->>'supersedes_event_id', '')::uuid;
  if v_supersedes_event_id is not null and not exists (
    select 1
      from public.estimate_acceptance_events e
      join public.estimates es on es.id = e.estimate_id
     where e.id = v_supersedes_event_id
       and es.estimate_number = v_number
  ) then
    raise exception
      'record_estimate_acceptance_event: supersedes_event_id % does not reference an existing event in estimate family %',
      v_supersedes_event_id, v_number;
  end if;

  if v_action = 'accepted' then
    -- v2 doc, Task 2 Step 6: "validates the estimate exists and (for
    -- 'accepted') that a presentation row exists for that estimate version."
    if not exists (
      select 1 from public.estimate_presentations where estimate_id = v_estimate_id
    ) then
      raise exception
        'record_estimate_acceptance_event: estimate % has not been presented — a presentation row is required before acceptance',
        v_estimate_id;
    end if;

    -- F1 (fix round, MAJOR, demonstrated): a superseded version could be
    -- accepted -- the stale-tab path is a documented live limitation on the
    -- estimates UI (see CLAUDE.md, "Two known limitations" under Phase B
    -- slice-2), but pinning a wrong price into the immutable acceptance
    -- event log makes that mistake PERMANENT, unlike the UI-only mutation
    -- gap it rides in on. Block it here, not just in the app.
    if v_target.status = 'superseded' then
      raise exception 'record_estimate_acceptance_event: estimate % is superseded — accept the current version', v_estimate_id;
    end if;

    -- F5 (fix round, MINOR, demonstrated): the two conditionally-required
    -- columns on an 'accepted' event (estimate_acceptance_events' own CHECK
    -- constraint) were previously validated only by that CHECK, which dumps
    -- its full constraint definition into the error on violation. Same A8
    -- pattern as the guards above -- surface a clean, one-line message here
    -- instead.
    if nullif(p_event->>'authorization_method', '') is null then
      raise exception 'record_estimate_acceptance_event: authorization_method is required for an accepted event';
    end if;
    if nullif(p_event->>'customer_contact_name', '') is null then
      raise exception 'record_estimate_acceptance_event: customer_contact_name is required for an accepted event';
    end if;
  end if;

  if v_action = 'reversed' then
    -- F2 (fix round, MAJOR, demonstrated): a reversal against a
    -- non-accepted version previously fell straight through to the upsert
    -- below with no precondition at all -- silently wiping the family's
    -- live acceptance (accepted -> false) and repointing current_estimate_id
    -- at whatever version the caller named, even a version that was NEVER
    -- accepted. Lock the family's acceptance_state row and validate before
    -- writing anything.
    select current_estimate_id, accepted
      into v_state
      from public.estimate_acceptance_state
     where estimate_number = v_number
     for update;

    if not found or not v_state.accepted then
      raise exception 'record_estimate_acceptance_event: no active acceptance to reverse (estimate family %)', v_number;
    end if;

    if v_state.current_estimate_id is distinct from v_estimate_id then
      raise exception
        'record_estimate_acceptance_event: estimate % is not the accepted version (accepted version is %)',
        v_estimate_id, v_state.current_estimate_id;
    end if;
  end if;

  -- Deviation 12: computed SERVER-SIDE inside the lock, from the estimate
  -- row itself -- never trusted from the caller. Only meaningful for
  -- 'accepted'; a 'reversed' event carries no price (the accepted_price
  -- check constraint above enforces exactly this shape).
  v_accepted_price := case
    when v_action = 'accepted' then coalesce(v_target.quoted_price, v_target.total_bid)
    else null
  end;

  -- F4 (fix round, MINOR, demonstrated): `{"evidence_paths": null}` used to
  -- reach jsonb_array_elements_text() on a JSON `null` scalar, which raises
  -- an opaque "cannot extract elements from a scalar" error -- correct
  -- Postgres behavior, but a confusing failure for a caller that simply
  -- omitted the field. nullif(..., 'null'::jsonb) collapses the JSON `null`
  -- shape down to SQL NULL first, so coalesce falls through to '[]'::jsonb
  -- cleanly, same as the field being absent entirely. (F11: the previous
  -- outer `coalesce(array(...), '{}'::text[])` was dead code -- `array()`
  -- over an empty set-returning subquery already yields '{}', never SQL
  -- NULL, so that outer coalesce could never fire. Dropped.)
  v_evidence_paths := array(
    select jsonb_array_elements_text(coalesce(nullif(p_event->'evidence_paths', 'null'::jsonb), '[]'::jsonb))
  );

  insert into public.estimate_acceptance_events (
    estimate_id,
    action,
    authorization_method,
    customer_contact_name,
    accepted_price,
    effective_at,
    recorded_by_auth_user_id,
    recorded_by_name,
    actor_assurance,
    note,
    evidence_paths,
    supersedes_event_id,
    reversal_destination
  ) values (
    v_estimate_id,
    v_action,
    nullif(p_event->>'authorization_method', '')::public.customer_authorization_method,
    nullif(p_event->>'customer_contact_name', ''),
    v_accepted_price,
    coalesce((nullif(p_event->>'effective_at', ''))::timestamptz, now()),
    nullif(p_event->>'recorded_by_auth_user_id', '')::uuid,
    v_recorded_by_name,
    v_actor_assurance,
    v_note,
    v_evidence_paths,
    nullif(p_event->>'supersedes_event_id', '')::uuid,
    nullif(p_event->>'reversal_destination', '')
  )
  returning * into v_event;

  -- Upsert the estimate_acceptance_state projection for the FAMILY
  -- (estimate_number, not estimate_id). current_estimate_id is set to this
  -- event's estimate_id on BOTH branches (it is NOT NULL and there is no
  -- other value that makes sense to carry): on 'accepted' it is "the exact
  -- presented current_estimate_id" the spec calls for; on 'reversed' it is
  -- (by the caller's own contract -- reverseEstimateAcceptance passes the
  -- currently-accepted estimate's id) the same version the state row
  -- already pointed at, so this is a same-value overwrite in the normal
  -- case and a harmless correction otherwise. Re-acceptance after a
  -- reversal appends a new event and re-points current_estimate_id /
  -- current_acceptance_event_id / accepted_price to the newly accepted
  -- version, exactly as the v2 doc specifies.
  insert into public.estimate_acceptance_state (
    estimate_number,
    current_estimate_id,
    accepted,
    current_acceptance_event_id,
    accepted_price,
    last_event_id,
    updated_at
  ) values (
    v_number,
    v_estimate_id,
    v_action = 'accepted',
    case when v_action = 'accepted' then v_event.id else null end,
    v_accepted_price,
    v_event.id,
    now()
  )
  on conflict (estimate_number) do update set
    current_estimate_id = excluded.current_estimate_id,
    accepted = excluded.accepted,
    current_acceptance_event_id = excluded.current_acceptance_event_id,
    accepted_price = excluded.accepted_price,
    last_event_id = excluded.last_event_id,
    updated_at = excluded.updated_at;

  return v_event;
end;
$$;

revoke all on function public.record_estimate_acceptance_event(jsonb)
  from public, anon, authenticated;

-- ============================================================
-- 7. estimate_identity_links backfill -- deterministic, idempotent.
--
-- For each estimate FAMILY (estimate_number) that has ghl_push_state rows
-- with both ghl_contact_id and ghl_opportunity_id populated AND shaped like
-- real GHL ids (F9, see Step 0), seed one estimate_identity_links row from
-- the most recent such row (order by fields_pushed_at desc nulls last, then
-- updated_at desc). If the rows within one family DISAGREE on contact or
-- opportunity id, never guess -- skip that family entirely and name it in a
-- raise notice (Step 1). Re-running this block is a no-op against
-- already-linked families (`on conflict do nothing`, with no explicit
-- conflict target so it catches BOTH the estimate_number PK and the
-- ghl_opportunity_id unique constraint -- see Step 2 for why that matters).
--
-- Live input at authoring time: 10 ghl_push_state rows, all against TEST
-- estimates (phase-1 plan, "Verified live facts") -- one of which (family
-- 1421) is the T12 negative fixture, opportunity id
-- 'nonexistent-opportunity-id-12345', deliberately shaped unlike a real GHL
-- id (contains hyphens; real GHL ids are ~20 plain alphanumeric characters)
-- and excluded by Step 0's shape filter (F9).
--
-- F9 shape filter, repeated identically in every step below so the notices
-- and the insert stay in agreement about which rows are even candidates:
-- `gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$' and
--  gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'`.
--
-- F7 (post-apply verification -- NOTICEs are invisible under MCP apply, so
-- this is the only way to confirm the backfill did what it says; the
-- applier MUST run this after applying this migration):
--
--   with family_variants as (
--     select e.estimate_number,
--            count(distinct gps.ghl_contact_id) as contact_variants,
--            count(distinct gps.ghl_opportunity_id) as opportunity_variants
--       from public.ghl_push_state gps
--       join public.estimates e on e.id = gps.estimate_id
--      where gps.ghl_contact_id is not null
--        and gps.ghl_opportunity_id is not null
--        and gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
--        and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
--      group by e.estimate_number
--   ),
--   candidates as (
--     select distinct on (e.estimate_number) e.estimate_number
--       from public.ghl_push_state gps
--       join public.estimates e on e.id = gps.estimate_id
--       join family_variants fv
--         on fv.estimate_number = e.estimate_number
--        and fv.contact_variants = 1
--        and fv.opportunity_variants = 1
--      where gps.ghl_contact_id is not null
--        and gps.ghl_opportunity_id is not null
--        and gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
--        and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
--   )
--   select
--     (select count(*) from candidates) as candidate_families,
--     (select count(*) from public.estimate_identity_links) as seeded_rows,
--     (select count(*) from candidates c
--        left join public.estimate_identity_links l
--          on l.estimate_number = c.estimate_number
--       where l.estimate_number is null) as candidates_not_seeded;
--
-- Expect candidates_not_seeded = 0 in the common case (no ghl_opportunity_id
-- collision across families, and no pre-existing link already claiming an
-- estimate_number under different data). A nonzero value means the F6
-- notice below fired for a real collision and needs a human look, not a
-- re-run.
-- ============================================================

-- Step 0 (F9): report families whose ghl_push_state rows are ALL excluded
-- by the GHL-id shape filter -- read-only, diagnostic only; the actual
-- exclusion happens via the repeated WHERE-clause filter in Steps 1-2.
-- Known to exclude exactly one family today: 1421 (the T12 negative
-- fixture, see header).
do $$
declare
  v_excluded record;
begin
  for v_excluded in
    select distinct e.estimate_number, gps.ghl_contact_id, gps.ghl_opportunity_id
      from public.ghl_push_state gps
      join public.estimates e on e.id = gps.estimate_id
     where gps.ghl_contact_id is not null
       and gps.ghl_opportunity_id is not null
       and not (
         gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
         and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
       )
  loop
    raise notice
      'estimate_identity_links backfill: excluding family % from consideration — ghl_push_state row fails the GHL-id shape filter (contact=%, opportunity=%); known test garbage (e.g. family 1421''s T12 negative fixture) is excluded by design',
      v_excluded.estimate_number, v_excluded.ghl_contact_id, v_excluded.ghl_opportunity_id;
  end loop;
end $$;

-- Step 1: report (not block) any disagreeing families, among rows that pass
-- the Step 0 shape filter. Read-only, no side effects beyond the notice --
-- purely diagnostic, run before the insert so the notices appear even if a
-- later statement in this file were to fail.
do $$
declare
  v_family record;
begin
  for v_family in
    select e.estimate_number,
           count(distinct gps.ghl_contact_id) as contact_variants,
           count(distinct gps.ghl_opportunity_id) as opportunity_variants
      from public.ghl_push_state gps
      join public.estimates e on e.id = gps.estimate_id
     where gps.ghl_contact_id is not null
       and gps.ghl_opportunity_id is not null
       and gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
       and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
     group by e.estimate_number
    having count(distinct gps.ghl_contact_id) > 1
        or count(distinct gps.ghl_opportunity_id) > 1
  loop
    raise notice
      'estimate_identity_links backfill: skipping estimate family % — ghl_push_state rows disagree (% contact id variant(s), % opportunity id variant(s)), not guessing',
      v_family.estimate_number, v_family.contact_variants, v_family.opportunity_variants;
  end loop;
end $$;

-- Step 2: insert the one most-recent, agreeing, shape-valid row per family.
--
-- `on conflict do nothing` deliberately names NO conflict target, so it
-- catches a unique violation on EITHER of estimate_identity_links' two
-- unique constraints: the estimate_number primary key (re-run safety) AND
-- the ghl_opportunity_id unique constraint (two different families that
-- both resolve, post-dedup, to the same opportunity id -- the second one
-- in insertion order is skipped rather than erroring; PostgreSQL's
-- multi-row INSERT ... SELECT ... ON CONFLICT DO NOTHING checks each
-- candidate row against rows already inserted earlier in the SAME
-- statement, not only against pre-existing table rows, so this also
-- self-dedups within one run -- no separate pre-dedup pass is needed).
-- This is the task brief's explicitly-sanctioned alternative to
-- pre-deduping the query ("handle with on conflict do nothing on both
-- conflict targets or pre-dedup in the backfill query").
with family_variants as (
  select e.estimate_number,
         count(distinct gps.ghl_contact_id) as contact_variants,
         count(distinct gps.ghl_opportunity_id) as opportunity_variants
    from public.ghl_push_state gps
    join public.estimates e on e.id = gps.estimate_id
   where gps.ghl_contact_id is not null
     and gps.ghl_opportunity_id is not null
     and gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
     and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
   group by e.estimate_number
),
candidates as (
  select e.estimate_number,
         gps.ghl_contact_id,
         gps.ghl_opportunity_id,
         gps.fields_pushed_at,
         gps.updated_at
    from public.ghl_push_state gps
    join public.estimates e on e.id = gps.estimate_id
    join family_variants fv
      on fv.estimate_number = e.estimate_number
     and fv.contact_variants = 1
     and fv.opportunity_variants = 1
   where gps.ghl_contact_id is not null
     and gps.ghl_opportunity_id is not null
     and gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
     and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
)
insert into public.estimate_identity_links (
  estimate_number, ghl_contact_id, ghl_opportunity_id, linked_by_name, actor_assurance
)
select distinct on (estimate_number)
  estimate_number,
  ghl_contact_id,
  ghl_opportunity_id,
  'backfill-20260819',
  'external_webhook'::public.actor_assurance
from candidates
order by estimate_number, fields_pushed_at desc nulls last, updated_at desc
on conflict do nothing;

-- Step 3 (F6): report any candidate family that STILL did not make it into
-- estimate_identity_links after Step 2 -- i.e. it had a clean, undisputed,
-- shape-valid candidate row but lost the ghl_opportunity_id unique-index
-- race to another family within the same statement (two different families
-- whose most-recent-agreeing row names the SAME opportunity id; only the
-- first in insertion order survives Step 2's ON CONFLICT DO NOTHING).
-- Without this, that family is silently dropped with no diagnostic signal
-- at all -- worse than Steps 0-1, which at least explain their exclusions.
do $$
declare
  v_lost record;
begin
  for v_lost in
    with family_variants as (
      select e.estimate_number,
             count(distinct gps.ghl_contact_id) as contact_variants,
             count(distinct gps.ghl_opportunity_id) as opportunity_variants
        from public.ghl_push_state gps
        join public.estimates e on e.id = gps.estimate_id
       where gps.ghl_contact_id is not null
         and gps.ghl_opportunity_id is not null
         and gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
         and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
       group by e.estimate_number
    ),
    candidates as (
      select distinct on (e.estimate_number)
             e.estimate_number,
             gps.ghl_opportunity_id
        from public.ghl_push_state gps
        join public.estimates e on e.id = gps.estimate_id
        join family_variants fv
          on fv.estimate_number = e.estimate_number
         and fv.contact_variants = 1
         and fv.opportunity_variants = 1
       where gps.ghl_contact_id is not null
         and gps.ghl_opportunity_id is not null
         and gps.ghl_contact_id ~ '^[A-Za-z0-9]{15,}$'
         and gps.ghl_opportunity_id ~ '^[A-Za-z0-9]{15,}$'
       order by e.estimate_number, gps.fields_pushed_at desc nulls last, gps.updated_at desc
    )
    select c.estimate_number, c.ghl_opportunity_id
      from candidates c
      left join public.estimate_identity_links l on l.estimate_number = c.estimate_number
     where l.estimate_number is null
  loop
    raise notice
      'estimate_identity_links backfill: family % was NOT linked — lost the ghl_opportunity_id % unique-index race to another family (or a pre-existing link already claimed this estimate_number); see the F7 verification query',
      v_lost.estimate_number, v_lost.ghl_opportunity_id;
  end loop;
end $$;
