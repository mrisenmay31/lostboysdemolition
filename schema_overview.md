# Lost Boys Demolition — Airtable System Schema Overview

**Last Updated:** April 29, 2026  
**System Purpose:** Job Costing + Pricing Engine + Operations Management  
**Base:** Lost Boys Demolition (Airtable)

---

## Tech Stack

| Tool | Role |
|---|---|
| Airtable | Operational database / source of truth |
| Fillout | Job intake and pricing forms |
| Gusto | Payroll and labor time tracking |
| Divvy | Job expense tracking (field cards) |
| GoHighLevel (GHL) | CRM, proposals, and invoicing |
| Stripe | Payment processing |
| Slack | Crew communication and scheduling |
| Zapier | Automation layer connecting all systems |
| Google Calendar | Job scheduling |

**Key Principle:** Every job has a unique Job ID (format: JOB-1001) that flows through Airtable, Gusto, Divvy, GHL, Stripe, Slack, and Zapier.

---

## Tables

1. Clients
2. Jobs
3. Change Orders
4. Expenses
5. Pricing Variables
6. Invoice Line Items
7. Scope Library

---

## Table 1: Clients

**Purpose:** Master record for all contractors and homeowners.  
**Primary Field:** Client Name

| Field | Type | Notes |
|---|---|---|
| Client Name | Single Line Text | Primary field |
| Client Type | Single Select | Contractor / Homeowner |
| Company Name | Single Line Text | |
| Contact Name | Single Line Text | |
| Email | Email | |
| Phone | Phone Number | |
| Notes | Long Text | |
| Address | Single Line Text | |
| City | Single Line Text | |
| State | Single Line Text | |
| Zip | Single Line Text | |
| Billing Contact Name | Single Line Text | |
| Billing Email | Email | |
| Billing Phone | Phone Number | |
| Billing Notes | Long Text | |
| Invoice Email Final | Formula | IF({Billing Email}, {Billing Email}, {Email}) |
| GHL Contact ID | Single Line Text | |
| GHL Company ID | Single Line Text | |
| Jobs | Linked Record → Jobs | |
| Total Jobs | Count | Count of linked Jobs |
| Total Revenue | Rollup | SUM of Jobs.Actual Revenue |
| Total Profit | Rollup | SUM of Jobs.Actual Profit |

---

## Table 2: Jobs

**Purpose:** Core operational and financial record for every job.  
**Primary Field:** Job ID (Formula: "JOB-" & ({Job Number} + 1000))

### Section 1 — Job Info

| Field | Type | Notes |
|---|---|---|
| Job Number | Autonumber | Required for Job ID formula |
| Job ID | Formula | "JOB-" & ({Job Number} + 1000) — Primary field |
| Job Name | Single Line Text | |
| Client | Linked Record → Clients | |
| Client Type Lookup | Lookup | From Clients.Client Type |
| Invoice Email Lookup | Lookup | From Clients.Invoice Email Final |
| Engagement Type | Single Select | Contractor Job / Homeowner Direct / Subcontract Work |
| Job Type | Single Select | Residential / Commercial |
| Job Scope | Multi-Select | See full options below |
| Estimator | Single Select | Dane / Jackson |
| Crew | Single Select | Crew 1 / Crew 2 / Crew 3 / Crew 4 / Jackson / Other |
| Status | Single Select | Lead-Request / Scheduled / In Progress / Completed / Ready for Invoice / Invoiced / Paid / Cancelled |
| Start Date | Date | |
| End Date | Date | |
| Job Start Time | Single Line Text | |
| Scope Notes | Long Text | Drives invoice description auto-generation |
| Days at Job | Number | Used in labor estimation |
| Number of Employees | Number | Used in labor estimation |
| Total Number of Dumps | Number | Important for disposal modeling |

**Job Scope Multi-Select Options:**
- Kitchen Demo
- Bathroom Demo
- Full House Gut
- Flooring Removal
- Concrete Demo
- Drywall-Wall Demo
- Ceiling Demo
- Exterior Demo
- Fireplace Demo
- Stair-Trim Demo
- Window-Door Removal
- Cabinet Removal
- Shed-Structure Removal
- Deck-Patio Removal
- Pool-Water Feature Demo
- Carport Removal
- Junk Removal-Cleanout
- Construction Debris Hauling
- Jobsite Cleanup

### Section 2 — Estimate Inputs

| Field | Type | Default | Notes |
|---|---|---|---|
| Estimated Labor Hours | Number | — | |
| Labor Rate | Currency | $26 | Set manually in field settings |
| Overhead Rate | Currency | $23 | Set manually in field settings |
| Estimated Materials | Currency | — | |
| Disposal Charge Revenue | Currency | $300 | Set manually in field settings |
| Disposal Estimated Cost | Currency | — | |
| Target Margin Percent | Percent | 25% | Set manually in field settings |
| Credit Card Fee Percent | Percent | 3% | Set manually in field settings |

### Section 2 — Estimate Formulas (Manual Setup in Airtable UI)

| Field | Formula |
|---|---|
| Estimated Labor Cost | {Estimated Labor Hours} * {Labor Rate} |
| Estimated Overhead | {Estimated Labor Hours} * {Overhead Rate} |
| Disposal Buffer | {Disposal Charge Revenue} - {Disposal Estimated Cost} |
| Estimated Base Cost | {Estimated Labor Cost} + {Estimated Overhead} + {Estimated Materials} + {Disposal Estimated Cost} |
| Price Before Fees | IF({Target Margin Percent}, {Estimated Base Cost} / (1 - {Target Margin Percent}), BLANK()) |
| Final Estimated Price | IF({Credit Card Fee Percent}, {Price Before Fees} / (1 - {Credit Card Fee Percent}), {Price Before Fees}) |
| Estimated Profit | {Final Estimated Price} - {Estimated Base Cost} |
| Estimated Profit Margin | IF({Final Estimated Price}, {Estimated Profit} / {Final Estimated Price}, BLANK()) — format as Percent |

### Section 3 — Actuals

| Field | Type | Notes |
|---|---|---|
| Actual Labor Hours | Number | |
| Actual Materials | Currency | |
| Actual Disposal Cost | Currency | |
| Actual Revenue | Currency | |

### Section 3 — Actual Formulas (Manual Setup in Airtable UI)

| Field | Formula |
|---|---|
| Actual Labor Cost | {Actual Labor Hours} * {Labor Rate} |
| Actual Overhead | {Actual Labor Hours} * {Overhead Rate} |
| Actual Total Cost | {Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Disposal Cost} |
| Actual Profit | {Actual Revenue} - {Actual Total Cost} |
| Actual Profit Margin | IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK()) — format as Percent |

### Section 4 — Variance Formulas (Manual Setup in Airtable UI)

| Field | Formula |
|---|---|
| Labor Hour Variance | {Actual Labor Hours} - {Estimated Labor Hours} |
| Labor Cost Variance | {Actual Labor Cost} - {Estimated Labor Cost} |
| Material Variance | {Actual Materials} - {Estimated Materials} |
| Disposal Variance | {Actual Disposal Cost} - {Disposal Estimated Cost} |
| Revenue Variance | {Actual Revenue} - {Final Estimated Price} |
| Profit Variance | {Actual Profit} - {Estimated Profit} |
| Profit Variance Percent | IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK()) — format as Percent |

### Section 5 — Invoice

| Field | Type | Notes |
|---|---|---|
| Invoice Amount Override | Currency | Manual override of Final Estimated Price — used for Path B jobs and post-estimate adjustments |
| Invoice Notes | Long Text | Internal notes visible before sending |
| Deposit Required | Checkbox | |
| Deposit Type | Single Select | Percentage / Fixed Amount |
| Deposit Value | Currency | Dollar amount or percent value depending on Deposit Type |
| Deposit Invoice Sent | Checkbox | |
| Deposit Collected | Checkbox | |
| Ready for Invoice | Checkbox | Zapier trigger — do not check until invoice is reviewed and approved |
| Invoice Sent Date | Date | |
| Payment Date | Date | |
| Invoice Line Items | Linked Record → Invoice Line Items | |

### Section 6 — Change Orders and Expenses

| Field | Type | Notes |
|---|---|---|
| Change Orders | Linked Record → Change Orders | |
| Change Order Total | Rollup | SUM of Change Orders.Approved Value |
| Expenses | Linked Record → Expenses | |
| Expense Total | Rollup | SUM of Expenses.Amount |

### Section 7 — Integrations

| Field | Type | Notes |
|---|---|---|
| GHL Opportunity ID | Single Line Text | |
| GHL Invoice ID | Single Line Text | |
| Stripe Payment ID | Single Line Text | |
| Stripe Payment Link | URL | |
| Slack Channel ID | Single Line Text | |
| Slack Thread ID | Single Line Text | |
| Gusto Project ID | Single Line Text | |
| Divvy Job Tag | Single Line Text | |
| Google Calendar Event ID | Single Line Text | |
| Calendar Sync Status | Single Line Text | Zapier dependent |
| Slack Message Sent | Checkbox | Zapier dependent |

### Section 8 — Admin

| Field | Type | Notes |
|---|---|---|
| Estimate Locked | Checkbox | Lock estimate inputs once job is approved |
| Internal Notes | Long Text | |
| Last Updated Source | Single Line Text | Audit trail |
| Labor Estimation Method | Single Line Text | Keep during migration — remove later |

---

## Table 3: Change Orders

**Purpose:** Capture scope changes, extra work, and recovered revenue.  
**Primary Field:** Change Order ID (Formula: "CO-" & autonumber)

| Field | Type | Notes |
|---|---|---|
| Change Order ID | Formula | "CO-" & autonumber — Primary field |
| Job | Linked Record → Jobs | |
| Description | Long Text | |
| Source | Single Select | Slack / Admin / Estimator / Client |
| Estimated Value | Currency | |
| Approved Value | Currency | |
| Status | Single Select | Pending / Approved / Rejected / Invoiced |
| Invoice Behavior | Single Select | Add to Final Invoice / Separate Invoice |
| Created Date | Created Time | |
| Approved Date | Date | |
| Notes | Long Text | |

---

## Table 4: Expenses

**Purpose:** Track all job-level expenses from Divvy and manual entries.  
**Primary Field:** Expense ID (Formula: "EXP-" & autonumber)

| Field | Type | Notes |
|---|---|---|
| Expense ID | Formula | "EXP-" & autonumber — Primary field |
| Job | Linked Record → Jobs | |
| Amount | Currency | |
| Vendor | Single Line Text | |
| Date | Date | |
| Category | Single Select | Materials / Disposal / Fuel / Equipment Rental / Subcontractor / Other |
| Payment Source | Single Select | Divvy / Manual |
| Divvy Transaction ID | Single Line Text | |
| Receipt URL | URL | |
| Notes | Long Text | |

---

## Table 5: Pricing Variables

**Purpose:** Centralized control panel for all pricing assumptions. Update here to affect all job estimates.  
**Primary Field:** Variable Name

| Field | Type | Notes |
|---|---|---|
| Variable Name | Single Line Text | Primary field |
| Value | Number | |
| Percent Value | Percent | |
| Currency Value | Currency | |
| Description | Long Text | |
| Active | Checkbox | |
| Last Updated | Date | Audit trail for rate changes |

**Seeded Records:**

| Variable Name | Value | Notes |
|---|---|---|
| Labor Rate | $26 | Blended hourly rate including payroll taxes. Review quarterly. |
| Overhead Rate | $23 | Overhead allocation per productive hour. Review quarterly. |
| Target Margin Percent | 25% | Target gross profit margin for pricing. |
| Credit Card Fee Percent | 3% | Estimated card processing fee adjustment. |
| Default Disposal Charge | $300 | Standard estimated disposal charge per dump unit. |

---

## Table 6: Invoice Line Items

**Purpose:** Individual line items that compose each invoice. Auto-generated from Job Scope selections and Scope Library, fully editable before sending.  
**Primary Field:** Line Item Name

| Field | Type | Notes |
|---|---|---|
| Line Item Name | Single Line Text | Primary field — auto-populated from Job Scope |
| Job | Linked Record → Jobs | |
| Scope Library Reference | Linked Record → Scope Library | Tracks which template was used |
| Description | Long Text | Auto-generated from Scope Library default, fully editable |
| Amount | Currency | Pre-filled from estimate, overrideable |
| Quantity | Number | Default 1 |
| Sort Order | Number | Controls display order on invoice |
| Line Item Type | Single Select | Scope Item / Change Order / Deposit / Materials Reimbursement / Labor / Other |
| Invoice Group | Single Select | Deposit Invoice / Final Invoice |
| Include on Invoice | Checkbox | Default checked — uncheck to exclude from invoice |
| Line Item ID | Autonumber | |

---

## Table 7: Scope Library

**Purpose:** Master library of scope types with default descriptions and estimate inputs. Drives Invoice Line Item auto-generation and provides estimating baselines.  
**Primary Field:** Scope Name

| Field | Type | Notes |
|---|---|---|
| Scope Name | Single Line Text | Primary field — matches Job Scope multi-select options exactly |
| Default Description | Long Text | Standard invoice language for this scope type — editable per job |
| Default Labor Hours | Number | Baseline estimate input |
| Default Materials Cost | Currency | Baseline estimate input |
| Default Dump Count | Number | Typical dump count for this scope |
| Job Type Applicability | Multi-Select | Residential / Commercial |
| Active | Checkbox | |
| Jobs | Linked Record → Jobs | |

**Seeded Records:**

| Scope Name | Default Labor Hours | Default Dump Count |
|---|---|---|
| Kitchen Demo | 8 | 1 |
| Bathroom Demo | 6 | 1 |
| Full House Gut | 40 | 4 |
| Flooring Removal | 6 | 1 |
| Concrete Demo | 8 | 2 |
| Drywall-Wall Demo | 6 | 1 |
| Ceiling Demo | 5 | 1 |
| Exterior Demo | 16 | 2 |
| Fireplace Demo | 6 | 1 |
| Stair-Trim Demo | 4 | 1 |
| Window-Door Removal | 4 | 1 |
| Cabinet Removal | 4 | 1 |
| Shed-Structure Removal | 6 | 1 |
| Deck-Patio Removal | 8 | 1 |
| Pool-Water Feature Demo | 16 | 2 |
| Carport Removal | 6 | 1 |
| Junk Removal-Cleanout | 4 | 1 |
| Construction Debris Hauling | 4 | 1 |
| Jobsite Cleanup | 3 | 1 |

---

## Invoice Workflows

### Path A — Estimate First (standard jobs)
1. Job scoped and estimate built in Airtable
2. Job marked Completed
3. Invoice Line Items auto-generated from Job Scope + Scope Library defaults
4. Amounts pre-filled from Final Estimated Price
5. Review and edit descriptions and amounts as needed
6. Check Ready for Invoice → Zapier triggers GHL invoice creation
7. GHL Invoice ID written back to Jobs table

### Path B — Invoice Only (trusted contractor relationships)
1. Job completed without prior estimate
2. Actual Labor and Expenses pulled from Gusto and Divvy
3. Invoice Amount Override entered manually
4. Invoice Line Items created manually or from Scope Library
5. Check Ready for Invoice → Zapier triggers GHL invoice creation

### Deposit Flow
1. Deposit Required checked on job
2. Deposit Type set (Percentage or Fixed Amount) and Deposit Value entered
3. Deposit Invoice line item created with Invoice Group = Deposit Invoice
4. Deposit invoice sent and collected before work begins
5. Final invoice sent on completion with deposit noted

### Change Order Flow
- **Add to Final Invoice:** Change order line item added to Invoice Line Items with Line Item Type = Change Order and Invoice Group = Final Invoice
- **Separate Invoice:** Zapier generates standalone GHL invoice for the change order only

---

## Zapier Automations

| Trigger | Action | Notes |
|---|---|---|
| Jobs.Status → Scheduled | Post to Slack crew channel | Crew-specific routing by Crew field |
| Jobs.Ready for Invoice = checked | Create GHL invoice from Invoice Line Items | Deposit vs Final determined by Invoice Group |
| GHL Invoice paid | Update Jobs.Status → Paid, write Payment Date | Stripe webhook via GHL |
| Gusto payroll run | Update Actual Labor Hours on linked Job | Requires Gusto Project ID on job |
| Divvy transaction tagged | Create Expense record in Airtable | Requires Divvy Job Tag on job |

---

## Manual Setup Checklist (Airtable UI — Cannot be Created via API)

### Jobs Table
- [ ] Job Number — Autonumber field
- [ ] Job ID — Formula: "JOB-" & ({Job Number} + 1000) — set as primary field
- [ ] Client — Linked Record → Clients
- [ ] Client Type Lookup — Lookup from Clients.Client Type
- [ ] Invoice Email Lookup — Lookup from Clients.Invoice Email Final
- [ ] Estimated Labor Cost — Formula (see Section 2)
- [ ] Estimated Overhead — Formula (see Section 2)
- [ ] Disposal Buffer — Formula (see Section 2)
- [ ] Estimated Base Cost — Formula (see Section 2)
- [ ] Price Before Fees — Formula (see Section 2)
- [ ] Final Estimated Price — Formula (see Section 2)
- [ ] Estimated Profit — Formula (see Section 2)
- [ ] Estimated Profit Margin — Formula, format as Percent (see Section 2)
- [ ] Actual Labor Cost — Formula (see Section 3)
- [ ] Actual Overhead — Formula (see Section 3)
- [ ] Actual Total Cost — Formula (see Section 3)
- [ ] Actual Profit — Formula (see Section 3)
- [ ] Actual Profit Margin — Formula, format as Percent (see Section 3)
- [ ] Labor Hour Variance — Formula (see Section 4)
- [ ] Labor Cost Variance — Formula (see Section 4)
- [ ] Material Variance — Formula (see Section 4)
- [ ] Disposal Variance — Formula (see Section 4)
- [ ] Revenue Variance — Formula (see Section 4)
- [ ] Profit Variance — Formula (see Section 4)
- [ ] Profit Variance Percent — Formula, format as Percent (see Section 4)
- [ ] Change Orders — Linked Record → Change Orders
- [ ] Change Order Total — Rollup: SUM of Change Orders.Approved Value
- [ ] Expenses — Linked Record → Expenses
- [ ] Expense Total — Rollup: SUM of Expenses.Amount
- [ ] Invoice Line Items — Linked Record → Invoice Line Items

### Clients Table
- [ ] Invoice Email Final — Formula: IF({Billing Email}, {Billing Email}, {Email})
- [ ] Jobs — Linked Record → Jobs (may auto-create when Jobs.Client link is added)
- [ ] Total Jobs — Count of linked Jobs
- [ ] Total Revenue — Rollup: SUM of Jobs.Actual Revenue
- [ ] Total Profit — Rollup: SUM of Jobs.Actual Profit

### Change Orders Table
- [ ] Change Order ID — Formula: "CO-" & autonumber (requires autonumber field first)
- [ ] Job — Linked Record → Jobs
- [ ] Created Date — Created Time field

### Expenses Table
- [ ] Expense ID — Formula: "EXP-" & autonumber (requires autonumber field first)
- [ ] Job — Linked Record → Jobs

### Invoice Line Items Table
- [ ] Job — Linked Record → Jobs
- [ ] Scope Library Reference — Linked Record → Scope Library
- [ ] Line Item ID — Autonumber

### Scope Library Table
- [ ] Jobs — Linked Record → Jobs (may auto-create when Jobs.Job Scope link is added)

---

## Field Default Values (Set Manually in Field Settings)

| Table | Field | Default Value |
|---|---|---|
| Jobs | Labor Rate | $26 |
| Jobs | Overhead Rate | $23 |
| Jobs | Disposal Charge Revenue | $300 |
| Jobs | Target Margin Percent | 25% |
| Jobs | Credit Card Fee Percent | 3% |
| Invoice Line Items | Quantity | 1 |
| Invoice Line Items | Include on Invoice | Checked |
| Scope Library | Active | Checked |

---

## Pricing Assumptions (As of April 2026)

| Metric | Value | Notes |
|---|---|---|
| Blended Labor Rate | $26/hr | Review quarterly against Gusto actuals |
| Overhead Rate | $23/hr | Review quarterly against P&L |
| Target Gross Margin | 25% | Minimum floor — adjust per job type |
| Credit Card Fee | 3% | Stripe processing estimate |
| Typical Dump Fee | $300/load | Varies by haul site — update Disposal Estimated Cost per job |

---

## Key Contacts

| Role | Name |
|---|---|
| CFO | Matt Risenmay (CTA Integrity) |
| Crew 1 Leader | Nick |
| Crew 2 Leader | Alex |

---

*This file is the source of truth for the Lost Boys Demolition Airtable system. Update it whenever schema changes are made. Reference it at the start of any Claude Code session to provide system context.*
