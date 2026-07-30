-- Close the RLS bypass created by two SECURITY DEFINER views over sync_log.
--
-- recent_sync_activity and sync_errors both read from sync_log. As SECURITY DEFINER
-- views they executed with the owner's privileges (postgres, rolbypassrls = true),
-- so enabling RLS on sync_log in the previous migration did NOT close the hole:
-- anon could still read client emails through recent_sync_activity, and full webhook
-- payloads (names, phones, addresses) through sync_errors.
--
-- Confirmed empirically before the fix: anon returned 50 rows from recent_sync_activity
-- despite sync_log having RLS enabled.
--
-- security_invoker = on makes each view execute as the querying role, so sync_log's RLS
-- applies normally. Verified after applying: anon -> 0 rows on both views;
-- service_role -> 50 and 12 rows respectively.

ALTER VIEW public.recent_sync_activity SET (security_invoker = on);
ALTER VIEW public.sync_errors          SET (security_invoker = on);
