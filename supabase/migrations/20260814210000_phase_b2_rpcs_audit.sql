-- Phase B slice 2: estimate write RPCs + mutation audit trail.
--
-- The estimates/estimate_line_items tables (phase_b_estimates_schema +
-- fixups + fixups2) are immutable by trigger with no policies, so the app
-- can only write through these RPCs. All three are security-definer-free
-- (default invoker rights) and revoked from public/anon/authenticated below
-- so they are reachable only by service_role — matching table RLS posture.
--
-- Writer contract (see estimates.version_chain, fixups2):
--   version 1  -> supersedes_estimate_id optional/null, estimate_number
--                 defaults via nextval('estimate_number_seq') when the
--                 caller omits it.
--   version >1 -> caller passes the parent row's estimate_number explicitly
--                 and supersedes_estimate_id = parent id; version_chain
--                 enforces the latter, unique(estimate_number, version)
--                 double-enforces against a duplicate/racing version insert.
--
-- Actor identity: update_estimate_status / update_estimate_quote call
-- set_config('app.actor_id'/'app.actor_name', ..., true) (transaction-local)
-- before their UPDATE; the AFTER UPDATE trigger below reads it back via
-- current_setting(..., true). This works because all writes flow through
-- these RPCs on service-role connections — there is no auth.uid() to fall
-- back on here.

-- 1. Audit table. RLS enabled, no policies (service_role bypasses; anon
--    denied) — same posture as every other table in this schema.
create table public.estimate_mutations_audit (
  id bigint generated always as identity primary key,
  estimate_id uuid not null references public.estimates(id),
  changed_at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  old_status estimate_status,
  new_status estimate_status,
  old_quoted_price numeric(12,2),
  new_quoted_price numeric(12,2),
  old_quote_override_reason text,
  new_quote_override_reason text,
  old_job_number text,
  new_job_number text
);

alter table public.estimate_mutations_audit enable row level security;

create index estimate_mutations_audit_estimate_idx
  on public.estimate_mutations_audit (estimate_id);

-- 2. Audit trigger — fires only when one of the four mutable columns
--    actually changed (these are exactly the columns
--    enforce_estimate_immutability lets through after insert).
create function public.audit_estimate_mutation() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status
    or new.quoted_price is distinct from old.quoted_price
    or new.quote_override_reason is distinct from old.quote_override_reason
    or new.job_number is distinct from old.job_number
  then
    insert into public.estimate_mutations_audit (
      estimate_id, actor_id, actor_name,
      old_status, new_status,
      old_quoted_price, new_quoted_price,
      old_quote_override_reason, new_quote_override_reason,
      old_job_number, new_job_number
    ) values (
      new.id,
      nullif(current_setting('app.actor_id', true), '')::uuid,
      nullif(current_setting('app.actor_name', true), ''),
      old.status, new.status,
      old.quoted_price, new.quoted_price,
      old.quote_override_reason, new.quote_override_reason,
      old.job_number, new.job_number
    );
  end if;
  return new;
end;
$$;

create trigger estimates_audit_mutation
  after update on public.estimates
  for each row execute function public.audit_estimate_mutation();

-- 3. create_estimate_with_items — single transaction: insert header, loop-
--    insert line items, and if supersedes_estimate_id is present flip the
--    parent to 'superseded'. That parent UPDATE only touches `status`,
--    which enforce_estimate_immutability allows, and it fires the audit
--    trigger above like any other status change (actor left null — no
--    set_config call here, unlike the two mutation RPCs below).
create function public.create_estimate_with_items(
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
    coalesce((p_estimate->>'estimate_number')::int, nextval('estimate_number_seq')::int),
    coalesce((p_estimate->>'version')::int, 1),
    v_supersedes,
    coalesce((p_estimate->>'status')::estimate_status, 'draft'::estimate_status),
    nullif(p_estimate->>'job_number', ''),
    p_estimate->>'job_name',
    p_estimate->>'client_name',
    p_estimate->>'client_type',
    p_estimate->>'client_email',
    p_estimate->>'client_phone',
    p_estimate->>'job_address',
    p_estimate->>'city',
    p_estimate->>'job_type',
    coalesce((p_estimate->>'estimate_date')::date, current_date),
    p_estimate->>'job_details',
    p_estimate->>'labor_method',
    (p_estimate->>'total_job_hours')::numeric,
    (p_estimate->>'days_at_job')::numeric,
    (p_estimate->>'num_employees')::numeric,
    coalesce((p_estimate->>'dump_count')::numeric, 0),
    coalesce((p_estimate->>'job_specific_costs')::numeric, 0),
    (p_estimate->>'markup_pct')::numeric,
    (p_estimate->>'labor_rate')::numeric,
    (p_estimate->>'overhead_rate')::numeric,
    (p_estimate->>'dump_rate')::numeric,
    (p_estimate->>'cc_fee_rate')::numeric,
    (p_estimate->>'labor_cost')::numeric,
    (p_estimate->>'dump_fees')::numeric,
    (p_estimate->>'total_direct')::numeric,
    (p_estimate->>'overhead')::numeric,
    (p_estimate->>'profit')::numeric,
    (p_estimate->>'cc_fee')::numeric,
    (p_estimate->>'total_bid')::numeric,
    (p_estimate->>'true_margin_pct')::numeric,
    (p_estimate->>'quoted_price')::numeric,
    p_estimate->>'quote_override_reason',
    coalesce(p_estimate->>'source', 'app'),
    (p_estimate->>'airtable_estimate_id')::int,
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
      coalesce((v_item->>'labor_hours')::numeric, 0),
      coalesce((v_item->>'dump_count')::numeric, 0),
      coalesce((v_item->>'materials_cost')::numeric, 0),
      coalesce((v_item->>'sort_order')::int, 0)
    );
  end loop;

  if v_supersedes is not null then
    update public.estimates
    set status = 'superseded'
    where id = v_supersedes
      and status <> 'superseded';
  end if;

  return v_estimate;
end;
$$;

-- 4. update_estimate_status — sets actor context, then updates status
--    (allowed by enforce_estimate_immutability), which fires the audit
--    trigger with the actor attached.
create function public.update_estimate_status(
  p_id uuid,
  p_status estimate_status,
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
  set status = p_status
  where id = p_id
  returning * into v_estimate;

  if not found then
    raise exception 'estimate % not found', p_id;
  end if;

  return v_estimate;
end;
$$;

-- 5. update_estimate_quote — DB backstop for the override-reason rule:
--    raises when quoted_price differs from the row's own total_bid and no
--    reason was given. Reads total_bid before touching actor context so
--    the raise path never writes app.actor_* or an audit row.
create function public.update_estimate_quote(
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
  select total_bid into v_total_bid from public.estimates where id = p_id;

  if not found then
    raise exception 'estimate % not found', p_id;
  end if;

  if p_quoted_price is distinct from v_total_bid
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

-- 6. Service-role-only: revoke from public/anon/authenticated on every
--    function this migration creates. service_role retains execute via
--    Supabase's default per-schema grants (not touched here).
revoke all on function public.audit_estimate_mutation() from public, anon, authenticated;
revoke all on function public.create_estimate_with_items(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.update_estimate_status(uuid, estimate_status, uuid, text) from public, anon, authenticated;
revoke all on function public.update_estimate_quote(uuid, numeric, text, uuid, text) from public, anon, authenticated;
