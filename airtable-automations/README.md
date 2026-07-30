# Airtable Scripting Automations

These scripts run **inside the Airtable UI**, not in this repo. They are stored here for
version control and review only — editing a file here does not change the live automation.

Recovered from the live base on 2026-07-30 via the Airtable API. Prior to that they existed
nowhere in git despite being referenced in `CLAUDE.md`.

**Base:** `apptzp0IclCaAtOk2` (Lost Boys Demolition)

| File | Automation name | ID | Trigger | Status |
|---|---|---|---|---|
| `create-line-items.js` | Create Invoice Line Items | `wflrlJo8fpwOdCCFv` | Record created → Jobs | deployed |
| `update-line-items.js` | Update Invoice Line Items on Job Edit | `wflqUwoKPt7wUF8ms` | Record updated → Jobs (12 watch fields) | deployed |

Both are wrapped in a conditional group gated on `Line Item 1` (`fldmDhTI8cv8DDhVd`) being
non-empty, and both take a single input variable `recordId` mapped to the trigger record ID.

## What they do

The Jobs table carries a denormalized 3-slot line-item pattern (`Line Item 1/2/3` ×
name/description/quantity/unit price = 12 fields), populated by the Fillout estimate form.
These scripts project those flat slots into child records in the **Invoice Line Items**
table (`tblTwK8K0HkyluBec`), which is what `airtable-job-completed` reads when building the
Stripe invoice.

- **Create** is idempotent: it exits early if the job already has linked line items.
- **Update** upserts by `Sort Order`, and **soft-deletes** cleared slots by setting
  `Include on Invoice = false` rather than deleting the record, preserving the audit trail.
  The edge function filters on that checkbox.
- A slot counts as valid if it has a **name**, even at $0 — zero-priced items still render
  their name and description on the invoice.

## To edit

Airtable Automations → open the automation → Run script step. Paste the updated script,
then **Test** and **Republish**. Mirror the change back into this file in the same commit.

## Note on the planned rebuild

This whole mechanism is slated for retirement. The 3-slot flat pattern is one of four
competing representations of line items in the base (flat slots, the `Invoice Line Items`
linked table, a redundant `Invoice Line Items 2` link, and a direct `Scope Library` link),
and it caps a job at three line items. The Postgres rebuild replaces it with a normalized
line-items table. Keep these scripts working until that lands.
