# Lost Boys Demolition — Ops System

**Client:** Lost Boys Demolition and Junk Removal LLC (Wasatch Front, Utah)  
**Managed by:** Matt Risenmay, contracted CFO at CTA Integrity

---

## What This System Does

Closes the loop between estimates, actuals, and invoices. Every Closed Won job feeds back into pricing accuracy.

**Two core loops:**
- Loop 1 — Profitability Intelligence: Actuals → variance → Scope Library feedback → better estimates
- Loop 2 — Revenue Cycle Automation: Lead → invoice → payment, automated with human checkpoints only

---

## Tech Stack

| System | Role |
|---|---|
| Airtable | Source of truth — 7 tables |
| GHL (Go High Level) | CRM + pipeline, mirrors Airtable status |
| Supabase Edge Functions | Sync layer between Airtable and GHL |
| Zapier | Automation layer (Fillout triggers, etc.) |
| Fillout | Estimate forms + foreman checklists |
| Gusto | Labor hours actuals |
| Divvy | Job expense actuals |
| Stripe | Payments |
| Slack | Alerts and notifications |
| Google Calendar | Job scheduling |

---

## Repository Structure

```
/
├── supabase/functions/         # Deno/TypeScript edge functions
│   ├── airtable-client-sync/   # Airtable Clients → GHL Contacts
│   ├── airtable-job-created/   # Airtable Jobs → GHL Opportunities
│   ├── airtable-job-scheduled/ # Advances GHL opp to "Job Scheduled" stage
│   ├── airtable-job-completed/ # Stage 8: Job Completed → Stripe invoice draft + Dane notification
│   └── ghl-contact-sync/       # GHL Contacts → Airtable Clients (reverse)
├── setup_airtable.js           # Admin script: initial Airtable schema setup
├── setup_airtable_v2.js        # Admin script: v2 schema setup
├── audit_schema.js             # Schema audit utility
├── schema_overview.md          # Airtable schema field reference
├── INTEGRATION_DESIGN.md       # Architecture and integration patterns
├── LostBoys_PricingEngine_ProjectBrief.md  # Project requirements brief
└── SCHEMA_AUDIT_REPORT.md      # Audit findings
```

---

## Edge Functions

All functions are self-contained Deno/TypeScript. No shared utility library — helpers are inline per function.

### `airtable-client-sync`
Airtable Clients → GHL Contacts. Triggered by Airtable webhook on client create/update. Searches GHL by email or GHL ID, creates or updates contact, writes back GHL Contact ID to Airtable. Logs to `sync_log` and `client_sync_state`.

### `airtable-job-created`
Airtable Jobs → GHL Opportunities. Triggered by Airtable webhook on job creation. Resolves GHL pipeline/stage/user IDs at cold start. Creates or updates GHL opportunity, sets stage based on "Ready to Schedule" flag, assigns to estimator, writes back GHL Opp ID to Airtable.

### `airtable-job-scheduled`
Advances GHL opportunity to "Job Scheduled" stage. Triggered by Airtable webhook when job is ready to schedule. Updates Airtable job status to "Scheduled". Placeholders in place for Google Calendar (pending service account) and Slack crew notifications (pending bot token).

### `ghl-contact-sync`
GHL Contacts → Airtable Clients (reverse direction). Triggered by GHL `contact_updated` webhook. Searches Airtable by GHL Contact ID first, then email. Creates or updates Airtable client record, writes back GHL Contact ID and Company ID.

### `airtable-job-completed`
Stage 8: Job Completed → Stripe invoice draft + Dane notification. Triggered by Airtable Automation when Job Status = "Completed". Fetches job + client + line items from Airtable, resolves or creates Stripe customer, creates draft Stripe invoice (auto_advance: false), writes invoice ID + review URL back to Airtable, advances GHL opportunity to Stage 9 (Invoice Review), creates GHL task for Dane, sends Slack DM to Dane. Slack is non-fatal if token missing. Supabase project: eiqqqwajmcpcwhvxxnhx. Deployed 2026-05-07, version 2.

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `sync_log` | Full audit trail of all sync operations |
| `client_sync_state` | Current state: email, Airtable record ID, GHL contact/company IDs, last sync direction/time |

---

## Environment Variables

```
AIRTABLE_API_KEY
AIRTABLE_BASE_ID
GHL_API_KEY
GHL_LOCATION_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AIRTABLE_WEBHOOK_SECRET
GHL_WEBHOOK_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
SLACK_BOT_TOKEN
```

See `.env.example` for template.

---

## Architecture Decisions

- **Fillout owns estimate calculations** (live preview). Airtable stores estimate outputs as plain fields — no formulas. Airtable formula fields own actuals and variance calculations.
- **Airtable is source of truth.** GHL mirrors status only.
- **Airtable field IDs are hardcoded** in each edge function for schema stability. If fields change, update the constant at the top of the relevant function.
- **No GHL record created at Stages 1–2.** Airtable record does not exist until Stage 3 (Estimate in Progress).
- **Webhook pattern:** All functions validate `x-webhook-secret` header, return structured JSON with 200 (success) or 500 (error).
- **Cold-start ID resolution:** GHL pipeline, stage, and user IDs are resolved once at function initialization, not per-request.

---

## 13-Stage GHL Pipeline

| # | Stage | Exit Owner |
|---|---|---|
| 1 | New Lead | Estimator |
| 2 | Intake / Qualification | Estimator |
| 3 | Estimate in Progress | Estimator |
| 4 | Quote Sent | Client / Dane |
| 5 | Quote Accepted / Pending Schedule | Dane / Jackson |
| 6 | Job Scheduled | Dane |
| 7 | Job in Progress | Foreman |
| 8 | Job Completed | Automated |
| 9 | Invoice Review | Dane |
| 10 | Invoice Sent | Client / Dane |
| 11 | Paid / Closed Won | Automated |
| 12 | Closed Lost / Declined | Dane |
| 13 | Closed Lost / Cancelled | Dane |

Stages 12 and 13 are distinct — financially different (declined vs. cancelled after acceptance). Rescheduled jobs return to Stage 5, not a separate hold stage.

---

## Key Rules

- **No "10 and 10" markup logic**
- **Field crew leaders = foremen** (not "crew leaders")
- **Dump-related costs = "Dump Fee"** (not "Disposal Charge")
- **Path A** = estimate-first workflow; **Path B** = trusted contractor, invoice at completion
- **Job ID format:** `JOB-XXXX` — universal key across all systems

---

## Pricing Benchmarks

- Labor rate: $26/hr
- Overhead: $23/hr
- Target margin: 25% floor
- CC fee: 3%
- Default dump fee: $300/load

---

## Key Personnel

| Person | Role |
|---|---|
| Matt Risenmay | CFO (CTA Integrity) — architecture + financial oversight |
| Dane | Estimator/Office — owns GHL, invoice review, scheduling |
| Jackson | Estimator |
| Nick | Foreman, Crew 1 |
| Alex | Foreman, Crew 2 |

---

## Open Items (Blocking)

1. ~~**Invoicing architecture**~~ — **RESOLVED 2026-05-07.** Direct Stripe integration chosen. `airtable-job-completed` (Stage 8) is live at version 2. `stripe-webhook` (Stages 9–11) is the next build.
2. **Divvy Zapier API** — Can Divvy create job tags programmatically? Blocks Phase 4 (actuals integration).
3. **Cancellation/deposit refund policy** — Deferred. Blocks Stage 5 deposit automation.
4. **Deposit required policy** — Required for all Residential; optional for established contractors. Deferred.

---

## Phase Roadmap

1. Schema completion (in progress)
2. Invoice automation (blocked — Open Item #1)
3. Scope Library auto-generation
4. Actuals integration (Gusto + Divvy → Airtable)
5. Fillout form rebuild
6. Reporting and dashboards
7. Enhancements

---

## Pipeline Reference Base — Standing Instructions

The Lost Boys Pipeline Reference base in Airtable is the system of
record for all build metadata — field IDs, credentials, people IDs,
and deployment status.

Base ID: appA7uj7FhnPp9Bvg

Tables:
- Field Registry — all Airtable field IDs and table IDs
- Secrets & Credentials — all Supabase secrets and external tokens
- People & IDs — Slack, GHL, and system IDs for team members
- Build Log — deployment status and URLs for all edge functions

### STANDING RULE — Required After Every Deploy

At the end of every build session, before closing, you MUST:

1. Update the Build Log table:
   - Set Status to 🟢 Live for any newly deployed functions
   - Write the confirmed deploy URL to the Deploy URL field
   - Set Session Date to today's date
   - Add any relevant notes to the Notes field

2. Update the Field Registry table:
   - Add any new Airtable field IDs that were created or discovered
     during the session
   - Include the field name, table name, field ID, and purpose

3. Update the Secrets & Credentials table:
   - Add any new secrets added to Supabase during the session
   - Set Status to ✅ Live

4. Update the People & IDs table:
   - Add any new team member IDs discovered during the session

This is not optional. If the session ends without this update, the
reference base will be stale and future sessions will have incomplete
information. Always complete the reference base update as the final
step of every build session, after deployment is confirmed.
