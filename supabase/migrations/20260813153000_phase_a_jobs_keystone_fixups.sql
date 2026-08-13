-- Fixups for phase_a_jobs_keystone, from the Task 1 adversarial review.
-- The keystone migration is applied and immutable; corrections land here.

-- (R1, Critical) airtable_job_id was NOT NULL with no default — every canonical
-- (non-Airtable) insert would fail 23502. Legacy writer receive-airtable-webhook
-- always supplies it, so relaxing is safe for both paths.
alter table public.jobs alter column airtable_job_id drop not null;

-- (R8) Pin search_path; schema-qualify. Advisor: function_search_path_mutable.
create or replace function public.next_job_number() returns text
language sql
set search_path = public
as $$ select 'JOB-' || nextval('public.job_number_seq')::text $$;

-- (R7) Drop the two pre-existing policies from the never-launched clock-in schema.
-- Restores the documented "RLS on, no policies" posture (2026-07-30 sweep);
-- Phase-4 PWA will add properly scoped policies when real users exist.
drop policy if exists authenticated_select_jobs on public.jobs;
drop policy if exists admins_manage_jobs on public.jobs;
