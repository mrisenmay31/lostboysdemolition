# supabase_integration_notes.md (formerly schema_overview.md)

> **This file does NOT contain the Airtable schema.** `CLAUDE.md` and
> `LostBoys_PricingEngine_ProjectBrief.md` both describe it as the "Airtable schema field
> reference" / "complete schema reference". That has been false since commit `3a6af2d`
> (2026-05-01), which replaced the 498-line Airtable spec with the Supabase integration guide
> below and pasted it twice. The duplicate copy (former lines 325-646) was removed 2026-07-30.
>
> The original Airtable spec survives only in git history: `git show d9eedd6:schema_overview.md`.
> For the live schema, see `SYSTEM_AUDIT_2026-07-30.md`.
>
> **The build sequence below is a SUPERSEDED PLAN, not a backlog.** The `stageN-*` naming was
> abandoned for `airtable-*`, several triggers differ from what shipped, and the whole approach
> is being replaced per `BUILD_PLAN.md`. Retained for historical context only.

---

## SUPABASE INTEGRATION — Read This Before Building Any Edge Function

**Last updated:** May 1, 2026

### Project
- **Project name:** Lost Boys Demolition
- **Project ID:** `eiqqqwajmcpcwhvxxnhx`
- **Region:** us-west-1
- **URL:** `https://eiqqqwajmcpcwhvxxnhx.supabase.co`
- **Runtime:** Deno (not Node.js) — use `https://esm.sh/` imports

---

### Hard Rules — Read Before Writing Any Code

1. **One function per trigger.** No shared routing logic. Each pipeline stage transition has its own Edge Function.
2. **Every function writes to `sync_log`.** No exceptions. Success, error, and skipped events all get logged.
3. **Never overwrite Layer 0 functions.** `ghl-contact-sync` and `airtable-client-sync` are deployed and wired. Do not redeploy unless explicitly instructed.
4. **Never re-run migration 001.** `sync_log` and `client_sync_state` are already migrated. Running it again will error.
5. **Zapier exception — do not touch.** Fillout form submission → Airtable Jobs record creation stays on Zapier. Do not build a function to replace this.
6. **Layer 3 is placeholder only.** Do not build Gusto or Divvy functions until API capability is confirmed. When in doubt, ask.
7. **Build in sequence order.** See Build Sequence below. Never skip ahead — functions depend on prior ones being tested and stable.

---

### What Is Already Built (Do Not Recreate)

#### Edge Functions — Deployed
| Function | Slug | Status |
|---|---|---|
| GHL → Airtable contact sync | `ghl-contact-sync` | Active |
| Airtable → GHL contact sync | `airtable-client-sync` | Active |

#### Database Tables — Already Migrated (Migration 001)
| Table | Purpose |
|---|---|
| `sync_log` | Audit log — every sync event from every function |
| `client_sync_state` | Current linked state per client email — one row per client |

#### Database Views — Already Created
| View | Purpose |
|---|---|
| `recent_sync_activity` | sync_log filtered to last 7 days |
| `sync_errors` | sync_log filtered to status = error |

---

### What Needs To Be Built Next

#### Migration 002 — Run This First in Any New Session Before Building Layer 1

```sql
-- job_events: pipeline stage transition audit log
CREATE TABLE IF NOT EXISTS job_events (
  id                 BIGSERIAL PRIMARY KEY,
  job_id             TEXT NOT NULL,
  job_number         TEXT,
  stage_from         INTEGER,
  stage_to           INTEGER NOT NULL,
  function_name      TEXT NOT NULL,
  trigger_source     TEXT NOT NULL,
  ghl_opportunity_id TEXT,
  action_summary     TEXT,
  status             TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  error_message      TEXT,
  payload_in         JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_id     ON job_events (job_id);
CREATE INDEX IF NOT EXISTS idx_job_events_job_number ON job_events (job_number);
CREATE INDEX IF NOT EXISTS idx_job_events_stage_to   ON job_events (stage_to);
CREATE INDEX IF NOT EXISTS idx_job_events_created_at ON job_events (created_at DESC);

-- invoice_reminders: payment reminder schedule tracker
CREATE TABLE IF NOT EXISTS invoice_reminders (
  id                  BIGSERIAL PRIMARY KEY,
  job_id              TEXT NOT NULL UNIQUE,
  job_number          TEXT,
  client_type         TEXT NOT NULL CHECK (client_type IN ('Contractor', 'Homeowner')),
  client_email        TEXT NOT NULL,
  invoice_sent_date   DATE NOT NULL,
  invoice_amount      NUMERIC,
  reminders_sent      INTEGER NOT NULL DEFAULT 0,
  last_reminder_day   INTEGER,
  last_reminder_at    TIMESTAMPTZ,
  escalated_to_dane   BOOLEAN NOT NULL DEFAULT FALSE,
  payment_received    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_job_id          ON invoice_reminders (job_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_payment_received ON invoice_reminders (payment_received);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_sent_date        ON invoice_reminders (invoice_sent_date);

-- labor_actuals: placeholder — do not populate until Gusto API confirmed
CREATE TABLE IF NOT EXISTS labor_actuals (
  id             BIGSERIAL PRIMARY KEY,
  job_id         TEXT NOT NULL,
  job_number     TEXT,
  employee_name  TEXT,
  hours          NUMERIC,
  gusto_entry_id TEXT,
  period_start   DATE,
  period_end     DATE,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- expense_actuals: placeholder — do not populate until Divvy API confirmed
CREATE TABLE IF NOT EXISTS expense_actuals (
  id                  BIGSERIAL PRIMARY KEY,
  job_id              TEXT NOT NULL,
  job_number          TEXT,
  amount              NUMERIC,
  vendor              TEXT,
  category            TEXT,
  divvy_transaction_id TEXT,
  transaction_date    DATE,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**How to apply:** Use `Supabase:apply_migration` with name `job_events_and_reminders`. Verify with `Supabase:list_migrations` before running — if migration 002 already exists, skip it.

---

### Edge Function Template

Every new Edge Function must follow this structure exactly:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET      = Deno.env.get('AIRTABLE_WEBHOOK_SECRET')! // or GHL_ or FILLOUT_

// ── other env vars specific to this function ──

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // 1. Validate shared secret
  const incomingSecret = req.headers.get('x-webhook-secret')
  if (incomingSecret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // 2. Parse payload
  let payload: any
  try { payload = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  // 3. Extract fields
  // ...

  // 4. Initialize tracking vars
  let status       = 'success'
  let actionTaken  = 'error'
  let errorMessage: string | null = null

  try {
    // 5. Core logic here
    // ...
    actionTaken = 'updated' // or 'created' or 'skipped'

    // 6. Write to job_events (Layer 1+ functions)
    await supabase.from('job_events').insert({
      job_id:          '...', // Airtable record ID
      job_number:      '...', // JOB-XXXX
      stage_from:      N,
      stage_to:        N,
      function_name:   'function-name-here',
      trigger_source:  'airtable_automation', // or fillout / ghl_workflow / stripe_webhook / pg_cron
      action_summary:  'Human readable description of what happened',
      status,
      error_message:   errorMessage,
      payload_in:      payload,
    })

  } catch (err: any) {
    status       = 'error'
    actionTaken  = 'error'
    errorMessage = err.message ?? String(err)
  }

  // 7. Always write to sync_log — no exceptions
  await supabase.from('sync_log').insert({
    direction:      'airtable_to_ghl', // or ghl_to_airtable
    trigger_event:  'event_name',
    status,
    error_message:  errorMessage,
    payload_in:     payload,
    // ... other fields as relevant
  })

  // 8. Return response
  return new Response(
    JSON.stringify({ success: status === 'success', action: actionTaken }),
    { status: status === 'success' ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  )
})
```

---

### Build Sequence — Layer 1 (GHL Pipeline)

Build in this exact order. Do not skip ahead.

| # | Function Name | Trigger | Dependency |
|---|---|---|---|
| 1 | `stage3-estimate-submitted` | Airtable Automation — Jobs record created | Migration 002 complete |
| 2 | `stage3-quote-sent` | Called internally by stage3-estimate-submitted | #1 working |
| 3 | `stage4-followup-task` | GHL scheduled delay — 5 business days | #2 working |
| 4 | `stage5-schedule-confirmed` | Airtable Automation — Jobs: Start Date + Crew populated | #3 working |
| 5 | `stage6-job-scheduled` | Called by stage5-schedule-confirmed | #4 + Google Calendar + Slack secrets set |
| 6 | `stage7-job-started` | Fillout Job Started checklist webhook | #5 working |
| 7 | `stage7-labor-variance-alert` | Airtable Automation — Labor Hour Variance ≥ 15% | #6 + Slack secrets set |
| 8 | `stage8-job-completed` | Fillout Job Finished checklist webhook | #7 working |
| 9 | `stage9-invoice-review` | Called by stage8-job-completed | #8 working |
| 10 | `stage9-review-escalation` | GHL scheduled delay — 24 hours | #9 working |
| 11 | `stage10-invoice-sent` | Airtable Automation — Ready for Invoice checked | Invoicing tool decision made |
| 12 | `stage10-payment-reminder` | pg_cron scheduled — daily check | #11 + pg_cron enabled |
| 13 | `stage10-payment-alert` | Called by stage10-payment-reminder | #12 working |
| 14 | `stage11-closed-won` | Stripe webhook — payment_intent.succeeded | #13 + Stripe secret set |
| 15 | `stage11-review-request` | Called by stage11-closed-won | #14 working |

**Layer 2 (Stripe):** `stage11-closed-won` — build after all Layer 1 functions are stable.

**Layer 3 (Gusto + Divvy):** `gusto-hours-sync`, `gusto-project-create`, `divvy-expense-sync`, `divvy-tag-create` — **do not build** until API capability is confirmed.

---

### Environment Secrets Reference

All secrets are set in Supabase → Project Settings → Edge Functions.

| Secret | Used by | Notes |
|---|---|---|
| `AIRTABLE_API_KEY` | All functions | In .env file |
| `AIRTABLE_BASE_ID` | All functions | `apptzp0IclCaAtOk2` |
| `GHL_API_KEY` | All GHL functions | GHL Private Integration key |
| `GHL_LOCATION_ID` | All GHL functions | GHL Business Profile |
| `GHL_WEBHOOK_SECRET` | `ghl-contact-sync` | Random string — must match GHL workflow header |
| `AIRTABLE_WEBHOOK_SECRET` | Airtable-triggered functions | Random string — must match Airtable script constant |
| `FILLOUT_WEBHOOK_SECRET` | `stage7-job-started`, `stage8-job-completed` | Set in Fillout webhook settings |
| `STRIPE_WEBHOOK_SECRET` | `stage11-closed-won` | Stripe Dashboard → Webhooks → Signing secret |
| `SLACK_BOT_TOKEN` | All Slack-posting functions | Slack App bot token (xoxb-...) |
| `SLACK_FINANCIAL_CHANNEL` | Variance alert, payment alert, invoice escalation | Slack channel ID (not name) |
| `SLACK_CREW1_CHANNEL` | `stage6-job-scheduled` | Nick's crew channel ID |
| `SLACK_CREW2_CHANNEL` | `stage6-job-scheduled` | Alex's crew channel ID |
| `GOOGLE_CALENDAR_ID` | `stage6-job-scheduled` | Job scheduling calendar ID |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `stage6-job-scheduled` | Google service account JSON |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | Built-in Supabase secret |

---

### GHL API Scopes Required

Private Integration key → Sub-Account level only.

`contacts.readonly` · `contacts.write` · `opportunities.readonly` · `opportunities.write` · `calendars.readonly` · `calendars.events.write` · `tasks.readonly` · `tasks.write` · `conversations/messages.write` · `invoices.readonly` · `invoices.write`

---

### Airtable Field IDs — Jobs Table (tbl6WcLuLL0uUcpI1)

Key fields referenced by Layer 1 functions:

| Field | ID |
|---|---|
| Job ID (formula) | `fldNrP1Z8Ngcsyarz` |
| Job Name | `fldbKNw609rqD97Gi` |
| Job Address | `fldSmr1YCORDoagb6` |
| Status | `fldoASoygIp8FpYsd` |
| Start Date | `fldOnf1hrnhJNFuRL` |
| Job Start Time | `fld5ROFJNTb36WixD` |
| Crew | `fldkP651iKPZMQ9pe` |
| Estimator | `fldyyF2DeUFX15sXx` |
| Job Type | `fldc1zsXLZTY9fBQm` |
| Engagement Type | `fldheJRxYQ4CsBNSg` |
| Final Estimated Price | `fldO4T2ChPZgL2kCZ` |
| Actual Labor Hours | `fldDeKExrSrn6X3dQ` |
| Estimated Labor Hours | `fld6Wxf2aFXLi8FEg` |
| Labor Hour Variance | `fldbPKLQY0eCj4onI` |
| Actual Revenue | `fldeJ9XvNLieNWbw3` |
| Ready for Invoice | `flds670XLkxXjLTcB` |
| Invoice Sent Date | `fld7gTBKmYPADRuee` |
| GHL Opportunity ID | `fldc2Od8JX3Se1gJN` |
| Slack Message Sent | `fldP7q2DrTh7m9p69` |
| Google Calendar Event ID | `fldry3k8ZNGGbm1aJ` |
| Gusto Project ID | `fldzc7nxwVhtiKiCb` |
| Divvy Job Tag | `fldUIWrncF0auNeYc` |

### Airtable Field IDs — Clients Table (tblSJkwDdupKzsst7)

| Field | ID |
|---|---|
| Client Name | `fldyIBidorXegZFHf` |
| Client Type | `fldJoDlrTMUu99YQw` |
| Email | `fldMVOoOV9TRdUAyC` |
| Phone | `fldzROwSsF7IoYYqN` |
| Company Name | `fldxc5LB2eKwEuSTX` |
| GHL Contact ID | `fldC4zAieX10BVacc` |
| GHL Company ID | `fldd3U0I423OVOJER` |
| Invoice Email Final | `fld7SI5x3Zzv0eWXj` |

---

### Open Items — Do Not Build Past These Blockers Without Resolution

| # | Item | Blocks |
|---|---|---|
| 1 | Invoicing tool decision (GHL native / DocuMint+Stripe / Invoice Ninja) | Build #11 stage10-invoice-sent |
| 2 | pg_cron enabled in Supabase (Database → Extensions) | Build #12 stage10-payment-reminder |
| 3 | Google Calendar service account JSON key | Build #5 stage6-job-scheduled |
| 4 | Slack app created, bot token set | Builds #5, #7, #9, #10, #13 |
| 5 | Gusto API webhook capability confirmed | Layer 3 only |
| 6 | Divvy API webhook + tag creation capability confirmed | Layer 3 only |
| 7 | Deposit policy defined | Deposit logic in stage5-schedule-confirmed |
