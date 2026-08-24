-- Profitability v2 Phase 1, Task 5B Step 2 (Lane S) — schedules the
-- Calendar-sync maintenance sweep via pg_cron + pg_net.
--
-- Structure copied from 20260820152000_schedule_integration_dispatcher.sql,
-- the house pattern for a cron-fired webhook. One job only, fixed
-- 5-minute-offset interval (`7,37 * * * *` fires at :07 and :37 past every
-- hour, UTC) — deliberately offset from integration-dispatcher's `*/5`
-- cadence so the two jobs' fires don't cluster on the same tick.
--
-- SECRET PLACEHOLDER — same deliberate divergence as
-- 20260820152000_schedule_integration_dispatcher.sql: Supabase Vault is not
-- set up for this secret yet, so the x-webhook-secret header below carries
-- the literal placeholder '__WEBHOOK_SECRET__'. The controller substitutes
-- the real GHL_WEBHOOK_SECRET value at apply time (e.g. a pre-apply sed, or
-- hand-editing this header in the Supabase SQL editor before running it);
-- this repo file keeps the placeholder so the real secret is never
-- committed to git. Applying this migration verbatim WITHOUT that
-- substitution means the google-calendar-webhook function 401s on every
-- maintenance fire.
--
-- DEPLOY POSTURE: the sibling supabase/functions/google-calendar-webhook
-- edge function (not created by this migration — a different lane's file)
-- MUST be deployed with --no-verify-jwt, same as ghl-job-webhook,
-- crew-night-before, and integration-dispatcher. The cron POST below
-- carries only x-webhook-secret, no Authorization header — gateway JWT
-- verification would reject every fire. The function's `ping`/`register`/
-- `stop` admin actions already share this posture (see
-- google-calendar-webhook's Task 5B Step 1 spike scaffold); `maintain` is a
-- fourth admin action of the same class, gated the same way.
--
-- cron.schedule() with an existing job name REPLACES that job's definition,
-- so re-applying this migration (e.g. during a branch validation cycle) is
-- idempotent on the job name alone.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'calendar-sync-maintenance',
  '7,37 * * * *',
  $$
  select net.http_post(
    url := 'https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/google-calendar-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '__WEBHOOK_SECRET__'
    ),
    body := '{"action":"maintain"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
