-- Phase B slice 2, Task B1: persist Path B — is_path_b column end-to-end.
--
-- Path B (see CLAUDE.md "Key Rules") is a trusted-contractor engagement
-- with no formal proposal sent to the client; an internal estimate is
-- still always created so every job keeps a variance baseline. Until now
-- that distinction lived nowhere in the schema — this migration adds the
-- column and the one write path (create_estimate_with_items) that needs
-- to know about it. Task 12's decideDocPreflight (GHL push orchestration)
-- reads this column to skip pushing the customer-facing doc for Path B
-- estimates.
--
-- Immutability: is_path_b IS added to enforce_estimate_immutability's
-- watched-column list below, following the created_by/created_by_name
-- precedent in 20260814200000_phase_b2_estimator_columns.sql. That list is
-- a blacklist of columns the trigger blocks from changing after insert —
-- status / quoted_price / quote_override_reason / job_number are
-- deliberately left off it so the three mutation RPCs can update them.
-- is_path_b is not one of those four mutable columns (no RPC ever assigns
-- it after insert), so per the created_by precedent it belongs on the
-- watched list for DB-level defense-in-depth, not left off it. (Controller
-- ruling, fix report in task-B1-report.md: an earlier draft of this
-- migration left is_path_b off the watched list, reasoning it was
-- "immutable in practice" because no RPC writes it post-insert — correct
-- as far as it went, but insufficient, since that reasoning would apply
-- equally to created_by/created_by_name and they were deliberately given
-- the stronger DB-level guarantee instead.)

alter table public.estimates
  add column is_path_b boolean not null default false;

-- create_estimate_with_items — identical body to the 20260814215000 fixups
-- version (the live function), with is_path_b added to the insert column
-- list and valued via the same nullif/coalesce pattern the rest of the
-- function already uses for optional jsonb inputs: an explicit true/false
-- from the caller wins, absent/empty-string defaults to false, matching
-- the column's own `not null default false`.
create or replace function public.create_estimate_with_items(
  p_estimate jsonb,
  p_line_items jsonb default '[]'::jsonb
) returns estimates
language plpgsql
set search_path = public
as $$
declare
  v_estimate public.estimates;
  v_supersedes uuid;
  v_item jsonb;
begin
  v_supersedes := nullif(p_estimate->>'supersedes_estimate_id', '')::uuid;

  insert into public.estimates (
    estimate_number,
    version,
    supersedes_estimate_id,
    status,
    job_number,
    job_name,
    client_name,
    client_type,
    client_email,
    client_phone,
    job_address,
    city,
    job_type,
    estimate_date,
    job_details,
    labor_method,
    total_job_hours,
    days_at_job,
    num_employees,
    dump_count,
    job_specific_costs,
    markup_pct,
    labor_rate,
    overhead_rate,
    dump_rate,
    cc_fee_rate,
    labor_cost,
    dump_fees,
    total_direct,
    overhead,
    profit,
    cc_fee,
    total_bid,
    true_margin_pct,
    quoted_price,
    quote_override_reason,
    source,
    airtable_estimate_id,
    created_by,
    created_by_name,
    is_path_b
  )
  values (
    -- writer contract: explicit estimate_number wins; otherwise nextval.
    -- coalesce short-circuits, so nextval only fires when actually needed.
    coalesce((nullif(p_estimate->>'estimate_number', ''))::int, nextval('estimate_number_seq')::int),
    coalesce((nullif(p_estimate->>'version', ''))::int, 1),
    v_supersedes,
    coalesce((nullif(p_estimate->>'status', ''))::estimate_status, 'draft'::estimate_status),
    nullif(p_estimate->>'job_number', ''),
    p_estimate->>'job_name',
    p_estimate->>'client_name',
    p_estimate->>'client_type',
    p_estimate->>'client_email',
    p_estimate->>'client_phone',
    p_estimate->>'job_address',
    p_estimate->>'city',
    p_estimate->>'job_type',
    coalesce((nullif(p_estimate->>'estimate_date', ''))::date, current_date),
    p_estimate->>'job_details',
    p_estimate->>'labor_method',
    (nullif(p_estimate->>'total_job_hours', ''))::numeric,
    (nullif(p_estimate->>'days_at_job', ''))::numeric,
    (nullif(p_estimate->>'num_employees', ''))::numeric,
    coalesce((nullif(p_estimate->>'dump_count', ''))::numeric, 0),
    coalesce((nullif(p_estimate->>'job_specific_costs', ''))::numeric, 0),
    (nullif(p_estimate->>'markup_pct', ''))::numeric,
    (nullif(p_estimate->>'labor_rate', ''))::numeric,
    (nullif(p_estimate->>'overhead_rate', ''))::numeric,
    (nullif(p_estimate->>'dump_rate', ''))::numeric,
    (nullif(p_estimate->>'cc_fee_rate', ''))::numeric,
    (nullif(p_estimate->>'labor_cost', ''))::numeric,
    (nullif(p_estimate->>'dump_fees', ''))::numeric,
    (nullif(p_estimate->>'total_direct', ''))::numeric,
    (nullif(p_estimate->>'overhead', ''))::numeric,
    (nullif(p_estimate->>'profit', ''))::numeric,
    (nullif(p_estimate->>'cc_fee', ''))::numeric,
    (nullif(p_estimate->>'total_bid', ''))::numeric,
    (nullif(p_estimate->>'true_margin_pct', ''))::numeric,
    (nullif(p_estimate->>'quoted_price', ''))::numeric,
    nullif(p_estimate->>'quote_override_reason', ''),
    coalesce(p_estimate->>'source', 'app'),
    (nullif(p_estimate->>'airtable_estimate_id', ''))::int,
    nullif(p_estimate->>'created_by', '')::uuid,
    p_estimate->>'created_by_name',
    coalesce((p_estimate->>'is_path_b')::boolean, false)
  )
  returning * into v_estimate;

  for v_item in select * from jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb))
  loop
    insert into public.estimate_line_items (
      estimate_id,
      scope_library_id,
      name,
      description,
      labor_hours,
      dump_count,
      materials_cost,
      sort_order
    ) values (
      v_estimate.id,
      nullif(v_item->>'scope_library_id', '')::uuid,
      v_item->>'name',
      coalesce(v_item->>'description', ''),
      coalesce((nullif(v_item->>'labor_hours', ''))::numeric, 0),
      coalesce((nullif(v_item->>'dump_count', ''))::numeric, 0),
      coalesce((nullif(v_item->>'materials_cost', ''))::numeric, 0),
      coalesce((nullif(v_item->>'sort_order', ''))::int, 0)
    );
  end loop;

  if v_supersedes is not null then
    -- (I-1) actor for the auto-supersede flip comes from the estimate
    -- payload's own created_by/created_by_name, not RPC parameters — this
    -- function has none.
    perform set_config('app.actor_id', coalesce(nullif(p_estimate->>'created_by', ''), ''), true);
    perform set_config('app.actor_name', coalesce(nullif(p_estimate->>'created_by_name', ''), ''), true);

    update public.estimates
    set status = 'superseded'
    where id = v_supersedes
      and status <> 'superseded';
  end if;

  return v_estimate;
end;
$$;

-- Re-create the guard with the same name/signature/search_path pin as
-- 20260814200000_phase_b2_estimator_columns.sql — CREATE OR REPLACE keeps
-- the existing estimates_immutable trigger binding. Full existing
-- watched-column list, unchanged, plus is_path_b appended. Mutable set
-- stays exactly: status, quoted_price, quote_override_reason, job_number.
create or replace function public.enforce_estimate_immutability() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id                    is distinct from old.id
    or new.estimate_number     is distinct from old.estimate_number
    or new.version             is distinct from old.version
    or new.supersedes_estimate_id is distinct from old.supersedes_estimate_id
    or new.job_name            is distinct from old.job_name
    or new.client_name         is distinct from old.client_name
    or new.client_type         is distinct from old.client_type
    or new.client_email        is distinct from old.client_email
    or new.client_phone        is distinct from old.client_phone
    or new.job_address         is distinct from old.job_address
    or new.city                is distinct from old.city
    or new.job_type            is distinct from old.job_type
    or new.estimate_date       is distinct from old.estimate_date
    or new.job_details         is distinct from old.job_details
    or new.labor_method        is distinct from old.labor_method
    or new.total_job_hours     is distinct from old.total_job_hours
    or new.days_at_job         is distinct from old.days_at_job
    or new.num_employees       is distinct from old.num_employees
    or new.dump_count          is distinct from old.dump_count
    or new.job_specific_costs  is distinct from old.job_specific_costs
    or new.markup_pct          is distinct from old.markup_pct
    or new.labor_rate          is distinct from old.labor_rate
    or new.overhead_rate       is distinct from old.overhead_rate
    or new.dump_rate           is distinct from old.dump_rate
    or new.cc_fee_rate         is distinct from old.cc_fee_rate
    or new.labor_cost          is distinct from old.labor_cost
    or new.dump_fees           is distinct from old.dump_fees
    or new.total_direct        is distinct from old.total_direct
    or new.overhead            is distinct from old.overhead
    or new.profit              is distinct from old.profit
    or new.cc_fee              is distinct from old.cc_fee
    or new.total_bid           is distinct from old.total_bid
    or new.true_margin_pct     is distinct from old.true_margin_pct
    or new.source              is distinct from old.source
    or new.airtable_estimate_id is distinct from old.airtable_estimate_id
    or new.created_at          is distinct from old.created_at
    or new.created_by          is distinct from old.created_by
    or new.created_by_name     is distinct from old.created_by_name
    or new.is_path_b           is distinct from old.is_path_b
  then
    raise exception 'estimates are immutable — write a new version row instead (estimate %)', old.estimate_number;
  end if;
  return new;
end $$;
