# Schema Audit Report

**Audited:** 2026-04-29 (UTC) against live Airtable base `apptzp0IclCaAtOk2`
**Method:** `node audit_schema.js` → `schema_audit.json` → analysis from Hyperagent thread

---

## TL;DR

- ✅ **Jobs actuals formula chain is fully built** — all 21 formulas in place, all linked records and rollups present. The Jobs table is essentially ready for Gusto/Divvy actuals integration.
- ⚠️ **5 Jobs estimate inputs are missing default values** ($26 Labor Rate, $23 Overhead Rate, $300 Disposal Charge, 25% Target Margin, 3% Credit Card Fee). Critical UX fix.
- ⚠️ **3 Jobs formula fields have whitespace naming issues** — cosmetic, but pollutes the UI.
- ⚠️ **Clients is missing 4 fields:** Invoice Email Final formula + Total Jobs count + Total Revenue rollup + Total Profit rollup.
- ⚠️ **Clients has a duplicate Jobs link** — both `Jobs` and `Jobs 2`. One should be deleted.
- ⚠️ **Several "primary ID" fields are stored as `singleLineText` instead of formulas** (Change Order ID, Expense ID). Spec calls for formula-based IDs (`"CO-" & autonumber`, `"EXP-" & autonumber`).
- ⚠️ **Invoice Line Items is missing Scope Library Reference + Line Item ID autonumber.**
- ⚠️ **Scope Library is missing the back-link to Jobs.**
- ⚠️ **Pricing Variables is missing the Last Updated date field.**
- 🔴 **Jobs (old) table has 50+ historical records.** Cannot be deleted until migrated. Many records appear to be real customer jobs (Maddie's Playground, DoTerra, Aspen Lane Homes, etc.).
- 🔴 **Estimates table is NOT in the spec** but has 30 fields and 3+ records with `Draft` status. Likely the Fillout intake → Estimate workflow that promotes to Jobs. Needs Matt's confirmation on intent.

---

## Tables Inventory

| # | Table | Live Fields | Spec Fields | Records | Status |
|---|---|---|---|---|---|
| 1 | Jobs | 82 | ~80 | 0 | Mostly built; needs defaults + naming cleanup |
| 2 | Estimates | 30 | — | 3+ | NOT IN SPEC — needs scoping decision |
| 3 | Clients | 19 | 22 | 0 | Missing rollups + formula; has duplicate link |
| 4 | Pricing Variables | 6 | 7 | 5 | Missing Last Updated date |
| 5 | Change Orders | 9 | 11 | 0 | ID is text not formula; missing Created Date |
| 6 | Expenses | 10 | 10 | ? | ID is text not formula; otherwise complete |
| 7 | Invoice Line Items | 9 | 11 | ? | Missing Scope Library Reference + Line Item ID |
| 8 | Scope Library | 7 | 8 | 19 | Missing back-link to Jobs |
| 9 | Jobs (old) | 91 | — | 50+ | LEGACY — migration required before deletion |

---

## Jobs Table — Detailed Analysis

### ✅ Actuals chain is fully built

All inputs, formulas, links, and integration fields needed for Gusto/Divvy actuals integration are present:

**Inputs (all present):**
- Actual Labor Hours (number)
- Labor Rate (currency, missing $26 default)
- Overhead Rate (currency, missing $23 default)
- Actual Materials (currency)
- Actual Disposal Cost (currency)
- Actual Revenue (currency)

**Formula chain (all present):**
- Actual Labor Cost = `{Actual Labor Hours} * {Labor Rate}`
- Actual Overhead = `{Actual Labor Hours} * {Overhead Rate}`
- Actual Total Cost = `{Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Disposal Cost}`
- Actual Profit = `{Actual Revenue} - {Actual Total Cost}`
- Actual Profit Margin = `IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK())`

**Linked records & rollups (all present):**
- Expenses (linked → Expenses table)
- Expense Total (rollup: SUM of Expenses.Amount)
- Change Orders (linked → Change Orders)
- Change Order Total (rollup: SUM of Change Orders.Approved Value)
- Invoice Line Items (linked → Invoice Line Items)
- Client (linked → Clients)
- Client Type Lookup, Invoice Email Lookup (lookups from Client)

**Integration fields (all present):**
- Gusto Project ID (singleLineText)
- Divvy Job Tag (singleLineText)
- GHL Opportunity ID, GHL Invoice ID, Stripe Payment ID, Stripe Payment Link, Slack Channel ID, Slack Thread ID, Google Calendar Event ID, Calendar Sync Status, Slack Message Sent

### ⚠️ Issues to fix on Jobs

**Issue 1: Default values missing on 5 estimate inputs.**

| Field | Currently | Should Be |
|---|---|---|
| Labor Rate | NOT SET | $26 |
| Overhead Rate | NOT SET | $23 |
| Disposal Charge Revenue | NOT SET | $300 |
| Target Margin Percent | NOT SET | 25% |
| Credit Card Fee Percent | NOT SET | 3% |

Without these, every new Job needs them entered manually before estimates compute correctly. Manual UI fix in field settings.

**Issue 2: Three formula fields have whitespace in their names.**

| Current Name | Should Be |
|---|---|
| `Actual Profit  ` (trailing 2 spaces) | `Actual Profit` |
| ` Actual Profit Margin` (leading space) | `Actual Profit Margin` |
| `Labor Cost ` (trailing space) | `Labor Cost Variance` (formula confirms it's variance: `Actual Labor Cost - Estimated Labor Cost`) |

Doesn't break formulas (those use field IDs internally), but pollutes views, automation rules, and exports. Manual UI fix — rename each field.

---

## Clients Table — Detailed Analysis

### ⚠️ Missing 4 fields per spec

| Field | Type | Notes |
|---|---|---|
| Invoice Email Final | Formula | `IF({Billing Email}, {Billing Email}, {Email})` |
| Total Jobs | Count | Count of linked Jobs |
| Total Revenue | Rollup | SUM of Jobs.Actual Revenue |
| Total Profit | Rollup | SUM of Jobs.Actual Profit |

### ⚠️ Duplicate Jobs link

Clients table has two linked-record fields pointing to Jobs:
- `Jobs` (likely original)
- `Jobs 2` (likely auto-created when Jobs.Client back-link was added)

Need to consolidate — confirm which is the live one (probably "Jobs"), then delete `Jobs 2`. This is an Airtable UI decision; can't be done via API.

---

## Change Orders Table — Detailed Analysis

### ⚠️ Issues

- **Change Order ID is `singleLineText`** — should be a formula: `"CO-" & {CO Number}` where CO Number is a separate autonumber field. Currently nothing populates it automatically.
- **Created Date is missing** — should be a `createdTime` field for audit trail.

Both require manual UI: add `CO Number` autonumber, change `Change Order ID` to formula, add `Created Date` as createdTime.

---

## Expenses Table — Detailed Analysis

### ⚠️ Issues

- **Expense ID is `singleLineText`** — should be a formula: `"EXP-" & {EXP Number}` where EXP Number is autonumber.
- ✅ "Bill Transaction ID" field is correct — Divvy was acquired by Bill.com, so this naming reflects the current product.

---

## Invoice Line Items Table — Detailed Analysis

### ⚠️ Missing 2 fields

| Field | Type | Notes |
|---|---|---|
| Scope Library Reference | Linked Record → Scope Library | Required for auto-generating descriptions from Scope Library defaults |
| Line Item ID | Autonumber | Used for stable referencing |

Both manual UI.

---

## Scope Library Table — Detailed Analysis

### ⚠️ Missing 1 field

- `Jobs` back-link (Linked Record → Jobs, multi-select)

Note: Airtable might auto-create this if a Jobs.Job Scope-style linked record is added — but spec calls for it explicitly. Check during Manual UI setup.

---

## Pricing Variables Table — Detailed Analysis

### ⚠️ Missing 1 field

- `Last Updated` (Date) — audit trail for rate changes

Easy to add via API.

---

## Estimates Table — Out-of-Spec Investigation Needed

**30 fields, 3+ records (status: Draft).**

This table is not in `schema_overview.md` or the project brief. Field structure suggests it's the Fillout intake form's landing point — captures preliminary estimate data before a Job record is created. Sample fields:

- `Estimate ID (Autonumber)` + `Estimate ID` formula
- `Estimate Status` (single-select, observed value: Draft)
- `Total Estimated Revenue` (currency)
- `Direct Labor Estimate`, `Overhead Allocation Estimate`, `Job Specific Costs`, `Dump Fee Estimate`, etc. — pre-Jobs estimating fields
- Client info (Name, Email, Phone, Job Address, Job Details)
- `Labor Estimation Method` (single-select)

**Open question for Matt:**
- Is Estimates the intentional intake stage from Fillout? (Likely yes given field shapes.)
- Should Draft Estimates be promoted to Jobs upon approval? Is that flow built or planned?
- Or should we migrate everything to Jobs and decommission Estimates?

This decision affects Phase 5 (Fillout intake) of the brief.

---

## Jobs (old) Table — Migration Required

**91 fields, 50+ records.** Real historical job data — confirmed names like "Maddie's Playground", "DoTerra Carpet and Cieling Grid", "Bob Harker", "Aspen Lane Homes", "Solid Rock Builders", "Heritage Homes", etc.

Field shape is largely the same as new Jobs but with some renames:
- `Sequence` (autoNumber) instead of `Job Number`
- `Job Number` is a formula instead of `Job ID`
- `Job Status` instead of `Status`
- `Bill / Divvy Job Tag` instead of `Divvy Job Tag`
- `Last Modified Time` field (legacy)
- 5 sets of "Line Item N" / "Line Item N Description" / "Line Item N Price" — superseded by Invoice Line Items table
- `Profit Percentage (from Fillout)` — connection to Fillout intake

**Migration plan needed.** Options:
1. **Direct migration** — script copies records from Jobs (old) → Jobs, mapping renamed fields and abandoning superseded ones.
2. **Selective migration** — migrate only post-2025 records that are still in active use.
3. **Archive in place** — keep Jobs (old) read-only as historical reference, only use Jobs going forward for new jobs.

This is **not blocking** Stage 2 (actuals integration) on Jobs, but affects historical reporting and quarterly rate reviews.

---

## Recommended Next Actions

### Critical Path (unblocks Stage 2 — Actuals Integration)

**Matt — Airtable UI work (~30 min):**
1. Set 5 default values on Jobs estimate inputs (Labor Rate $26, Overhead Rate $23, Disposal Charge Revenue $300, Target Margin Percent 25%, Credit Card Fee Percent 3%)
2. Rename 3 Jobs formula fields with whitespace issues
3. Add 4 missing Clients fields: Invoice Email Final formula + Total Jobs count + Total Revenue rollup + Total Profit rollup
4. Resolve Clients `Jobs` vs `Jobs 2` duplicate (delete the unused one)
5. Confirm intent of Estimates table (intake stage? promote to Jobs?) — answer in this thread

**Hyperagent — API work (parallel):**
1. Begin Gusto API research (Stage 3)
2. Begin Divvy/Bill API research (Stage 4)

### Important But Not Blocking

**Matt — Airtable UI work:**
6. Replace Change Order ID with formula `"CO-" & {CO Number}` (add autonumber field first)
7. Add Change Orders.Created Date as createdTime
8. Replace Expense ID with formula `"EXP-" & {EXP Number}` (add autonumber field first)
9. Add Invoice Line Items.Scope Library Reference (linked → Scope Library) and Line Item ID (autonumber)
10. Add Scope Library.Jobs back-link (linked → Jobs)

**Hyperagent — API work:**
11. Add Pricing Variables.Last Updated (date) field

### Defer Until Later

- Jobs (old) migration plan (Stage 6 cleanup)
- Decommission or formalize Estimates table (depends on #5 above)

---

## Files Referenced

- `audit_schema.js` — script that produced this audit
- `schema_audit.json` — full live schema dump (78 KB)
- `schema_overview.md` — canonical spec the audit compared against
- `LostBoys_PricingEngine_ProjectBrief.md` — original project brief
