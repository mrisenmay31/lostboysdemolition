-- ============================================================
-- v2 Task 7 — manual ledger RPCs.
-- All ledger writes go through these (never bare inserts from the app):
-- the reconciliation hook and the category-overrun alert must share the
-- write's transaction. service_role-only, search_path pinned.
-- Raise texts below are matched by substring in web/src/lib/ledger/repo.ts
-- (cross-lane API — Session 3 precedent): do not reword without updating
-- the classifier and its tests.
-- ============================================================

-- ------------------------------------------------------------
-- open_category_overrun_alert — v2 Task 7 Step 4: "Open an alert when a
-- category's approved+provisional+committed amount exceeds current
-- budget." Mirrors map.ts's rollupLedger inclusion rules exactly (void
-- states and reconciliation_state='excluded' rows are skipped). One open
-- alert per (job, category) via the existing partial unique index;
-- reopens after resolution. Deliberately NO integration_outbox event —
-- Slack profitability alerts are v2 Task 12; the in-app queue is
-- authoritative (v2 decision ledger).
-- ------------------------------------------------------------
create function public.open_category_overrun_alert(
  p_job_number text,
  p_category public.cost_category
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_budget numeric(12,2);
  v_actual numeric(12,2);
begin
  select case p_category
           when 'direct_labor'       then b.direct_labor_cost
           when 'materials'          then b.materials_cost
           when 'rentals'            then b.rentals_cost
           when 'dump'               then b.dump_cost
           when 'subcontractors'     then b.subcontractors_cost
           when 'other_direct'       then b.other_direct_cost
           when 'payment_processing' then b.payment_processing_cost
         end
    into v_budget
    from public.job_budget_versions b
    join public.jobs j on j.job_number = b.job_number
   where b.job_number = p_job_number
     and b.version = j.current_budget_version;

  if v_budget is null then
    return; -- no current budget: nothing to compare against
  end if;

  select coalesce(sum(amount), 0)
    into v_actual
    from public.job_cost_entries
   where job_number = p_job_number
     and category = p_category
     and state in ('provisional', 'committed', 'approved')
     and reconciliation_state <> 'excluded';

  if v_actual <= v_budget then
    return;
  end if;

  insert into public.job_alerts (job_number, fingerprint, severity, title, message, action_path)
  values (
    p_job_number,
    'category_overrun:' || p_category,
    'watch',
    'Category over budget',
    format('%s actuals plus committed ($%s) exceed the current budget ($%s).',
      initcap(replace(p_category::text, '_', ' ')),
      to_char(v_actual, 'FM999,999,990.00'),
      to_char(v_budget, 'FM999,999,990.00')),
    '/jobs/' || p_job_number
  )
  on conflict (job_number, fingerprint) where resolved_at is null do nothing;
end;
$$;

-- ------------------------------------------------------------
-- create_job_cost_entry — manual cost capture (v2 Task 7 Step 2).
-- source_system='manual', server-generated uuid source_record_id.
-- Amounts strictly positive: adjustments are corrections, removal is
-- void-via-correction. incurred_on is a Denver business date stored as
-- Denver NOON so the Denver-rendered date always round-trips.
-- p_actor is null under no-login; attribution is metadata.entered_by.
-- ------------------------------------------------------------
create function public.create_job_cost_entry(
  p_entry jsonb,
  p_actor uuid,
  p_actor_name text
) returns public.job_cost_entries
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job_number text := p_entry ->> 'job_number';
  v_category   public.cost_category;
  v_state      public.ledger_state;
  v_amount     numeric(12,2);
  v_quantity   numeric(10,2);
  v_unit_cost  numeric(12,4);
  v_incurred_on date;
  v_note       text := nullif(btrim(coalesce(p_entry ->> 'note', '')), '');
  v_row        public.job_cost_entries;
begin
  if p_actor_name is null or btrim(p_actor_name) = '' then
    raise exception 'create_job_cost_entry: actor name is required';
  end if;
  if v_job_number is null
     or not exists (select 1 from public.jobs where job_number = v_job_number) then
    raise exception 'create_job_cost_entry: job % not found', coalesce(v_job_number, '(null)');
  end if;

  v_category := (p_entry ->> 'category')::public.cost_category;
  v_state    := (p_entry ->> 'state')::public.ledger_state;
  if v_state = 'void' then
    raise exception 'create_job_cost_entry: an entry cannot be created as void';
  end if;

  v_amount := (p_entry ->> 'amount')::numeric(12,2);
  if v_amount is null or v_amount <= 0 then
    raise exception 'create_job_cost_entry: amount must be a positive number';
  end if;
  v_quantity := (p_entry ->> 'quantity')::numeric(10,2);
  if v_quantity is not null and v_quantity <= 0 then
    raise exception 'create_job_cost_entry: quantity must be positive when provided';
  end if;
  v_unit_cost := (p_entry ->> 'unit_cost')::numeric(12,4);
  if v_unit_cost is not null and v_unit_cost < 0 then
    raise exception 'create_job_cost_entry: unit cost cannot be negative';
  end if;
  v_incurred_on := (p_entry ->> 'incurred_on')::date;
  if v_incurred_on is null then
    raise exception 'create_job_cost_entry: incurred_on date is required';
  end if;

  insert into public.job_cost_entries (
    job_number, category, state, amount, quantity, unit_cost,
    employee_name, vendor_name, incurred_at,
    source_system, source_record_id, metadata
  ) values (
    v_job_number, v_category, v_state, v_amount, v_quantity, v_unit_cost,
    nullif(btrim(coalesce(p_entry ->> 'employee_name', '')), ''),
    nullif(btrim(coalesce(p_entry ->> 'vendor_name', '')), ''),
    (v_incurred_on::timestamp + interval '12 hours') at time zone 'America/Denver',
    'manual',
    gen_random_uuid()::text,
    jsonb_strip_nulls(jsonb_build_object('entered_by', p_actor_name, 'note', v_note))
  )
  returning * into v_row;

  perform public.mark_job_reconciliation_required(v_job_number, 'cost_entry', v_row.id::text);
  perform public.open_category_overrun_alert(v_job_number, v_category);
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- correct_job_cost_entry — the ONLY correction path (v2 Task 7 Step 2's
-- named signature). Locks the row, applies a whitelisted patch, bumps
-- source_revision/updated_at (the updated_at bump is what moves the
-- forecast-snapshot watermark), writes job_cost_entry_audit in the same
-- transaction, then runs the reconciliation hook and overrun check.
-- Restricted to source_system='manual' — widening to BILL/provider rows
-- is a Task 14/13 decision, not a default.
-- Patch semantics: jsonb `?` distinguishes "set to null" from "absent"
-- for the nullable fields; state 'void' is reachable here (that is how
-- entries are removed — there is no delete path, by design).
-- ------------------------------------------------------------
create function public.correct_job_cost_entry(
  p_id uuid,
  p_patch jsonb,
  p_reason text,
  p_actor uuid,
  p_actor_name text
) returns public.job_cost_entries
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old public.job_cost_entries;
  v_new public.job_cost_entries;
  v_key text;
  v_category public.cost_category;
  v_state public.ledger_state;
  v_amount numeric(12,2);
  v_quantity numeric(10,2);
  v_unit_cost numeric(12,4);
  v_incurred_at timestamptz;
  v_employee_name text;
  v_vendor_name text;
  v_metadata jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'correct_job_cost_entry: a correction reason is required';
  end if;
  if p_actor_name is null or btrim(p_actor_name) = '' then
    raise exception 'correct_job_cost_entry: actor name is required';
  end if;
  if p_patch is null or p_patch = '{}'::jsonb then
    raise exception 'correct_job_cost_entry: the patch must change at least one field';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('category','state','amount','quantity','unit_cost',
                     'employee_name','vendor_name','incurred_on','note') then
      raise exception 'correct_job_cost_entry: unknown patch field %', v_key;
    end if;
  end loop;

  select * into v_old from public.job_cost_entries where id = p_id for update;
  if not found then
    raise exception 'correct_job_cost_entry: entry % not found', p_id;
  end if;
  if v_old.source_system <> 'manual' then
    raise exception 'correct_job_cost_entry: only manual entries can be corrected (entry % came from %)',
      p_id, v_old.source_system;
  end if;

  v_category := case when p_patch ? 'category'
    then (p_patch ->> 'category')::public.cost_category else v_old.category end;
  v_state := case when p_patch ? 'state'
    then (p_patch ->> 'state')::public.ledger_state else v_old.state end;
  v_amount := case when p_patch ? 'amount'
    then (p_patch ->> 'amount')::numeric(12,2) else v_old.amount end;
  if v_amount is null or v_amount <= 0 then
    raise exception 'correct_job_cost_entry: amount must be a positive number';
  end if;
  v_quantity := case when p_patch ? 'quantity'
    then (p_patch ->> 'quantity')::numeric(10,2) else v_old.quantity end;
  if v_quantity is not null and v_quantity <= 0 then
    raise exception 'correct_job_cost_entry: quantity must be positive when provided';
  end if;
  v_unit_cost := case when p_patch ? 'unit_cost'
    then (p_patch ->> 'unit_cost')::numeric(12,4) else v_old.unit_cost end;
  if v_unit_cost is not null and v_unit_cost < 0 then
    raise exception 'correct_job_cost_entry: unit cost cannot be negative';
  end if;
  v_incurred_at := case when p_patch ? 'incurred_on'
    then (((p_patch ->> 'incurred_on')::date)::timestamp + interval '12 hours') at time zone 'America/Denver'
    else v_old.incurred_at end;
  v_employee_name := case when p_patch ? 'employee_name'
    then nullif(btrim(coalesce(p_patch ->> 'employee_name', '')), '') else v_old.employee_name end;
  v_vendor_name := case when p_patch ? 'vendor_name'
    then nullif(btrim(coalesce(p_patch ->> 'vendor_name', '')), '') else v_old.vendor_name end;
  v_metadata := case when p_patch ? 'note'
    then jsonb_strip_nulls(v_old.metadata
           || jsonb_build_object('note', nullif(btrim(coalesce(p_patch ->> 'note', '')), '')))
    else v_old.metadata end;

  update public.job_cost_entries
     set category = v_category, state = v_state, amount = v_amount,
         quantity = v_quantity, unit_cost = v_unit_cost,
         employee_name = v_employee_name, vendor_name = v_vendor_name,
         incurred_at = v_incurred_at, metadata = v_metadata,
         source_revision = v_old.source_revision + 1,
         updated_at = now()
   where id = p_id
  returning * into v_new;

  insert into public.job_cost_entry_audit (
    job_cost_entry_id, old_record, new_record, actor_id, actor_name, reason
  ) values (
    p_id, to_jsonb(v_old), to_jsonb(v_new), p_actor, p_actor_name, btrim(p_reason)
  );

  perform public.mark_job_reconciliation_required(v_new.job_number, 'cost_entry_correction', p_id::text);
  perform public.open_category_overrun_alert(v_new.job_number, v_new.category);
  return v_new;
end;
$$;

-- ------------------------------------------------------------
-- create_job_revenue_entry — manual revenue capture (v2 Task 7 Step 3).
-- SIGN CONVENTION (locked to map.ts's buildFinancialComparison, which
-- computes economic revenue as a plain signed sum over invoice + credit
-- + refund): credit/refund must be NEGATIVE; approved_contract, invoice,
-- payment must be POSITIVE. The web form captures positive numbers and
-- the repo negates credit/refund before calling — this function is the
-- trust boundary that makes the convention non-optional.
-- No correction path by design: job_revenue_entries has no state column
-- and no audit table; a wrong entry is corrected by an offsetting
-- credit/refund.
-- ------------------------------------------------------------
create function public.create_job_revenue_entry(
  p_entry jsonb,
  p_actor uuid,
  p_actor_name text
) returns public.job_revenue_entries
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job_number  text := p_entry ->> 'job_number';
  v_entry_type  public.revenue_entry_type;
  v_amount      numeric(12,2);
  v_occurred_on date;
  v_note        text := nullif(btrim(coalesce(p_entry ->> 'note', '')), '');
  v_row         public.job_revenue_entries;
begin
  if p_actor_name is null or btrim(p_actor_name) = '' then
    raise exception 'create_job_revenue_entry: actor name is required';
  end if;
  if v_job_number is null
     or not exists (select 1 from public.jobs where job_number = v_job_number) then
    raise exception 'create_job_revenue_entry: job % not found', coalesce(v_job_number, '(null)');
  end if;

  v_entry_type := (p_entry ->> 'entry_type')::public.revenue_entry_type;
  v_amount := (p_entry ->> 'amount')::numeric(12,2);
  if v_amount is null or v_amount = 0 then
    raise exception 'create_job_revenue_entry: amount must be a non-zero number';
  end if;
  if v_entry_type in ('credit', 'refund') and v_amount > 0 then
    raise exception 'create_job_revenue_entry: % entries must carry a negative amount', v_entry_type;
  end if;
  if v_entry_type in ('approved_contract', 'invoice', 'payment') and v_amount < 0 then
    raise exception 'create_job_revenue_entry: % entries must carry a positive amount', v_entry_type;
  end if;
  if v_note is null then
    raise exception 'create_job_revenue_entry: a source note is required';
  end if;
  v_occurred_on := (p_entry ->> 'occurred_on')::date;
  if v_occurred_on is null then
    raise exception 'create_job_revenue_entry: occurred_on date is required';
  end if;

  insert into public.job_revenue_entries (
    job_number, entry_type, amount, source_system, source_record_id, occurred_at, metadata
  ) values (
    v_job_number, v_entry_type, v_amount, 'manual', gen_random_uuid()::text,
    (v_occurred_on::timestamp + interval '12 hours') at time zone 'America/Denver',
    jsonb_build_object('entered_by', p_actor_name, 'note', v_note)
  )
  returning * into v_row;

  perform public.mark_job_reconciliation_required(v_job_number, 'revenue_entry', v_row.id::text);
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- EXECUTE posture — house standard (2026-08-17 hardening pass):
-- clients never call these; server actions reach them via service_role.
-- ------------------------------------------------------------
revoke all on function public.open_category_overrun_alert(text, public.cost_category)
  from public, anon, authenticated;
grant execute on function public.open_category_overrun_alert(text, public.cost_category)
  to service_role;
revoke all on function public.create_job_cost_entry(jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_job_cost_entry(jsonb, uuid, text)
  to service_role;
revoke all on function public.correct_job_cost_entry(uuid, jsonb, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.correct_job_cost_entry(uuid, jsonb, text, uuid, text)
  to service_role;
revoke all on function public.create_job_revenue_entry(jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_job_revenue_entry(jsonb, uuid, text)
  to service_role;
