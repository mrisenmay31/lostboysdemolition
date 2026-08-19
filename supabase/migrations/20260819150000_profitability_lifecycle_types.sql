-- Profitability v2 Phase 1, Task 1 (Lane A) — financial lifecycle enum.
--
-- Deliberately kept separate from the core schema migration
-- (20260819151000_profitability_core_schema.sql), matching the v2 spec's own
-- file split. Adds ONLY `job_financial_status`, using the same
-- create-type-if-not-exists guard pattern the v2 doc specifies (`do $$ ...
-- exception when duplicate_object then null; end $$`), so a partial re-apply
-- is idempotent.
--
-- `job_financial_status` tracks the internal MONEY lifecycle independently
-- of `jobs.status_v2` (the `job_lifecycle` enum: accepted/scheduled/
-- in_progress/completed/invoiced/paid/cancelled), which tracks OPERATIONAL
-- state. Per the v2 spec (Task 1, Step 3): do not add pre-job stages here —
-- no `jobs` row exists at "Quote Accepted" (Task 4 mints `JOB-XXXX` only at
-- scheduling), so `job_financial_status` starts at 'not_ready' and the
-- operational enum's existing values are left untouched.
do $$ begin
  create type public.job_financial_status as enum (
    'not_ready',
    'invoice_review',
    'invoice_sent',
    'paid_reconciliation_pending',
    'financially_closed',
    'reconciliation_required'
  );
exception when duplicate_object then null; end $$;
