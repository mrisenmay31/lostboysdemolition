-- Phase B slice-2, Task 4: ghl_push_state (idempotency/state tracking for the estimate-builder's
-- GHL push) + widen sync_log.direction to allow the app's own push writes.
--
-- 1) ghl_push_state: one row per estimate, tracking what has been pushed to GHL (contact/
--    opportunity linkage, the pushed GHL custom-field values, and the generated estimate
--    document), plus a lightweight retry/error trail. This is NOT part of the immutable
--    estimates/estimate_line_items lineage — it is ordinary mutable/deletable state describing
--    push progress, so it carries no versioning or immutability triggers.
--
-- 2) sync_log_direction_check: same drop-and-re-add pattern as
--    20260813190000_phase_a_audit_write_fixups.sql. That migration widened the constraint from
--    the original two Airtable-era directions to also allow 'ghl_to_supabase' and
--    'supabase_to_slack' for Phase A. This migration appends 'app_to_ghl' for the Next.js
--    estimate builder's direct push to GHL (Phase B slice-2) — the constraint has never had an
--    app-initiated direction before now.

create table public.ghl_push_state (
  estimate_id uuid primary key references public.estimates(id),
  ghl_contact_id text,
  ghl_opportunity_id text,
  ghl_estimate_id text,
  ghl_estimate_number text,
  fields_pushed_at timestamptz,
  doc_pushed_at timestamptz,
  last_error text,
  attempts int not null default 0,
  -- No update trigger: this schema has no updated_at-maintenance-trigger convention (see
  -- scope_library.updated_at, which is set-on-insert only). The app layer sets updated_at
  -- explicitly on every upsert, same as elsewhere in this codebase.
  updated_at timestamptz not null default now()
);

comment on table public.ghl_push_state is
  'Per-estimate state for the estimate builder''s push to GHL (contact/opportunity linkage, '
  'pushed field/document timestamps, retry count, last error). Mutable and deletable by design '
  '-- unlike estimates/estimate_line_items, this is not part of the immutable estimate lineage.';

alter table public.ghl_push_state enable row level security;

alter table public.sync_log drop constraint sync_log_direction_check;
alter table public.sync_log add constraint sync_log_direction_check
  check (direction = any (array[
    'ghl_to_airtable'::text, 'airtable_to_ghl'::text,
    'ghl_to_supabase'::text, 'supabase_to_slack'::text,
    'app_to_ghl'::text
  ]));
