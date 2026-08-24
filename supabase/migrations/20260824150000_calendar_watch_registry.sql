-- Profitability v2 Phase 1, Task 5B Step 2 (Lane S) — inbound Google
-- Calendar sync: watch-channel registry + inbound dedup marks.
--
-- Companion migrations: 20260824151000_calendar_inbound_rpcs.sql (the three
-- RPCs that read/write these tables and the sync_log widening below),
-- 20260824152000_schedule_calendar_maintenance.sql (the pg_cron job that
-- drives channel renewal + a reconciliation sweep).
--
-- Cross-lane API (Tasks 2 and 3 — the edge-function and web lanes — wire
-- against these exact names; do not rename):
--   - enum public.watch_channel_status
--   - table public.calendar_watch_channels
--   - table public.calendar_inbound_marks
--   - partial unique index public.job_schedule_exceptions_one_open
--   - sync_log.direction widened to accept 'google_to_supabase'
--
-- House patterns mirrored, verbatim:
--   - RLS enabled, NO policies, explicit `revoke all ... from public, anon,
--     authenticated` on every new table (deviation 2, established
--     20260819151000_profitability_core_schema.sql's header) — Supabase's
--     default privileges pre-grant `authenticated` REFERENCES/TRIGGER/
--     TRUNCATE on a fresh table, and TRUNCATE is NOT RLS-gated.
--     service_role bypasses RLS (rolbypassrls = true) and keeps full access
--     via its default privileges — no explicit grant needed.
--   - No immutability triggers. Both tables are mutable operational
--     bookkeeping, the same class as `ghl_push_state`
--     (20260814220000_phase_b2_ghl_push_state.sql) — a channel's status/
--     last_notification_at/last_error and an inbound mark's outcome are
--     sync-progress bookkeeping, not a versioned business record.
--   - sync_log.direction widening: same drop-and-re-add-by-name pattern as
--     20260813190000_phase_a_audit_write_fixups.sql (which added
--     'ghl_to_supabase'/'supabase_to_slack') and
--     20260814220000_phase_b2_ghl_push_state.sql (which added 'app_to_ghl')
--     — each widening drops the PRIOR migration's constraint by its live
--     name (sync_log_direction_check, verified live via pg_constraint
--     ahead of this migration, per the runbook) and re-adds it with one
--     more value in the allowed list. Lane F's log writes for the inbound
--     Calendar path depend on 'google_to_supabase' existing before that
--     lane's edge function ever fires.
--
-- Design decision 2 (plan header): calendar_inbound_marks dedups on
-- CALENDAR_ID, not resource_id. Google's push notifications key on
-- X-Goog-Resource-ID, which is stable for the LIFE of one watch channel but
-- is reassigned on renewal (a new channel for the same calendar gets a new
-- resource id) — deduping on resource_id would let a renewal-boundary
-- notification for the same (event, updated) generation slip through as
-- "new" a second time. calendar_id is the stable identity across a
-- renewal, so it is the correct dedup key. See
-- 20260824151000_calendar_inbound_rpcs.sql's header for how this table is
-- read at the edge-function layer (out of scope for this migration —
-- Lane F owns the read/write call sites; this migration only owns the
-- schema and the uniqueness constraint that makes dedup possible).
create type public.watch_channel_status as enum ('active','superseded','expired','renewal_failed');

create table public.calendar_watch_channels (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  resource_id text not null,
  calendar_id text not null,
  token_hash text not null,
  registered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status public.watch_channel_status not null default 'active',
  last_notification_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- At most one ACTIVE channel per calendar. Renewal registers the
-- replacement BEFORE stopping the old one, so the old row must already be
-- 'superseded' before the new row inserts as 'active' — the edge function's
-- renewal sequence (mark old superseded -> insert new active -> stop old)
-- is ordered around exactly this index.
create unique index calendar_watch_channels_one_active
  on public.calendar_watch_channels (calendar_id) where status = 'active';

-- Inbound dedup marks (design decision 2 above: calendar_id, not
-- resource_id). Insert AFTER a successful outcome only; a conflict means an
-- overlapping channel or the reconciliation poll already processed exactly
-- this (event, updated) generation.
create table public.calendar_inbound_marks (
  id bigint generated always as identity primary key,
  calendar_id text not null,
  event_id text not null,
  event_updated timestamptz not null,
  outcome text not null,
  processed_at timestamptz not null default now(),
  unique (calendar_id, event_id, event_updated)
);

-- One OPEN deletion exception per (job, external event) — the inbound path
-- inserts with ON CONFLICT DO NOTHING against this index (see
-- open_calendar_deletion_exception in the companion RPC migration).
create unique index job_schedule_exceptions_one_open
  on public.job_schedule_exceptions (job_number, external_event_id)
  where status = 'open';

alter table public.calendar_watch_channels enable row level security;
alter table public.calendar_inbound_marks enable row level security;
revoke all on table public.calendar_watch_channels from public, anon, authenticated;
revoke all on table public.calendar_inbound_marks from public, anon, authenticated;

-- calendar_watch_channels.id and calendar_inbound_marks.id use
-- gen_random_uuid()/identity respectively — calendar_inbound_marks.id is
-- `generated always as identity`, which creates
-- calendar_inbound_marks_id_seq. Same gap Task 1's core-schema migration
-- found and closed for job_cost_entry_audit_id_seq (A3 in that file's
-- header): Supabase's default privileges pre-grant `authenticated`/`anon`
-- USAGE on a freshly created sequence, and the table-only revoke sweep
-- above does not touch it.
revoke all on sequence public.calendar_inbound_marks_id_seq from public, anon, authenticated;

create index idx_calendar_watch_channels_expiry
  on public.calendar_watch_channels (status, expires_at);
create index idx_calendar_inbound_marks_age
  on public.calendar_inbound_marks (processed_at);

-- Widen sync_log.direction for the inbound leg's log writes (house
-- pattern: phase_a_audit_write_fixups and phase_b2_ghl_push_state did
-- exactly this drop-and-re-add for their new directions). Constraint name
-- verified live via pg_constraint ahead of this migration, per the runbook
-- — it is sync_log_direction_check, the conventional default, unchanged
-- since 20260814220000_phase_b2_ghl_push_state.sql last redefined it.
alter table public.sync_log drop constraint sync_log_direction_check;
alter table public.sync_log add constraint sync_log_direction_check
  check (direction in ('ghl_to_airtable','airtable_to_ghl','ghl_to_supabase',
                       'supabase_to_slack','app_to_ghl','google_to_supabase'));
