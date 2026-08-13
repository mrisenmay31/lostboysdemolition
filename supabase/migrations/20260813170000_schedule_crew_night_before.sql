-- Schedules crew-night-before to fire twice daily via pg_cron + pg_net.
--
-- DST ruling (Task 5 brief / CLAUDE.md Phase A): pg_cron schedules run in UTC
-- with no DST awareness, so a single fixed UTC time drifts an hour relative
-- to America/Denver local time across the March/November changeovers. Rather
-- than maintain two seasonal cron edits, this migration schedules BOTH
-- 22:30 and 23:30 UTC every day. The function itself (crew-night-before/
-- handlers.ts, isInSendWindow) computes the America/Denver local hour via
-- Intl.DateTimeFormat and no-ops (200 {action:"skipped", reason:"outside
-- send window"}) unless the local hour is exactly 16 (4pm) — so exactly one
-- of the two daily fires actually sends:
--   MDT (summer, UTC-6): 22:30 UTC = 16:30 local  → sends
--                         23:30 UTC = 17:30 local  → no-ops
--   MST (winter, UTC-7): 22:30 UTC = 15:30 local  → no-ops
--                         23:30 UTC = 16:30 local  → sends
--
-- SECRET PLACEHOLDER — deliberate divergence, documented per controller
-- ruling: Supabase Vault is not set up for this secret yet, so the
-- x-webhook-secret header below carries the literal placeholder
-- '__WEBHOOK_SECRET__'. The controller substitutes the real GHL_WEBHOOK_SECRET
-- value at apply time (e.g. via a pre-apply sed, or hand-editing this header
-- in the Supabase SQL editor before running it); this repo file keeps the
-- placeholder so the real secret is never committed to git. Do not apply this
-- migration verbatim without that substitution — the function will 401.
--
-- cron.schedule() with an existing job name REPLACES that job's definition
-- (no separate unschedule-then-schedule dance needed); the two jobs use
-- distinct names so each call is independently idempotent on re-apply.
--
-- DEPLOY RULING (fix round 1, F4): deploy crew-night-before with
-- --no-verify-jwt. The cron POST below carries only x-webhook-secret, no
-- Authorization header — gateway JWT verification would reject every fire.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'crew-night-before-a',
  '30 22 * * *',
  $$
  select net.http_post(
    url := 'https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/crew-night-before',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '__WEBHOOK_SECRET__'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

select cron.schedule(
  'crew-night-before-b',
  '30 23 * * *',
  $$
  select net.http_post(
    url := 'https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/crew-night-before',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '__WEBHOOK_SECRET__'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
