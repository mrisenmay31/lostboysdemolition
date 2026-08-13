-- Phase A keystone: canonical job record. Evolves public.jobs in place.
-- Existing 7 rows are May-2026 test mirrors (FK target for empty time_entries); archived below.

-- 1. Archive legacy mirror rows, keep the table
create table if not exists jobs_legacy_backup as select * from jobs;
delete from jobs;

-- 2. Job-number sequence. Airtable's autonumber is at ~JOB-1012 and mints ~3/month;
--    1100 leaves ~87 numbers of headroom for parallel running with zero collision risk.
create sequence if not exists job_number_seq start 1100;
create or replace function next_job_number() returns text
language sql as $$ select 'JOB-' || nextval('job_number_seq')::text $$;

-- 3. Status enum for the new lifecycle
-- NB: type name job_status is taken by the legacy jobs.status enum {active,archived}
do $$ begin
  create type job_lifecycle as enum
    ('accepted','scheduled','in_progress','completed','invoiced','paid','cancelled');
exception when duplicate_object then null; end $$;

-- 4. Reshape jobs. Old columns airtable_job_id/airtable_status/estimated_hours/
--    job_start_date/archived_at kept for now (legacy readers); new canonical columns added.
alter table jobs
  add column if not exists job_number text unique,
  add column if not exists client_name text,
  add column if not exists client_type text,
  add column if not exists job_address text,
  add column if not exists city text,
  add column if not exists ghl_opportunity_id text unique,
  add column if not exists ghl_contact_id text,
  add column if not exists estimate_value numeric,
  add column if not exists crew text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists status_v2 job_lifecycle,
  add column if not exists gcal_main_event_id text,
  add column if not exists gcal_crew_event_id text,
  add column if not exists slack_notified_at timestamptz,
  add column if not exists night_before_sent_on date,
  add column if not exists bill_job_code text,
  add column if not exists updated_at timestamptz default now();

-- 5. Key-format guard (canonical validator, DB-side)
alter table jobs add constraint jobs_job_number_format
  check (job_number is null or job_number ~ '^JOB-\d{4,}$');

-- 6. RLS — jobs was missed by the 2026-07-30 security sweep
alter table jobs enable row level security;
alter table jobs_legacy_backup enable row level security;

-- 7. Legacy-semantics documentation
comment on column job_events.job_id is
  'LEGACY: holds Airtable recXXX IDs (written by airtable-* functions). New code writes job_number only.';
