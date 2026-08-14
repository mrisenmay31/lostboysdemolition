## Session Goal
Update the existing `airtable-job-created` Supabase Edge Function to populate 
all GHL opportunity custom fields at job creation time. When a new Airtable 
Jobs record is created (via Fillout → Zapier), this function should create the 
GHL opportunity with all job info and estimate fields pre-populated, scheduling 
fields intentionally left blank, and the Airtable Job ID + Record ID written 
to the integration fields.

---

## Read These First — Before Writing Any Code
1. `schema_overview.md` — hard rules, field IDs, env secrets, edge function template
2. `LostBoys_PricingEngine_ProjectBrief.md` — project context and field definitions
3. `ghl_field_mapping.md` — GHL field IDs for every custom field (committed to repo root)
4. Current deployed source of `airtable-job-created` via Supabase MCP

---

## GHL API Notes (Critical — Read Before Writing Any GHL Call)
These quirks are specific to GHL's API and will cause silent failures if ignored:
- POST body key is `name`, not `label`
- Monetary field type enum is `MONETORY` (GHL's typo — not ours)
- Options arrays must be plain strings, not objects
- Auth: Authorization: Bearer {GHL_API_KEY}
- Version header: Version: 2021-07-28
- Base URL: https://services.leadconnectorhq.com

---

## What the Updated Function Should Do

### 1. Receive the Airtable webhook payload
Triggered by Airtable Automation when a new Jobs record is created.
Extract these fields from the payload:

Job Info:
- Job Name (fldbKNw609rqD97Gi)
- Job Address (fldSmr1YCORDoagb6)
- Job Type (fldc1zsXLZTY9fBQm)
- Engagement Type (fldheJRxYQ4CsBNSg)
- Estimator (fldyyF2DeUFX15sXx)
- Job ID / Job Number formula (fldNrP1Z8Ngcsyarz) — e.g. JOB-1042
- Airtable Record ID (the record's own ID from the webhook)

Estimate fields:
- Final Estimated Price (fldO4T2ChPZgL2kCZ) → write to GHL native Monetary Value
- Estimated Labor Hours (fld6Wxf2aFXLi8FEg)
- Estimated Labor Cost — derive from payload if present
- Estimated Materials — from payload if present
- Estimated Dump Cost (use as Estimated Dump Fees)
- Estimated Overhead — from payload if present
- Estimated Profit — from payload if present
- Estimated Profit Margin — from payload if present
- Job Scope (fldc1zsXLZTY9fBQm) — multi-select values
- Scope Notes — from payload if present

Client linkage:
- GHL Contact ID — look up from the Clients table via the linked Client record 
  if available in the payload. If not available, create the opportunity without 
  a contact link and log a warning.

### 2. Look up or create the GHL Contact
If the payload includes a GHL Contact ID (from the linked Clients record), use it.
If not, log a warning and proceed without contact linkage — do not abort.

### 3. Create the GHL Opportunity
POST /opportunities/
Body:
- name: Job Name
- pipelineId: [read from GHL_PIPELINE_ID env var]
- pipelineStageId: [read from GHL_STAGE3_ID env var — Stage 3: Estimate Submitted]
- monetaryValue: Final Estimated Price
- contactId: [if available]
- locationId: GHL_LOCATION_ID
- customFields: array of { id, field_value } for every field in ghl_field_mapping.md

Scheduling fields (Crew, Job Start Date, Job End Date, Job Start Time):
Leave these OUT of the customFields array entirely. Do not send null or empty 
string — just omit them. They get populated later in GHL when scheduling is confirmed.

Integration fields:
- Airtable Job ID → the human-readable Job ID (e.g. JOB-1042)
- Airtable Record ID → the raw Airtable record ID from the webhook payload

### 4. Write the GHL Opportunity ID back to Airtable
After the opportunity is created, PATCH the Airtable Jobs record:
- Field GHL Opportunity ID (fldc2Od8JX3Se1gJN) = the returned opportunity ID

### 5. Write to job_events
{
  job_id: [Airtable record ID],
  job_number: [e.g. JOB-1042],
  stage_from: null,
  stage_to: 3,
  function_name: 'airtable-job-created',
  trigger_source: 'airtable_automation',
  action_summary: 'GHL opportunity created with all estimate fields populated',
  status: [success or error],
  error_message: [null or message],
  payload_in: [full webhook payload]
}

### 6. Write to sync_log (no exceptions)
Always write — even on error or skip.

---

## Field Value Formatting Notes
- Monetary fields: send as number, not string (e.g. 4500, not "$4,500")
- Estimated Profit Margin: send as decimal (e.g. 0.42 for 42%)
- Job Scope: send as array of strings matching the GHL option labels exactly
- If any estimate field is missing from the payload (blank in Airtable), 
  omit it from customFields rather than sending null

---

## What NOT to Touch
- Do not modify `airtable-job-scheduled` — separate function, separate session
- Do not build ghl-opportunity-sync or airtable-job-updated — those come later
- Do not re-run any migrations
- Do not overwrite ghl-contact-sync or airtable-client-sync
- Slack and Stripe logic: not relevant to this function — ignore

---

## New Environment Variables Needed
Check if these exist in Supabase secrets. If not, flag them as blockers:
- GHL_PIPELINE_ID — the pipeline this opportunity belongs to
- GHL_STAGE3_ID — the Stage 3 pipeline stage ID (Estimate Submitted)

If either is missing, output instructions for how to find them via the GHL API 
(GET /pipelines/) and stop — do not hardcode IDs.

---

## Test Procedure
1. Find a recent test job in Airtable that has estimate fields populated
2. Manually trigger the function (or temporarily re-save the Airtable record 
   to fire the automation)
3. Verify:
   - [ ] GHL opportunity created with correct name and monetary value
   - [ ] All estimate custom fields populated correctly
   - [ ] Scheduling fields (Crew, dates) are blank — not null, not empty string, just absent
   - [ ] Airtable Job ID and Airtable Record ID fields populated in GHL
   - [ ] GHL Opportunity ID written back to Airtable field fldc2Od8JX3Se1gJN
   - [ ] job_events row inserted
   - [ ] sync_log row inserted

---

## After Changes
Commit to GitHub:
git add . && git commit -m "feat: airtable-job-created populates GHL custom fields" && git push

---

## Definition of Done
- [ ] GHL opportunity created on every new Airtable Jobs record
- [ ] All estimate + job info fields populated at creation
- [ ] Scheduling fields intentionally absent
- [ ] GHL Opportunity ID written back to Airtable
- [ ] job_events and sync_log both write on every invocation
- [ ] GHL_PIPELINE_ID and GHL_STAGE3_ID confirmed in Supabase secrets
- [ ] Changes committed and pushed