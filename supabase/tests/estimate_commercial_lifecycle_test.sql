-- Profitability v2 Phase 1, Task 2 (Session 2, Lane 2b) pgTAP suite for
-- 20260819160000_create_estimate_economic_details.sql +
-- 20260819161000_estimate_commercial_lifecycle.sql.
--
-- House style throughout (profitability_core_schema_test.sql,
-- workforce_auth_boundary_test.sql): every multi-overload assertion carries
-- a description argument (phase-1 plan deviation 1 — the exact bug this
-- guards against is an undescribed has_table('public','x')/has_enum(...)
-- silently resolving the wrong overload and checking for an object
-- literally named 'public'). ACL/RLS/trigger assertions follow the same
-- shapes proven in profitability_core_schema_test.sql section-by-section.
--
-- plan(78) arithmetic, section by section (fix round, 2026-08-19 Session 2
-- Lane 2b re-review: widened from plan(58) to plan(78), +20 — see the new
-- "Fixtures + F8 behavioral coverage" section at the end of this file for
-- the 20):
--   2  has_enum                         (estimate_acceptance_action, actor_assurance)
--   2  enum_has_labels                  (same 2 enums, values AND order)
--   4  has_table                        (the 4 new tables)
--  21  has_column                       (5 + 4 + 6 + 6 across the 4 tables — see section 4)
--   4  RLS enabled                      (1 per table)
--   8  ACL — anon/authenticated empty   (4 tables x 2 roles)
--   6  RPC EXECUTE posture              (2 functions x 3 roles: anon/authenticated denied, service_role granted)
--   4  immutability trigger existence   (has_trigger + trigger_is, 2 tables)
--   2  triggers_are — vacuous pins      (identity_links, acceptance_state carry NO triggers)
--   3  unique/PK constraints            (ghl_opportunity_id unique, estimate_presentations.estimate_id unique, acceptance_state PK)
--   2  CHECK constraint existence       (accepted_price required-on-accept; accepted_price >= 0)
--   1  CHECK constraint existence (F8)  (estimate_acceptance_state accepted<->price, matched by name)
--   1  col_not_null (F8)                (estimate_acceptance_state.current_estimate_id)
--  18  behavioral (F8, fix round)       (F1/F2/F4/F5/F13 coverage over record_estimate_acceptance_event
--                                        + the create_estimate_with_items_v2 '{}' guard — 12 throws_ok/
--                                        throws_like, 4 lives_ok, 2 is()/ok() state-projection checks;
--                                        see the fixtures section below for the exact 18)
-- ---
--  78  total — 2+2+4+21+4+8+6+4+2+3+2+1+1+18 = 78
--
-- F3 (the lock-order-inversion deadlock fix) has NO pgTAP assertion here by
-- design -- pgTAP runs single-session, and reproducing a deadlock requires
-- two concurrent sessions blocking on each other's locks. The reviewer
-- verified the fixed lock-order pattern deadlock-free with concurrent
-- sessions outside this suite; that verification is not repeatable in
-- single-session pgTAP and is not claimed here.
--
-- pgTAP lives on branches / production single-transaction dry-runs only,
-- per docs/runbooks/profitability-schema-validation.md §3.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;
select plan(78);

-- ============================================================
-- 1-2: has_enum — the 2 new enums this migration creates.
-- ============================================================
select has_enum('public', 'estimate_acceptance_action', 'estimate_acceptance_action enum exists');
select has_enum('public', 'actor_assurance', 'actor_assurance enum exists');

-- ============================================================
-- 3-4: enum_has_labels — values AND order.
-- ============================================================
select enum_has_labels(
  'public', 'estimate_acceptance_action',
  array['accepted', 'reversed'],
  'estimate_acceptance_action has the exact expected labels in order'
);
select enum_has_labels(
  'public', 'actor_assurance',
  array['authenticated', 'selected_identity', 'external_webhook'],
  'actor_assurance has the exact expected labels in order'
);

-- ============================================================
-- 5-8: has_table — the 4 new tables.
-- ============================================================
select has_table('public', 'estimate_identity_links', 'estimate_identity_links table exists');
select has_table('public', 'estimate_presentations', 'estimate_presentations table exists');
select has_table('public', 'estimate_acceptance_events', 'estimate_acceptance_events table exists');
select has_table('public', 'estimate_acceptance_state', 'estimate_acceptance_state table exists');

-- ============================================================
-- 9-29: has_column spot-checks (21 total) — key columns per table,
-- including accepted_price on BOTH estimate_acceptance_events and
-- estimate_acceptance_state (deviation 12).
-- ============================================================

-- estimate_identity_links (5)
select has_column('public', 'estimate_identity_links', 'estimate_number', 'estimate_identity_links.estimate_number exists');
select has_column('public', 'estimate_identity_links', 'ghl_contact_id', 'estimate_identity_links.ghl_contact_id exists');
select has_column('public', 'estimate_identity_links', 'ghl_opportunity_id', 'estimate_identity_links.ghl_opportunity_id exists');
select has_column('public', 'estimate_identity_links', 'linked_by_name', 'estimate_identity_links.linked_by_name exists');
select has_column('public', 'estimate_identity_links', 'actor_assurance', 'estimate_identity_links.actor_assurance exists');

-- estimate_presentations (4)
select has_column('public', 'estimate_presentations', 'id', 'estimate_presentations.id exists');
select has_column('public', 'estimate_presentations', 'estimate_id', 'estimate_presentations.estimate_id exists');
select has_column('public', 'estimate_presentations', 'presented_via', 'estimate_presentations.presented_via exists');
select has_column('public', 'estimate_presentations', 'snapshot_hash', 'estimate_presentations.snapshot_hash exists');

-- estimate_acceptance_events (6)
select has_column('public', 'estimate_acceptance_events', 'id', 'estimate_acceptance_events.id exists');
select has_column('public', 'estimate_acceptance_events', 'estimate_id', 'estimate_acceptance_events.estimate_id exists');
select has_column('public', 'estimate_acceptance_events', 'action', 'estimate_acceptance_events.action exists');
select has_column('public', 'estimate_acceptance_events', 'accepted_price', 'estimate_acceptance_events.accepted_price exists (deviation 12)');
select has_column('public', 'estimate_acceptance_events', 'reversal_destination', 'estimate_acceptance_events.reversal_destination exists');
select has_column('public', 'estimate_acceptance_events', 'supersedes_event_id', 'estimate_acceptance_events.supersedes_event_id exists');

-- estimate_acceptance_state (6)
select has_column('public', 'estimate_acceptance_state', 'estimate_number', 'estimate_acceptance_state.estimate_number exists');
select has_column('public', 'estimate_acceptance_state', 'current_estimate_id', 'estimate_acceptance_state.current_estimate_id exists');
select has_column('public', 'estimate_acceptance_state', 'accepted', 'estimate_acceptance_state.accepted exists');
select has_column('public', 'estimate_acceptance_state', 'accepted_price', 'estimate_acceptance_state.accepted_price exists (deviation 12)');
select has_column('public', 'estimate_acceptance_state', 'current_acceptance_event_id', 'estimate_acceptance_state.current_acceptance_event_id exists');
select has_column('public', 'estimate_acceptance_state', 'last_event_id', 'estimate_acceptance_state.last_event_id exists');

-- ============================================================
-- 30-33: RLS enabled on all 4 new tables.
-- ============================================================
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'estimate_identity_links'),
  'RLS is enabled on estimate_identity_links'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'estimate_presentations'),
  'RLS is enabled on estimate_presentations'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'estimate_acceptance_events'),
  'RLS is enabled on estimate_acceptance_events'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'estimate_acceptance_state'),
  'RLS is enabled on estimate_acceptance_state'
);

-- ============================================================
-- 34-41: ACL posture — anon and authenticated hold NO table privileges
-- on any of the 4 new tables (deviation 2 — the assertion class that
-- caught a real TRUNCATE gap in Phase 0).
-- ============================================================
select table_privs_are('public', 'estimate_identity_links', 'anon', array[]::name[], 'anon has no table privileges on estimate_identity_links');
select table_privs_are('public', 'estimate_identity_links', 'authenticated', array[]::name[], 'authenticated has no table privileges on estimate_identity_links');
select table_privs_are('public', 'estimate_presentations', 'anon', array[]::name[], 'anon has no table privileges on estimate_presentations');
select table_privs_are('public', 'estimate_presentations', 'authenticated', array[]::name[], 'authenticated has no table privileges on estimate_presentations');
select table_privs_are('public', 'estimate_acceptance_events', 'anon', array[]::name[], 'anon has no table privileges on estimate_acceptance_events');
select table_privs_are('public', 'estimate_acceptance_events', 'authenticated', array[]::name[], 'authenticated has no table privileges on estimate_acceptance_events');
select table_privs_are('public', 'estimate_acceptance_state', 'anon', array[]::name[], 'anon has no table privileges on estimate_acceptance_state');
select table_privs_are('public', 'estimate_acceptance_state', 'authenticated', array[]::name[], 'authenticated has no table privileges on estimate_acceptance_state');

-- ============================================================
-- 42-47: RPC EXECUTE posture — both new/widened RPCs, 3 roles each.
-- ============================================================
select function_privs_are(
  'public', 'create_estimate_with_items_v2', array['jsonb', 'jsonb', 'jsonb'],
  'anon', array[]::text[],
  'anon cannot EXECUTE create_estimate_with_items_v2'
);
select function_privs_are(
  'public', 'create_estimate_with_items_v2', array['jsonb', 'jsonb', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE create_estimate_with_items_v2'
);
select function_privs_are(
  'public', 'create_estimate_with_items_v2', array['jsonb', 'jsonb', 'jsonb'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE create_estimate_with_items_v2'
);
select function_privs_are(
  'public', 'record_estimate_acceptance_event', array['jsonb'],
  'anon', array[]::text[],
  'anon cannot EXECUTE record_estimate_acceptance_event'
);
select function_privs_are(
  'public', 'record_estimate_acceptance_event', array['jsonb'],
  'authenticated', array[]::text[],
  'authenticated cannot EXECUTE record_estimate_acceptance_event'
);
select function_privs_are(
  'public', 'record_estimate_acceptance_event', array['jsonb'],
  'service_role', array['EXECUTE'],
  'service_role can EXECUTE record_estimate_acceptance_event'
);

-- ============================================================
-- 48-51: immutability triggers — estimate_acceptance_events and
-- estimate_presentations. Both has_trigger (existence) and trigger_is
-- (pins the trigger calls the RIGHT enforcement function, not just that
-- *some* same-named trigger exists — house pattern from
-- profitability_core_schema_test.sql's A4).
-- ============================================================
select has_trigger('public', 'estimate_acceptance_events', 'estimate_acceptance_events_immutable', 'estimate_acceptance_events has its immutability trigger');
select trigger_is('public', 'estimate_acceptance_events', 'estimate_acceptance_events_immutable', 'public', 'enforce_estimate_acceptance_events_immutability', 'estimate_acceptance_events_immutable calls the right enforcement function');
select has_trigger('public', 'estimate_presentations', 'estimate_presentations_immutable', 'estimate_presentations has its immutability trigger');
select trigger_is('public', 'estimate_presentations', 'estimate_presentations_immutable', 'public', 'enforce_estimate_presentations_immutability', 'estimate_presentations_immutable calls the right enforcement function');

-- ============================================================
-- 52-53: triggers_are — vacuous drift pins on the 2 DELIBERATELY MUTABLE
-- tables (identity_links, acceptance_state are projections/registries, not
-- append-only history — see this migration's header). These are the same
-- "pass vacuously pre-migration" convention as
-- profitability_core_schema_test.sql's A13: they exist so a LATER migration
-- can't silently make one of these tables immutable (or add an unreviewed
-- side-effecting trigger) without this suite catching the drift.
-- ============================================================
select triggers_are('public', 'estimate_identity_links', array[]::name[], 'estimate_identity_links has no triggers (vacuous pre-migration pin — mutable registry table)');
select triggers_are('public', 'estimate_acceptance_state', array[]::name[], 'estimate_acceptance_state has no triggers (vacuous pre-migration pin — mutable projection table)');

-- ============================================================
-- 54-56: unique / primary-key constraints.
-- ============================================================
select col_is_unique('public', 'estimate_identity_links', array['ghl_opportunity_id'], 'estimate_identity_links.ghl_opportunity_id is unique (one active opportunity per estimate family)');
select col_is_unique('public', 'estimate_presentations', array['estimate_id'], 'estimate_presentations.estimate_id is unique (one presentation snapshot per estimate version)');
select col_is_pk('public', 'estimate_acceptance_state', array['estimate_number'], 'estimate_acceptance_state primary key is estimate_number');

-- ============================================================
-- 57-58: accepted_price CHECK constraints (deviation 12). pgTAP has no
-- direct "has_check_matching_body" assertion, so — per the task brief and
-- the A7 lesson in profitability_core_schema_test.sql (always schema-filter
-- pg_constraint/pg_class joins) — these use ok() over
-- pg_get_constraintdef(), filtered to public.estimate_acceptance_events by
-- conrelid = the schema-qualified regclass (which is itself
-- unambiguous — regclass resolution honors search_path/schema, so no
-- separate pg_namespace join is needed the way the index-predicate check in
-- profitability_core_schema_test.sql needed one for pg_index).
-- ============================================================
select ok(
  exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.estimate_acceptance_events'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%action%accepted_price%IS NOT NULL%'
  ),
  'estimate_acceptance_events has a CHECK requiring accepted_price on accepted events'
);
select ok(
  exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.estimate_acceptance_events'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%accepted_price%>=%'
  ),
  'estimate_acceptance_events has a CHECK requiring accepted_price >= 0 when present'
);

-- ============================================================
-- 59-60: the two missing shape pins the fix round called for -- both on
-- estimate_acceptance_state, both absent from the original 58.
-- ============================================================
select ok(
  exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.estimate_acceptance_state'::regclass
       and c.contype = 'c'
       and c.conname = 'estimate_acceptance_state_price_matches_accepted'
  ),
  'estimate_acceptance_state has its accepted<->price CHECK constraint (estimate_acceptance_state_price_matches_accepted)'
);
select col_not_null('public', 'estimate_acceptance_state', 'current_estimate_id', 'estimate_acceptance_state.current_estimate_id is NOT NULL');

-- ============================================================
-- 61-78: Fixtures + F8 behavioral coverage (fix round).
--
-- Direct INSERTs into estimates/estimate_presentations, not the
-- create_estimate_with_items(_v2) RPCs -- INSERT is unrestricted by the
-- estimates immutability trigger (BEFORE UPDATE only, per
-- 20260814150000_phase_b_estimates_schema.sql) and by
-- enforce_estimate_no_delete (BEFORE DELETE only), so a direct insert
-- honors the writer contract (version 2 sets supersedes_estimate_id AND
-- carries its parent's explicit estimate_number) without needing a real
-- estimate_financial_details row, which these tests have no need of.
-- pgTAP's executing role owns these tables (branch/production dry-run,
-- never a real anon/authenticated session -- see file header), so RLS
-- (enabled, no policies) does not block any of this.
--
-- Three families, deliberately using estimate_number values (900101-900103)
-- far outside both the live range (~1400s) and the estimate_number_seq
-- default, so no collision with real or seeded rows is possible:
--   900101 -- v1 (status='superseded') + v2 (status='sent', quoted_price
--             4800.00, total_bid 5000.00), BOTH presented. Drives F1
--             (accept the superseded v1), the happy-path accept/reverse/
--             re-accept cycle, and the accepted_price coalesce proof.
--   900102 -- v1 only (status='sent'), NOT presented, no acceptance ever
--             recorded. Drives the pre-existing "not presented" guard and
--             F2's "no active acceptance to reverse" (absent-state) branch.
--   900103 -- v1 only (status='sent'), presented. Drives F4 (evidence_paths
--             null) and F5 (missing accepted-event required fields); reused
--             read-only for F13's cross-family supersedes_event_id case.
-- ============================================================

insert into public.estimates (
  estimate_number, version, supersedes_estimate_id, status,
  labor_method, total_job_hours, markup_pct, labor_rate, overhead_rate, dump_rate, cc_fee_rate,
  labor_cost, dump_fees, total_direct, overhead, profit, cc_fee, total_bid, true_margin_pct,
  quoted_price
) values (
  900101, 1, null, 'superseded',
  'total_hours', 10, 25, 26, 23, 300, 0.035,
  260, 0, 260, 230, 122.5, 0, 612.5, 20,
  null
);

-- quote_override_reason accompanies quoted_price: the LIVE
-- quote_override_reason_required CHECK (phase_b_estimates_fixups) rejects a
-- quoted_price without a reason — caught by this task's own branch GREEN
-- run (2026-08-19); the reviewer's local rig predated that constraint.
insert into public.estimates (
  estimate_number, version, supersedes_estimate_id, status,
  labor_method, total_job_hours, markup_pct, labor_rate, overhead_rate, dump_rate, cc_fee_rate,
  labor_cost, dump_fees, total_direct, overhead, profit, cc_fee, total_bid, true_margin_pct,
  quoted_price, quote_override_reason
) values (
  900101, 2,
  (select id from public.estimates where estimate_number = 900101 and version = 1),
  'sent',
  'total_hours', 10, 25, 26, 23, 300, 0.035,
  260, 0, 260, 230, 122.5, 0, 5000.00, 20,
  4800.00, 'fixture: discounted quote for the deviation-12 coalesce proof'
);

insert into public.estimates (
  estimate_number, version, status,
  labor_method, total_job_hours, markup_pct, labor_rate, overhead_rate, dump_rate, cc_fee_rate,
  labor_cost, dump_fees, total_direct, overhead, profit, cc_fee, total_bid, true_margin_pct
) values (
  900102, 1, 'sent',
  'total_hours', 5, 25, 26, 23, 300, 0.035,
  130, 0, 130, 115, 61.25, 0, 306.25, 20
);

insert into public.estimates (
  estimate_number, version, status,
  labor_method, total_job_hours, markup_pct, labor_rate, overhead_rate, dump_rate, cc_fee_rate,
  labor_cost, dump_fees, total_direct, overhead, profit, cc_fee, total_bid, true_margin_pct
) values (
  900103, 1, 'sent',
  'total_hours', 8, 25, 26, 23, 300, 0.035,
  208, 0, 208, 184, 98, 0, 490, 20
);

insert into public.estimate_presentations (estimate_id, presented_via, presented_by_name, actor_assurance, snapshot_hash)
values
  ((select id from public.estimates where estimate_number = 900101 and version = 1), 'email', 'Test Presenter', 'selected_identity', 'hash-fixture-900101-v1'),
  ((select id from public.estimates where estimate_number = 900101 and version = 2), 'email', 'Test Presenter', 'selected_identity', 'hash-fixture-900101-v2'),
  ((select id from public.estimates where estimate_number = 900103 and version = 1), 'ghl',   'Test Presenter', 'selected_identity', 'hash-fixture-900103-v1');
-- 900102 v1 is deliberately left unpresented.

-- 61: F1 -- accepting a superseded version raises, before any write.
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900101 and version = 1),
      'action', 'accepted',
      'authorization_method', 'text',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F1 fixture: accepting a superseded version must fail'
    ))
  $sql$,
  '%is superseded%accept the current version%',
  'F1: accepting the superseded v1 of family 900101 raises'
);

-- 62: pre-existing guard -- accepting an unpresented version raises.
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900102 and version = 1),
      'action', 'accepted',
      'authorization_method', 'text',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'unpresented fixture: accepting an unpresented version must fail'
    ))
  $sql$,
  '%has not been presented%',
  'accepting the unpresented v1 of family 900102 raises'
);

-- 63-64: happy path -- accepting the presented, current v2 succeeds, and
-- the state projection's accepted_price is the SERVER-DERIVED
-- coalesce(quoted_price, total_bid) = 4800.00 (quoted_price wins over the
-- 5000.00 total_bid), never a client-supplied number (deviation 12).
select lives_ok(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900101 and version = 2),
      'action', 'accepted',
      'authorization_method', 'signature',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'accepting the presented, current v2 of family 900101 must succeed'
    ))
  $sql$,
  'accepting the presented v2 of family 900101 succeeds'
);
select is(
  (select accepted_price::text from public.estimate_acceptance_state where estimate_number = 900101),
  '4800.00',
  'family 900101 state.accepted_price is the server-derived coalesce(quoted_price, total_bid), not total_bid'
);

-- 65: F2 -- reversing a version that is NOT the currently accepted one
-- (v1 of family 900101, never accepted, now superseded) raises, even
-- though the family DOES have an active acceptance (on v2).
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900101 and version = 1),
      'action', 'reversed',
      'reversal_destination', 'closed_lost',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F2 fixture: reversing a non-accepted version must fail'
    ))
  $sql$,
  '%is not the accepted version%',
  'F2: reversing the non-accepted v1 of family 900101 raises'
);

-- 66: F2 -- reversing a family with NO active acceptance at all raises the
-- other branch of the same guard (absent state row, not just wrong
-- version).
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900102 and version = 1),
      'action', 'reversed',
      'reversal_destination', 'closed_lost',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F2 fixture: reversing a family with no acceptance state must fail'
    ))
  $sql$,
  '%no active acceptance to reverse%',
  'F2: reversing family 900102 (never accepted) raises'
);

-- 67-68: reversing the ACTUAL currently-accepted version succeeds, and
-- flips the projection back to accepted=false.
select lives_ok(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900101 and version = 2),
      'action', 'reversed',
      'reversal_destination', 'closed_lost',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'reversing the currently-accepted v2 of family 900101 must succeed'
    ))
  $sql$,
  'reversing the accepted v2 of family 900101 succeeds'
);
select ok(
  (select accepted = false from public.estimate_acceptance_state where estimate_number = 900101),
  'family 900101 state.accepted is false after reversal'
);

-- 69-71: re-acceptance re-points correctly -- a second 'accepted' event
-- against the same version appends (not overwrites) the event log, and the
-- state projection's current_acceptance_event_id re-points to the NEW
-- event, not the first one.
select lives_ok(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900101 and version = 2),
      'action', 'accepted',
      'authorization_method', 'verbal',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 're-accepting v2 of family 900101 after reversal must succeed'
    ))
  $sql$,
  're-accepting v2 of family 900101 after reversal succeeds'
);
select is(
  (select count(*) from public.estimate_acceptance_events
    where estimate_id = (select id from public.estimates where estimate_number = 900101 and version = 2)
      and action = 'accepted'),
  2::bigint,
  'family 900101 v2 now carries 2 append-only accepted events (re-acceptance appends, never overwrites)'
);
-- D1 (re-review fix): events written in ONE transaction all share
-- created_at = transaction_timestamp(), so "order by created_at desc" is
-- non-deterministic inside a pgTAP run (it picked the FIRST acceptance on
-- the rig — the RPC was right, the assertion was wrong). Discriminate on
-- authorization_method, which the fixture makes unique per acceptance
-- ('signature' first, 'verbal' on re-acceptance). Production reads must
-- key off estimate_acceptance_state.current_acceptance_event_id, never
-- created_at ordering — recorded as a Task 4 handoff in the phase plan.
select is(
  (select current_acceptance_event_id from public.estimate_acceptance_state where estimate_number = 900101),
  (select id from public.estimate_acceptance_events
    where estimate_id = (select id from public.estimates where estimate_number = 900101 and version = 2)
      and action = 'accepted'
      and authorization_method = 'verbal'),
  'family 900101 state.current_acceptance_event_id re-points to the re-acceptance event'
);

-- 72-73: F4 -- {"evidence_paths": null} no longer raises the pre-fix opaque
-- "cannot extract elements from a scalar" error; it resolves cleanly to an
-- empty array, same as the field being omitted entirely.
select lives_ok(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900103 and version = 1),
      'action', 'accepted',
      'authorization_method', 'email',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F4 fixture: JSON null evidence_paths must not raise',
      'evidence_paths', 'null'::jsonb
    ))
  $sql$,
  'F4: accepting with evidence_paths explicitly JSON null no longer raises the opaque scalar-extraction error'
);
select is(
  (select evidence_paths from public.estimate_acceptance_events
    where estimate_id = (select id from public.estimates where estimate_number = 900103 and version = 1)
      and action = 'accepted'),
  array[]::text[],
  'F4: JSON null evidence_paths resolves to an empty array, same as an omitted field'
);

-- 74: v2 RPC rejects '{}' as p_financial_details (guard fires before any
-- write, so the rest of p_estimate/p_line_items can be empty/irrelevant).
select throws_like(
  $sql$
    select create_estimate_with_items_v2('{}'::jsonb, '[]'::jsonb, '{}'::jsonb)
  $sql$,
  '%p_financial_details is required%',
  'create_estimate_with_items_v2 rejects an empty-object p_financial_details'
);

-- 75-76: F5 -- an 'accepted' event missing either conditionally-required
-- field raises a clean, one-line message here, not the CHECK constraint's
-- full definition dump.
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900103 and version = 1),
      'action', 'accepted',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F5 fixture: missing authorization_method must fail cleanly'
    ))
  $sql$,
  '%authorization_method is required for an accepted event%',
  'F5: an accepted event missing authorization_method raises a clean message'
);
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900103 and version = 1),
      'action', 'accepted',
      'authorization_method', 'text',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F5 fixture: missing customer_contact_name must fail cleanly'
    ))
  $sql$,
  '%customer_contact_name is required for an accepted event%',
  'F5: an accepted event missing customer_contact_name raises a clean message'
);

-- 77-78: F13 -- supersedes_event_id, when present, must reference an
-- existing event of the SAME estimate family.
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900103 and version = 1),
      'action', 'accepted',
      'authorization_method', 'text',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F13 fixture: nonexistent supersedes_event_id must fail',
      'supersedes_event_id', gen_random_uuid()::text
    ))
  $sql$,
  '%does not reference an existing event in estimate family%',
  'F13: a nonexistent supersedes_event_id raises'
);
select throws_like(
  $sql$
    select record_estimate_acceptance_event(jsonb_build_object(
      'estimate_id', (select id::text from public.estimates where estimate_number = 900103 and version = 1),
      'action', 'accepted',
      'authorization_method', 'text',
      'customer_contact_name', 'Test Customer',
      'recorded_by_name', 'Test Actor',
      'actor_assurance', 'selected_identity',
      'note', 'F13 fixture: cross-family supersedes_event_id must fail',
      'supersedes_event_id', (
        select id::text from public.estimate_acceptance_events
         where estimate_id = (select id from public.estimates where estimate_number = 900101 and version = 2)
         limit 1
      )
    ))
  $sql$,
  '%does not reference an existing event in estimate family%',
  'F13: a supersedes_event_id from a different estimate family (900101, targeting 900103) raises'
);

select * from finish();
rollback;
