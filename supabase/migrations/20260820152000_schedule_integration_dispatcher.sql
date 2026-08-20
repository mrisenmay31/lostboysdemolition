-- Profitability v2 Phase 1, Task 5A (Session 4, SQL lane) — schedules the
-- outbound integration dispatcher via pg_cron + pg_net.
--
-- Structure copied from 20260813170000_schedule_crew_night_before.sql,
-- which is the house pattern for a cron-fired webhook. One job only, no DST
-- dance needed: `*/5 * * * *` is a fixed-interval cron expression, so it
-- fires every 5 minutes in UTC regardless of America/Denver's DST state —
-- unlike crew-night-before's fixed local send-time requirement (16:00
-- Denver), there is no local wall-clock target here for the dispatcher to
-- drift relative to.
--
-- SECRET PLACEHOLDER — same deliberate divergence as
-- 20260813170000_schedule_crew_night_before.sql: Supabase Vault is not set
-- up for this secret yet, so the x-webhook-secret header below carries the
-- literal placeholder '__WEBHOOK_SECRET__'. The controller substitutes the
-- real GHL_WEBHOOK_SECRET value at apply time (e.g. a pre-apply sed, or
-- hand-editing this header in the Supabase SQL editor before running it);
-- this repo file keeps the placeholder so the real secret is never
-- committed to git. Applying this migration verbatim WITHOUT that
-- substitution means the integration-dispatcher function 401s on every
-- fire.
--
-- DEPLOY POSTURE: the sibling supabase/functions/integration-dispatcher
-- edge function (not created by this migration — a different lane's file)
-- MUST be deployed with --no-verify-jwt, same as ghl-job-webhook and
-- crew-night-before. The cron POST below carries only x-webhook-secret, no
-- Authorization header — gateway JWT verification would reject every fire.
--
-- cron.schedule() with an existing job name REPLACES that job's definition,
-- so re-applying this migration (e.g. during a branch validation cycle) is
-- idempotent on the job name alone.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'integration-dispatcher',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/integration-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '__WEBHOOK_SECRET__'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
