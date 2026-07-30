# Airtable Automation Setup Instructions

Two automations must be configured manually in the Airtable UI.
Scripts are in this directory: `create-line-items.js` and `update-line-items.js`.

Base: Lost Boys Demolition (apptzp0IclCaAtOk2)

---

## Automation 1: "Create Invoice Line Items from Job"

Fires when a new job is created (e.g., via Fillout form submission).
Creates child Invoice Line Item records for each named line item slot.

### Steps

1. Open the base in Airtable → click **Automations** (top right)
2. Click **+ New automation**
3. Name it: `Create Invoice Line Items from Job`

**Set the Trigger:**
4. Choose trigger: **When a record is created**
5. Table: **Jobs**

**Add a Condition:**
6. Click **+ Add condition**
7. Field: **Line Item 1** (`fldmDhTI8cv8DDhVd`)
8. Condition: **is not empty**

**Add the Action:**
9. Click **+ Add action**
10. Choose: **Run a script**
11. Click **+ Add input variable**
    - Variable name: `recordId`
    - Value: click **+** → select **Airtable record ID** from the trigger
12. Paste the full contents of `create-line-items.js` into the script editor
13. Click **Save**

**Test:**
14. Click **Run test** — use an existing Job record that has Line Item 1 populated
15. Verify the script log shows `✅ N line item(s) created`
16. Toggle automation **On**

---

## Automation 2: "Update Invoice Line Items on Job Edit"

Fires when flat line item fields on a Job record are edited.
Updates, creates, or soft-deletes child Invoice Line Item records to match.

### Steps

1. Click **+ New automation**
2. Name it: `Update Invoice Line Items on Job Edit`

**Set the Trigger:**
3. Choose trigger: **When a record is updated**
4. Table: **Jobs**
5. Under **Fields to watch**, add all 12 of these fields:
   - Line Item 1 (`fldmDhTI8cv8DDhVd`)
   - Description 1 (`fld9Nh9HaRRYj9Hqx`)
   - Quantity 1 (`fld6p8qo43OllIWj8`)
   - Unit Price 1 (`fldsbx7IGc3ACRvwx`)
   - Line Item 2 (`fld75RhQn42uA9aaR`)
   - Description 2 (`fldBAG4h6qlMsfFIJ`)
   - Quantity 2 (`fldZSXcTPCYojw7DB`)
   - Unit Price 2 (`fldOlkrEmc5Pe94Xv`)
   - Line Item 3 (`fldbymXYKV19BEg3b`)
   - Description 3 (`fldQDaLjePgG6kPND`)
   - Quantity 3 (`fldCVv7f1msG2F9KX`)
   - Unit Price 3 (`fldaJi5MNxZSB9NAx`)

   Note: Do NOT add the Scope Reference link fields to the watch list —
   those are set by Fillout on creation, not on edits.

**Add a Condition:**
6. Click **+ Add condition**
7. Field: **Line Item 1** (`fldmDhTI8cv8DDhVd`)
8. Condition: **is not empty**

**Add the Action:**
9. Click **+ Add action**
10. Choose: **Run a script**
11. Click **+ Add input variable**
    - Variable name: `recordId`
    - Value: click **+** → select **Airtable record ID** from the trigger
12. Paste the full contents of `update-line-items.js` into the script editor
13. Click **Save**

**Test:**
14. Click **Run test** — use a Job record that already has Invoice Line Items linked
15. Verify the script log shows `✅ Sync complete`
16. Toggle automation **On**

---

## Behavior Reference

| Scenario | Automation 1 | Automation 2 |
|---|---|---|
| New job with LI name | Creates child records | — |
| New job, no LI names | Skips | — |
| Job already has child records | Skips (idempotent) | — |
| Edit LI name/price/desc/qty | — | Updates existing child record |
| Clear a LI name (scope removed) | — | Sets Include on Invoice = false (soft delete) |
| Add a new LI to existing job | — | Creates new child record |
| All LIs have $0 price | Creates records with $0 | Updates records with $0 |

Zero-price line items are valid — they appear on the invoice with name and
description. If the sum of line item amounts is less than the Total Bid, the
edge function appends a "Project Total" line for the difference so the invoice
always totals to the Total Bid field value (v7+ behavior).
