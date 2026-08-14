-- Fixups for phase_b2_rpcs_audit, from the Task 3 review.
-- The 20260814210000 migration is applied and its estimates/no-delete/
-- line-item-immutability triggers are untouched; corrections land here.
-- Findings: I-1, I-2, M-1, M-2, M-3, M-4, M-5.

-- (I-2) Table CHECK: the override-reason rule was only enforced inside
-- update_estimate_quote — a raw INSERT via create_estimate_with_items could
-- silently store a discounted quoted_price with no reason. Verified before
-- adding: the two live 1414 test rows (estimate_number 1414, versions 1-2)
-- both satisfy this — v1 has quoted_price=999.00/reason='test override'
-- (quoted_price <> total_bid but reason non-blank); v2 has quoted_price
-- NULL (first branch). ALTER TABLE re-validates all existing rows anyway.
alter table public.estimates
  add constraint quote_override_reason_required
  check (
    quoted_price is null
    or quoted_price = total_bid
    or btrim(coalesce(quote_override_reason, '')) <> ''
  );

-- (I-1 + M-1) create_estimate_with_items: wrap every numeric/int/date jsonb
-- cast in nullif(...,'') so empty-string form values fall back to
-- NULL/defaults instead of raising 22P02; nullif quote_override_reason too,
-- so '' stores as NULL (aligns with the new CHECK, which treats NULL and ''
-- the same via coalesce). Also sets app.actor_id/app.actor_name from
-- created_by/created_by_name immediately before the parent-flip UPDATE, so
-- the auto-supersede audit row carries the creating estimator as actor
-- instead of NULL. Same name/signature — CREATE OR REPLACE keeps existing
-- grants (already revoked from public/anon/authenticated by 20260814210000).
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
    created_by_name
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
    p_estimate->>'created_by_name'
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

-- (M-2 + M-3) update_estimate_quote: round p_quoted_price to 2dp before
-- both the comparison and the write (matches the numeric(12,2) column so
-- the equality check behaves the same as the stored value would), and only
-- raise the override-reason exception when p_quoted_price is NOT NULL and
-- differs from total_bid — clearing an override back to NULL never needs a
-- reason. Same name/signature — CREATE OR REPLACE keeps existing grants.
create or replace function public.update_estimate_quote(
  p_id uuid,
  p_quoted_price numeric,
  p_reason text,
  p_actor uuid,
  p_actor_name text
) returns estimates
language plpgsql
set search_path = public
as $$
declare
  v_estimate public.estimates;
  v_total_bid numeric;
begin
  p_quoted_price := round(p_quoted_price, 2);

  select total_bid into v_total_bid from public.estimates where id = p_id;

  if not found then
    raise exception 'estimate % not found', p_id;
  end if;

  if p_quoted_price is not null
    and p_quoted_price is distinct from v_total_bid
    and (p_reason is null or btrim(p_reason) = '')
  then
    raise exception
      'quote_override_reason is required when quoted_price (%) differs from total_bid (%)',
      p_quoted_price, v_total_bid;
  end if;

  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('app.actor_name', coalesce(p_actor_name, ''), true);

  update public.estimates
  set quoted_price = p_quoted_price,
      quote_override_reason = p_reason
  where id = p_id
  returning * into v_estimate;

  return v_estimate;
end;
$$;

-- (M-4) update_estimate_job_number — same shape as the other mutation
-- RPCs (set actor context, single UPDATE), same revoke posture, so a
-- future estimate-to-job promotion never has to issue an actor-less direct
-- UPDATE against estimates.job_number.
create function public.update_estimate_job_number(
  p_id uuid,
  p_job_number text,
  p_actor uuid,
  p_actor_name text
) returns estimates
language plpgsql
set search_path = public
as $$
declare
  v_estimate public.estimates;
begin
  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('app.actor_name', coalesce(p_actor_name, ''), true);

  update public.estimates
  set job_number = p_job_number
  where id = p_id
  returning * into v_estimate;

  if not found then
    raise exception 'estimate % not found', p_id;
  end if;

  return v_estimate;
end;
$$;

revoke all on function public.update_estimate_job_number(uuid, text, uuid, text) from public, anon, authenticated;

-- (M-5) estimate_mutations_audit is an audit trail — same immutability
-- posture as the tables it audits (estimates, estimate_line_items): no
-- legitimate UPDATE or DELETE path exists, ever.
create function public.enforce_estimate_mutations_audit_immutability() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    'estimate_mutations_audit is immutable — audit rows cannot be updated or deleted (row %)',
    coalesce(old.id, new.id);
  return old;
end;
$$;

create trigger estimate_mutations_audit_immutable
  before update or delete on public.estimate_mutations_audit
  for each row execute function public.enforce_estimate_mutations_audit_immutability();

revoke all on function public.enforce_estimate_mutations_audit_immutability() from public, anon, authenticated;
