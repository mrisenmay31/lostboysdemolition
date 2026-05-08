# Lost Boys Demolition — Ops System

**Client:** Lost Boys Demolition and Junk Removal LLC (Wasatch Front, Utah)  
**Managed by:** Matt Risenmay, contracted CFO at CTA Integrity

---

## Standing Instructions

### Build Planning Rule

Before writing any code for a **new build** (new edge function, new feature, significant refactor), you MUST:

1. Spawn a Plan subagent with `model: "opus"` to produce a plan covering:
   - Step-by-step implementation plan
   - Architecture decisions
   - Risk flags
   - Open questions that need answers before coding starts
2. Present the plan to Matt and **wait for explicit approval** before writing any code.

**Small changes** (targeted bug fixes, field ID swaps, minor edits to existing functions) do not require a planning subagent. If unsure whether something qualifies as a build, ask before proceeding.

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
├── airtable-automations/       # Airtable Scripting automation scripts (deployed manually in Airtable UI)
│   ├── create-line-items.js    # Fires on job creation → creates Invoice Line Item child records
│   ├── update-line-items.js    # Fires on job LI field edits → upserts/soft-deletes child records
│   └── SETUP_INSTRUCTIONS.md  # Manual setup guide for Airtable Automations UI
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
Stage 8: Job Completed → Stripe invoice draft + Dane notification. Triggered by Airtable Automation when Job Status = "Completed". Fetches job + client + line items from Airtable, resolves or creates Stripe customer, creates draft Stripe invoice (auto_advance: false), writes invoice ID + review URL back to Airtable, advances GHL opportunity to Stage 9 (Invoice Review), creates GHL task for Dane, sends Slack DM to Dane. Slack is non-fatal if token missing. Supabase project: eiqqqwajmcpcwhvxxnhx. **Current deployed version: 10 (deployed 2026-05-08). Slack notification paused via `SLACK_NOTIFICATIONS_ENABLED = false` constant — set to `true` to re-enable.**

**Line items approach (v7):** Fetches Invoice Line Items linked via `fldD6xumylrVQEVMo` on the Jobs table. Each named item appears at its actual amount (including $0 — name and description still render on the invoice). If the sum of line item amounts is less than Total Bid, a "Project Total" line is appended for the difference so the invoice always totals to the Total Bid field value. Fallback: if no line items linked, single "Demolition Services" line at Total Bid. If sum exceeds Total Bid, items are used as-is (warning logged).

**Invoice Line Items are populated by two Airtable Scripting automations** (live in the base as of 2026-05-08):
- "Create Invoice Line Items from Job" — fires on job creation, creates child records from flat LI fields
- "Update Invoice Line Items on Job Edit" — fires on flat LI field edits, upserts/soft-deletes child records
- Scripts: `airtable-automations/create-line-items.js` and `airtable-automations/update-line-items.js`
- Setup instructions: `airtable-automations/SETUP_INSTRUCTIONS.md`

**Stripe rendering (v6+):** For each line item, first `POST /products` with `name` and `description` to create a Stripe Product. Then `POST /invoiceitems` referencing `price_data[product]` (the product ID). This causes Stripe to render the product name in bold and description in regular text below it on the invoice PDF and hosted page.

**LINE_ITEM_FIELDS constants:**
- `name`: `fldva3wLkKqJD7t7r`
- `description`: `fldWGM7wIVac7rxEy`
- `amount`: `fldR0cBZlSC25CXhq`
- `quantity`: `fldLP3TR2pveYKFOc`
- `sortOrder`: `fld5kCTH3LByLIFT8`
- `includeOnInvoice`: `fldBo2XaZZHFIzJT5`

**IMPORTANT — do NOT use `price_data[product_data]` on `/invoiceitems`:** Stripe's invoiceitems endpoint does not support inline product creation via `product_data`. Always create the product first via `POST /products`, then pass the product ID via `price_data[product]`.

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

1. ~~**Invoicing architecture**~~ — **RESOLVED.** Direct Stripe integration. `airtable-job-completed` v7 live and verified end-to-end 2026-05-08. Dynamic line items + "Project Total" adjustment logic. Airtable automations live. `stripe-webhook` (Stages 9–11) is the next build.
2. ~~**Fillout per-line-item dollar amount**~~ — **RESOLVED 2026-05-08.** Fillout form has Unit Price 1/2/3 fields that write to Airtable flat LI fields. Airtable automations pick these up and create Invoice Line Items with actual amounts. v7 edge function renders per-line prices when present; appends "Project Total" for any gap vs. Total Bid.
3. **`stripe-webhook` function** — NOT YET BUILT. Handles Stages 9–11. Stripe sandbox webhook endpoint configured: listens for `invoice.sent` (Stage 9→10) and `invoice.paid` (Stage 10→11). STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Supabase are now sandbox/test keys as of 2026-05-08.
4. **Divvy Zapier API** — Can Divvy create job tags programmatically? Blocks Phase 4 (actuals integration).
5. **Cancellation/deposit refund policy** — Deferred. Blocks Stage 5 deposit automation.
6. **Deposit required policy** — Required for all Residential; optional for established contractors. Deferred.
7. **Local `.env` stale** — `AIRTABLE_WEBHOOK_SECRET` in `.env` does not match the value in Supabase. Use Supabase secret as authoritative.

---

## Phase Roadmap

1. Schema completion (in progress)
2. Invoice automation — Stage 8 live at v7 (dynamic line items + Project Total); stripe-webhook (Stages 9–11) is next
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
