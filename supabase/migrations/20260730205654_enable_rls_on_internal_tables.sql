-- Enable RLS on the six internal tables that were fully exposed to the anon key.
--
-- These tables are written and read exclusively by edge functions authenticating with
-- SUPABASE_SERVICE_ROLE_KEY. service_role has rolbypassrls = true, so it is unaffected
-- by RLS. No policies are created intentionally: there is no legitimate anon or
-- authenticated consumer of these tables, so deny-by-default is the correct posture.
--
-- Before this change, anyone holding the anon key could read or modify 989 client
-- records via client_sync_state and 667 stored webhook payloads via sync_log.
--
-- Verified after applying:
--   anon         -> 0 rows on client_sync_state
--   service_role -> full read access, and INSERT succeeds (probe row written + removed)

ALTER TABLE public.sync_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_sync_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_reminders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_actuals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_actuals    ENABLE ROW LEVEL SECURITY;
