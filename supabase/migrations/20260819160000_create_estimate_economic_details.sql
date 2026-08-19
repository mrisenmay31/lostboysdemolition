-- Profitability v2 Phase 1, Task 2 (Session 2, Lane 2b) — economic-details
-- write path.
--
-- Adds a non-breaking THREE-argument sibling to the live two-argument
-- `create_estimate_with_items(p_estimate, p_line_items)`
-- (20260814210000_phase_b2_rpcs_audit.sql, last replaced by
-- 20260814230000_phase_b2_path_b_flag.sql to add `is_path_b`): same
-- transaction, same writer contract (version chain, supersede flip, actor
-- context for the audit trigger), PLUS exactly one insert into
-- `estimate_financial_details` (20260819151000_profitability_core_schema.sql,
-- Task 1) in the same transaction.
--
-- v1 (`create_estimate_with_items`) is left COMPLETELY UNTOUCHED by this
-- migration — no CREATE OR REPLACE, no signature change — so any
-- already-deployed caller keeps working during a staggered app/database
-- deploy (v2 doc, Task 2 Step 5: "Leave create_estimate_with_items intact
-- during rollout ... remove it only in a separate post-launch cleanup").
-- v1's removal is explicitly out of scope for Phase 1 (phase-1 plan,
-- "Explicitly out of scope").
--
-- v2 replicates v1's writer contract verbatim, field-for-field and
-- branch-for-branch (verified by side-by-side reading against the live
-- 20260814230000_phase_b2_path_b_flag.sql body, the current CREATE OR
-- REPLACE of create_estimate_with_items):
--   1. estimate_number: explicit p_estimate->>'estimate_number' wins,
--      otherwise nextval('estimate_number_seq') (coalesce short-circuits so
--      nextval only fires when actually needed).
--   2. version: explicit p_estimate->>'version' wins, otherwise 1.
--   3. supersedes_estimate_id: read once into v_supersedes, used both for
--      the insert and the post-insert supersede flip.
--   4. Every scalar field on the insert list uses the same
--      nullif(x, '')::type / coalesce(..., default) parsing pattern v1
--      uses (blank-string-as-NULL, not just SQL NULL — the fixup that
--      distinguishes the *path_b* version of v1 from the original
--      *rpcs_audit* version).
--   5. is_path_b: same coalesce(...,false) pattern v1 uses.
--   6. Line items: identical loop over p_line_items, identical column list
--      and per-item nullif/coalesce parsing.
--   7. Supersede flip: identical — set_config('app.actor_id'/'app.actor_name',
--      ...) from the ESTIMATE PAYLOAD's own created_by/created_by_name (this
--      function receives no separate actor parameters, exactly like v1),
--      then `update estimates set status = 'superseded' where id =
--      v_supersedes and status <> 'superseded'` — that UPDATE only touches
--      `status`, which enforce_estimate_immutability allows, and it fires
--      estimates_audit_mutation like any other status change.
--   8. Returns the full inserted `estimates` row (`returns public.estimates`).
--
-- The ONE addition: after the line-item loop and BEFORE the supersede flip
-- (so a missing/invalid details object aborts the whole transaction before
-- any status-mutation side effect fires), insert exactly one
-- `estimate_financial_details` row keyed on v_estimate.id. A
-- missing/null/empty p_financial_details is REJECTED with a raised
-- exception — see the validation block below. This satisfies the Task 2
-- "Review-resolved clarification" in the phase-1 plan: `estimate_financial_details`
-- is immutable with PK estimate_id by design (a details row is 1:1 with an
-- immutable estimate VERSION, inserted in the same transaction as that
-- version; corrections are a new estimate version + new details row, same
-- as line items) — this migration is what makes that design load-bearing.
--
-- Same security posture as v1 (verified from
-- 20260814210000_phase_b2_rpcs_audit.sql section 6): plain plpgsql, no
-- SECURITY DEFINER, EXECUTE revoked from public/anon/authenticated with NO
-- explicit grant statement — service_role keeps EXECUTE via Supabase's
-- default per-schema grants, exactly like every other estimates-writing RPC
-- in this schema. search_path is pinned to `public, pg_temp` (phase-1 plan
-- deviation 3 — the 2026-08-17 hardening standard for every function this
-- session creates; v1 itself predates that standard and pins only `public`,
-- and is left alone per the "leave v1 fully intact" instruction above).

-- F10 (fix round): p_financial_details carries no default -- it is a
-- required argument, and a call that omits it must fail to RESOLVE (42883,
-- "function does not exist"), not silently reach the runtime NULL-guard
-- below. A default null blurred that distinction.
--
-- Postgres requires that parameters carrying a default be a trailing
-- suffix of the parameter list (a non-default parameter cannot follow a
-- defaulted one) -- so making the LAST parameter required means
-- p_line_items, immediately before it, cannot keep its default either.
-- Both trailing defaults are dropped rather than reordering the parameter
-- list: this is a brand-new function with no live caller yet (grepped
-- repo-wide at fix-round time -- only comment references, no call sites),
-- and preserving v1's positional argument order
-- (p_estimate, p_line_items, p_financial_details) matters more than
-- keeping p_line_items independently optional. All three arguments are now
-- required on every call.
create function public.create_estimate_with_items_v2(
  p_estimate jsonb,
  p_line_items jsonb,
  p_financial_details jsonb
) returns public.estimates
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_estimate public.estimates;
  v_supersedes uuid;
  v_item jsonb;
begin
  -- Reject a null/empty details object up front, before any write happens.
  -- F10 (fix round) dropped the parameter's SQL default, so a caller that
  -- simply omits the third argument now fails at CALL RESOLUTION (42883,
  -- "function does not exist") rather than reaching this guard at all. What
  -- this guard still covers, at runtime, is a caller that supplies the
  -- argument explicitly as either shape of "nothing": the JSON scalar
  -- `null`, or `{}`. A details object that names some but not all NOT NULL
  -- columns on
  -- estimate_financial_details (productive_hours, operational_labor_cost,
  -- allocated_overhead, markup_amount, customer_price,
  -- planned_economic_profit, planned_profit_pct) is caught naturally by
  -- that table's own NOT NULL constraints when the insert below runs — no
  -- need to hand-duplicate that validation here.
  if p_financial_details is null
    or jsonb_typeof(p_financial_details) is distinct from 'object'
    or p_financial_details = '{}'::jsonb
  then
    raise exception
      'create_estimate_with_items_v2: p_financial_details is required and must be a non-empty object';
  end if;

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
    coalesce((nullif(p_estimate->>'is_path_b', ''))::boolean, false)
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

  -- The one addition over v1: exactly one estimate_financial_details row,
  -- 1:1 with this estimate version. estimate_financial_details is itself
  -- immutable-by-trigger with PK estimate_id (Task 1), so this insert can
  -- only ever happen once per estimate row — matching that table's design.
  -- Fields not supplied by the caller fall back to the same zero-default
  -- the table column itself carries (materials_cost, rentals_cost,
  -- expected_dump_cost, subcontractors_cost, other_direct_cost,
  -- expected_processing_cost, risk_pricing_allowance,
  -- processing_pricing_allowance, discount_amount all `not null default 0`
  -- on the table) — the required fields (productive_hours,
  -- operational_labor_cost, allocated_overhead, markup_amount,
  -- customer_price, planned_economic_profit, planned_profit_pct) have no
  -- such fallback and will raise a NOT NULL violation if the caller omitted
  -- them, which is the intended behavior.
  insert into public.estimate_financial_details (
    estimate_id,
    formula_version,
    productive_hours,
    operational_labor_cost,
    materials_cost,
    rentals_cost,
    expected_dump_cost,
    subcontractors_cost,
    other_direct_cost,
    allocated_overhead,
    expected_processing_cost,
    risk_pricing_allowance,
    markup_amount,
    processing_pricing_allowance,
    discount_amount,
    customer_price,
    planned_economic_profit,
    planned_profit_pct
  ) values (
    v_estimate.id,
    coalesce(nullif(p_financial_details->>'formula_version', ''), 'economic-v1'),
    (nullif(p_financial_details->>'productive_hours', ''))::numeric,
    (nullif(p_financial_details->>'operational_labor_cost', ''))::numeric,
    coalesce((nullif(p_financial_details->>'materials_cost', ''))::numeric, 0),
    coalesce((nullif(p_financial_details->>'rentals_cost', ''))::numeric, 0),
    coalesce((nullif(p_financial_details->>'expected_dump_cost', ''))::numeric, 0),
    coalesce((nullif(p_financial_details->>'subcontractors_cost', ''))::numeric, 0),
    coalesce((nullif(p_financial_details->>'other_direct_cost', ''))::numeric, 0),
    (nullif(p_financial_details->>'allocated_overhead', ''))::numeric,
    coalesce((nullif(p_financial_details->>'expected_processing_cost', ''))::numeric, 0),
    coalesce((nullif(p_financial_details->>'risk_pricing_allowance', ''))::numeric, 0),
    (nullif(p_financial_details->>'markup_amount', ''))::numeric,
    coalesce((nullif(p_financial_details->>'processing_pricing_allowance', ''))::numeric, 0),
    coalesce((nullif(p_financial_details->>'discount_amount', ''))::numeric, 0),
    (nullif(p_financial_details->>'customer_price', ''))::numeric,
    (nullif(p_financial_details->>'planned_economic_profit', ''))::numeric,
    (nullif(p_financial_details->>'planned_profit_pct', ''))::numeric
  );

  if v_supersedes is not null then
    -- Identical to v1: actor for the auto-supersede flip comes from the
    -- estimate payload's own created_by/created_by_name, not a separate RPC
    -- parameter — this function, like v1, has none.
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

-- Service-role-only, matching v1's actual live posture (verified from
-- 20260814210000_phase_b2_rpcs_audit.sql section 6): revoke only, no
-- explicit grant statement — service_role retains EXECUTE via Supabase's
-- default per-schema grants.
revoke all on function public.create_estimate_with_items_v2(jsonb, jsonb, jsonb)
  from public, anon, authenticated;

-- ============================================================
-- pricing_variables seed: estimated_dump_cost_per_load.
--
-- A per-load DOLLAR COST (median actual dump cost, DISCOVERY §4 / CLAUDE.md
-- Pricing Benchmarks), not a `_rate` — it feeds
-- expectedDumpCost = dumpCount * estimated_dump_cost_per_load inside
-- computeEstimateEconomics(), which changes PLANNED ECONOMIC PROFIT
-- reporting only. It is never added to jobSpecificCosts and never reaches
-- computeEstimate() / the customer quote (v2 doc Task 2 Step 4; phase-1
-- plan "Risk flags": "the new pricing key is a per-load dollar cost, not a
-- _rate"). pricing_variables.key is the table's own primary key
-- (20260814150000_phase_b_estimates_schema.sql), so `on conflict (key) do
-- nothing` is the correct idempotent-seed form — same intent as the house
-- seed style in 20260814163000_phase_b_seeds.sql, which predates this
-- table having any conflict risk (it was empty then; production may already
-- carry Task 2's earlier draft of this row if this migration is replayed
-- after a partial apply, hence the guard here even though
-- 20260814163000_phase_b_seeds.sql itself has none).
-- ============================================================
insert into public.pricing_variables (key, value, description)
values (
  'estimated_dump_cost_per_load',
  65,
  'Per-load dump COST (not a pricing rate) — median actual cost per DISCOVERY §4 / CLAUDE.md Pricing Benchmarks. Feeds computeEstimateEconomics()''s expectedDumpCost = dumpCount x this value; changes planned economic profit reporting only, never the customer quote (dump_rate_per_load remains the pricing input computeEstimate() uses).'
)
on conflict (key) do nothing;
