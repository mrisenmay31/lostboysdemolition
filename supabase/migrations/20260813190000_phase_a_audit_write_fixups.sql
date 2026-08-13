-- Live verification of ghl-job-webhook found both audit writes rejected (PostgREST 400):
-- 1) sync_log.direction CHECK allows only the two Airtable sync directions; Phase A
--    introduces 'ghl_to_supabase' (job webhook) and 'supabase_to_slack' (night-before digest).
-- 2) job_events.job_id is NOT NULL, but it is the LEGACY column (holds Airtable recXXX IDs);
--    Phase A code intentionally writes job_number only (see comment on the column).
-- Undocumented constraints — CLAUDE.md recorded only the action_taken check. Document in Task 7.

alter table public.sync_log drop constraint sync_log_direction_check;
alter table public.sync_log add constraint sync_log_direction_check
  check (direction = any (array[
    'ghl_to_airtable'::text, 'airtable_to_ghl'::text,
    'ghl_to_supabase'::text, 'supabase_to_slack'::text
  ]));

alter table public.job_events alter column job_id drop not null;
