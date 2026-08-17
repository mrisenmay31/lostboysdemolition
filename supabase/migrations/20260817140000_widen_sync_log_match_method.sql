-- Adversarial review of the airtable-client-sync fix (fix/airtable-client-sync-update)
-- found the search-match path and the GHL duplicate-400 fallback path both wrote
-- match_method='email', making them indistinguishable in sync_log. That matters:
-- if the repaired POST /contacts/search leg is broken in production (e.g. a
-- token-scope 401), every first sync would silently fall through to
-- create -> 400 -> update and produce a log row identical to a successful search
-- match, so nobody could tell the search fix was dead.
--
-- Widen sync_log_match_method_check to allow 'email_duplicate' as a distinct value
-- for the duplicate-400 fallback, alongside the existing 'ghl_contact_id', 'email',
-- and 'none'. Same shape as the direction-check widening in
-- 20260813190000_phase_a_audit_write_fixups.sql.

alter table public.sync_log drop constraint if exists sync_log_match_method_check;
alter table public.sync_log add constraint sync_log_match_method_check
  check (match_method = any (array[
    'ghl_contact_id'::text, 'email'::text, 'none'::text, 'email_duplicate'::text
  ]));
