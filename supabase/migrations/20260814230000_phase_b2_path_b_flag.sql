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
-- Immutability: is_path_b is NOT added to enforce_estimate_immutability's
-- watched-column list (see 20260814200000_phase_b2_estimator_columns.sql,
-- the current definition). That list is a blacklist of columns the
-- trigger blocks from changing after insert — status / quoted_price /
-- quote_override_reason / job_number are deliberately left off it so the
-- three mutation RPCs can update them. is_path_b is likewise left off,
-- but for the opposite reason: not because it should be mutable, but
-- because none of the four mutation RPCs (update_estimate_status,
-- update_estimate_quote, update_estimate_job_number, and the parent-flip
-- inside create_estimate_with_items) ever assign it, so no write path to
-- change it after insert exists in the app layer. It is immutable in
-- practice, not by trigger enforcement. This mirrors how the schema
-- treated every other snapshot-at-insert column (labor_rate, total_bid,
-- etc.) before created_by/created_by_name were explicitly added to the
-- watched list in 20260814200000 — is_path_b is not being given that same
-- explicit protection here because the brief for this task scoped only
-- the column + create_estimate_with_items, not a change to the
-- immutability trigger. A future hardening pass could add it to the
-- watched list for defense-in-depth, matching the created_by precedent.

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
