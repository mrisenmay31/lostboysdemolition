# Lost Boys Demolition — Airtable System Schema Overview

**Last Updated:** April 29, 2026
**System Purpose:** Job Costing + Pricing Engine + Operations Management
**Base:** Lost Boys Demolition (Airtable)

---

## ARCHITECTURE DECISION — CALCULATION OWNERSHIP

This is a critical design principle. Understanding where calculations live prevents duplicate logic and maintenance problems.

| Layer | Owns | How |
|---|---|---|
| **Fillout** | Estimate calculations | Live preview for estimator, submits final numbers to Airtable |
| **Airtable** | Stores estimate outputs | Plain currency/percent fields — receives Fillout's submitted values, no formula |
| **Airtable** | Actual cost calculations | Formula fields — calculated post-job as Gusto hours and Divvy expenses sync in |
| **Airtable** | Variance calculations | Formula fields — compares estimate vs. actual automatically |

**Why this matters:**
- Fillout uses pre-fill from the Pricing Variables table to pull Labor Rate and Overhead Rate dynamically — no dual maintenance of rates
- Estimators get live calculation preview in Fillout before submitting
- Airtable actuals and variances calculate automatically as job data flows in from Gusto and Divvy
- A system estimators actually use beats a theoretically perfect system they ignore

---

## Tech Stack

| Tool | Role |
|---|---|
| Airtable | Operational database / source of truth |
| Fillout | Job intake form — estimate calculations and job creation |
| Gusto | Payroll and labor time tracking — populates Actual Labor Hours |
| Divvy | Job expense tracking — populates Expenses table |
| GoHighLevel (GHL) | CRM, proposals, and invoicing |
| Stripe | Payment processing (via GHL) |
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
| Invoice Email Final | Formula | IF({Billing Email}, {Billing Email}, {Email}) — manual setup |
| GHL Contact ID | Single Line Text | |
| GHL Company ID | Single Line Text | |
| Jobs | Linked Record → Jobs | Auto-created when Jobs.Client link is added |
| Total Jobs | Count | Count of linked Jobs — manual setup |
| Total Revenue | Rollup | SUM of Jobs.Actual Revenue — manual setup |
| Total Profit | Rollup | SUM of Jobs.Actual Profit — manual setup |

---

## Table 2: Jobs

**Purpose:** Core operational and financial record for every job.
**Primary Field:** Job ID (Formula: "JOB-" & ({Job Number} + 1000))

### Section 1 — Job Info

| Field | Type | Notes |
|---|---|---|
| Job Number | Autonumber | Manual setup |
| Job ID | Formula | "JOB-" & ({Job Number} + 1000) — Primary field — manual setup |
| Job Name | Single Line Text | |
| Client | Linked Record → Clients | Manual setup — single record |
| Client Type Lookup | Lookup | From Clients.Client Type — manual setup |
| Invoice Email Lookup | Lookup | From Clients.Invoice Email Final — manual setup |
| Engagement Type | Single Select | Contractor Job / Homeowner Direct / Subcontract Work |
| Job Type | Single Select | Residential / Commercial |
| Job Scope | Multi-Select | 19 options — see Scope Library table |
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

---

### Section 2 — Estimate Fields

**These are plain fields — NOT formulas.**
Fillout calculates these in real time during estimating using rates pre-filled from Pricing Variables. The final values are submitted to Airtable and stored as static inputs. No Airtable formula needed.

| Field | Type | Source | Notes |
|---|---|---|---|
| Estimated Labor Hours | Number | Fillout input | Raw estimator input |
| Labor Rate | Currency | Fillout pre-fill from Pricing Variables | Default $26 |
| Overhead Rate | Currency | Fillout pre-fill from Pricing Variables | Default $23 |
| Target Margin Percent | Percent | Fillout input (slider) | Default 25% |
| Credit Card Fee Percent | Percent | Fillout pre-fill from Pricing Variables | Default 3% |
| Estimated Materials | Currency | Fillout input | |
| Dump Fee Revenue | Currency | Fillout pre-fill from Pricing Variables | Default $300 |
| Estimated Dump Cost | Currency | Fillout input | |
| Estimated Labor Cost | Currency | Fillout calculated → submitted | Hours × Labor Rate |
| Estimated Overhead | Currency | Fillout calculated → submitted | Hours × Overhead Rate |
| Dump Fee Buffer | Currency | Fillout calculated → submitted | Dump Fee Revenue - Estimated Dump Cost |
| Estimated Base Cost | Currency | Fillout calculated → submitted | Labor + Overhead + Materials + Estimated Dump Cost |
| Price Before Fees | Currency | Fillout calculated → submitted | Base Cost / (1 - Margin %) |
| Final Estimated Price | Currency | Fillout calculated → submitted | Price Before Fees / (1 - CC Fee %) |
| Estimated Profit | Currency | Fillout calculated → submitted | Final Price - Base Cost |
| Estimated Profit Margin | Percent | Fillout calculated → submitted | Profit / Final Price |

---

### Section 3 — Actuals

**Actual inputs populated post-job from Gusto and Divvy via Zapier.**
Airtable formula fields calculate cost and margin automatically once actuals are populated.

| Field | Type | Source | Notes |
|---|---|---|---|
| Actual Labor Hours | Number | Gusto → Zapier → Airtable | Populated after payroll run |
| Actual Materials | Currency | Divvy → Zapier → Airtable | Job-tagged Divvy transactions |
| Actual Dump Cost | Currency | Divvy → Zapier → Airtable | Dump-tagged Divvy transactions |
| Actual Revenue | Currency | Manual or GHL/Stripe webhook | Invoice amount paid |

**Actual Formula Fields — Airtable calculates automatically (manual setup required):**

| Field | Formula |
|---|---|
| Actual Labor Cost | {Actual Labor Hours} * {Labor Rate} |
| Actual Overhead | {Actual Labor Hours} * {Overhead Rate} |
| Actual Total Cost | {Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Dump Cost} |
| Actual Profit | {Actual Revenue} - {Actual Total Cost} |
| Actual Profit Margin | IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK()) — format as Percent |

---

### Section 4 — Variance Formula Fields

**Airtable calculates all of these automatically — no manual entry ever required.**
Most valuable fields in the system: show whether estimates are accurate over time and drive continuous improvement in pricing.

| Field | Formula |
|---|---|
| Labor Hour Variance | {Actual Labor Hours} - {Estimated Labor Hours} |
| Labor Cost Variance | {Actual Labor Cost} - {Estimated Labor Cost} |
| Material Variance | {Actual Materials} - {Estimated Materials} |
| Dump Fee Variance | {Actual Dump Cost} - {Estimated Dump Cost} |
| Revenue Variance | {Actual Revenue} - {Final Estimated Price} |
| Profit Variance | {Actual Profit} - {Estimated Profit} |
| Profit Variance Percent | IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK()) — format as Percent |

---

### Section 5 — Invoice

| Field | Type | Notes |
|---|---|---|
| Invoice Amount Override | Currency | Manual override — Path B jobs and post-estimate adjustments |
| Invoice Notes | Long Text | Internal notes before sending |
| Deposit Required | Checkbox | |
| Deposit Type | Single Select | Percentage / Fixed Amount |
| Deposit Value | Currency | |
| Deposit Invoice Sent | Checkbox | |
| Deposit Collected | Checkbox | |
| Ready for Invoice | Checkbox | Zapier trigger — do not check until reviewed and approved |
| Invoice Sent Date | Date | |
| Payment Date | Date | |
| Invoice Line Items | Linked Record → Invoice Line Items | Manual setup |

### Section 6 — Change Orders and Expenses

| Field | Type | Notes |
|---|---|---|
| Change Orders | Linked Record → Change Orders | Manual setup |
| Change Order Total | Rollup | SUM of Change Orders.Approved Value — manual setup |
| Expenses | Linked Record → Expenses | Manual setup |
| Expense Total | Rollup | SUM of Expenses.Amount — manual setup |

### Section 7 — Integrations

| Field | Type | Notes |
|---|---|---|
| GHL Opportunity ID | Single Line Text | |
| GHL Invoice ID | Single Line Text | |
| Stripe Payment ID | Single Line Text | |
| Stripe Payment Link | URL | |
| Slack Channel ID | Single Line Text | |
| Slack Thread ID | Single Line Text | |
| Gusto Project ID | Single Line Text | Required for Gusto → Actual Labor Hours sync |
| Divvy Job Tag | Single Line Text | Required for Divvy → Expenses sync |
| Google Calendar Event ID | Single Line Text | |
| Calendar Sync Status | Single Line Text | |
| Slack Message Sent | Checkbox | |

### Section 8 — Admin

| Field | Type | Notes |
|---|---|---|
| Estimate Locked | Checkbox | Lock estimate inputs once job approved |
| Internal Notes | Long Text | |
| Last Updated Source | Single Line Text | |
| Labor Estimation Method | Single Line Text | Keep during migration |

---

## Table 3: Change Orders

**Purpose:** Capture scope changes, extra work, and recovered revenue.

| Field | Type | Notes |
|---|---|---|
| Change Order ID | Formula | "CO-" & autonumber — manual setup |
| Job | Linked Record → Jobs | Manual setup |
| Description | Long Text | |
| Source | Single Select | Slack / Admin / Estimator / Client |
| Estimated Value | Currency | |
| Approved Value | Currency | |
| Status | Single Select | Pending / Approved / Rejected / Invoiced |
| Invoice Behavior | Single Select | Add to Final Invoice / Separate Invoice |
| Created Date | Created Time | Manual setup |
| Approved Date | Date | |
| Notes | Long Text | |

---

## Table 4: Expenses

**Purpose:** Track all job-level expenses. Populated primarily via Divvy → Zapier → Airtable.

| Field | Type | Notes |
|---|---|---|
| Expense ID | Formula | "EXP-" & autonumber — manual setup |
| Job | Linked Record → Jobs | Manual setup |
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

**Purpose:** Centralized rate control. Fillout pre-fills from this table — rates only need to be maintained in one place.

| Field | Type | Notes |
|---|---|---|
| Variable Name | Single Line Text | Primary field |
| Value | Number | |
| Percent Value | Percent | |
| Currency Value | Currency | |
| Description | Long Text | |
| Active | Checkbox | |
| Last Updated | Date | Update whenever rates change |

**Seeded Records:**

| Variable | Value | Review Frequency |
|---|---|---|
| Labor Rate | $26/hr | Quarterly — verify against Gusto actuals |
| Overhead Rate | $23/hr | Quarterly — verify against P&L |
| Target Margin Percent | 25% | As needed |
| Credit Card Fee Percent | 3% | As needed |
| Dump Fee | $300 | As needed |

---

## Table 6: Invoice Line Items

**Purpose:** Individual line items composing each invoice. Auto-generated from Job Scope + Scope Library, fully editable before sending.

| Field | Type | Notes |
|---|---|---|
| Line Item Name | Single Line Text | Primary — auto-populated from Job Scope |
| Job | Linked Record → Jobs | Manual setup |
| Scope Library Reference | Linked Record → Scope Library | Manual setup |
| Description | Long Text | Auto-generated from Scope Library default, fully editable |
| Amount | Currency | Pre-filled from estimate, overrideable |
| Quantity | Number | Default 1 |
| Sort Order | Number | Controls display order on invoice |
| Line Item Type | Single Select | Scope Item / Change Order / Deposit / Materials Reimbursement / Labor / Other |
| Invoice Group | Single Select | Deposit Invoice / Final Invoice |
| Include on Invoice | Checkbox | Default checked |
| Line Item ID | Autonumber | Manual setup |

---

## Table 7: Scope Library

**Purpose:** Master library of scope types with default descriptions and estimate inputs.

| Field | Type | Notes |
|---|---|---|
| Scope Name | Single Line Text | Primary — matches Job Scope multi-select options exactly |
| Default Description | Long Text | Standard invoice language — editable per job |
| Default Labor Hours | Number | Baseline estimate input |
| Default Materials Cost | Currency | Baseline estimate input |
| Default Dump Count | Number | Typical dump count for this scope |
| Job Type Applicability | Multi-Select | Residential / Commercial |
| Active | Checkbox | |
| Jobs | Linked Record → Jobs | Manual setup |

**19 Seeded Records:**

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

### Path A — Estimate First
1. Estimator completes Fillout form — live calculations update in real time
2. Fillout pre-fills Labor Rate, Overhead Rate, CC Fee % from Pricing Variables table
3. Form submitted → Airtable Jobs record created with all estimate values as plain fields
4. Job completed → Gusto hours sync to Actual Labor Hours, Divvy expenses sync to Expenses
5. Airtable automatically calculates all Actual and Variance formula fields
6. Invoice Line Items auto-generated from Job Scope + Scope Library defaults
7. Review and edit line items and amounts as needed
8. Ready for Invoice checked → GHL invoice created

### Path B — Invoice at Completion
1. Fillout form submitted with job info and scope only — Path B toggle collapses estimate fields
2. Job completed → Gusto and Divvy sync actual costs
3. Invoice Amount Override entered manually
4. Invoice Line Items created manually or from Scope Library
5. Ready for Invoice checked → GHL invoice created

---

## Manual Setup Checklist — Airtable UI

Complete in this exact order:

### Round 1 — Foundation (do first)
- [ ] Jobs → Job Number (Autonumber)
- [ ] Jobs → Job ID (Formula: "JOB-" & ({Job Number} + 1000)) → set as primary field
- [ ] Clients → Invoice Email Final (Formula: IF({Billing Email}, {Billing Email}, {Email}))

### Round 2 — Linked Records
- [ ] Jobs → Client (Linked Record → Clients, single record)
- [ ] Jobs → Client Type Lookup (Lookup from Clients.Client Type)
- [ ] Jobs → Invoice Email Lookup (Lookup from Clients.Invoice Email Final)
- [ ] Jobs → Change Orders (Linked Record → Change Orders, multiple)
- [ ] Jobs → Expenses (Linked Record → Expenses, multiple)
- [ ] Jobs → Invoice Line Items (Linked Record → Invoice Line Items, multiple)
- [ ] Invoice Line Items → Job (Linked Record → Jobs, single)
- [ ] Invoice Line Items → Scope Library Reference (Linked Record → Scope Library, single)
- [ ] Invoice Line Items → Line Item ID (Autonumber)
- [ ] Scope Library → Jobs (Linked Record → Jobs, multiple)

### Round 3 — Rollups and Counts
- [ ] Jobs → Change Order Total (Rollup: SUM of Change Orders.Approved Value)
- [ ] Jobs → Expense Total (Rollup: SUM of Expenses.Amount)
- [ ] Clients → Total Jobs (Count of linked Jobs)
- [ ] Clients → Total Revenue (Rollup: SUM of Jobs.Actual Revenue)
- [ ] Clients → Total Profit (Rollup: SUM of Jobs.Actual Profit)

### Round 4 — Actual Formula Fields (enter in this order)
- [ ] Actual Labor Cost → {Actual Labor Hours} * {Labor Rate}
- [ ] Actual Overhead → {Actual Labor Hours} * {Overhead Rate}
- [ ] Actual Total Cost → {Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Dump Cost}
- [ ] Actual Profit → {Actual Revenue} - {Actual Total Cost}
- [ ] Actual Profit Margin → IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK()) — format as Percent

### Round 5 — Variance Formula Fields (enter in this order)
- [ ] Labor Hour Variance → {Actual Labor Hours} - {Estimated Labor Hours}
- [ ] Labor Cost Variance → {Actual Labor Cost} - {Estimated Labor Cost}
- [ ] Material Variance → {Actual Materials} - {Estimated Materials}
- [ ] Dump Fee Variance → {Actual Dump Cost} - {Estimated Dump Cost}
- [ ] Revenue Variance → {Actual Revenue} - {Final Estimated Price}
- [ ] Profit Variance → {Actual Profit} - {Estimated Profit}
- [ ] Profit Variance Percent → IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK()) — format as Percent

### Round 6 — Change Orders and Expenses
- [ ] Change Orders → Job (Linked Record → Jobs)
- [ ] Change Orders → Change Order ID (Formula: "CO-" & {autonumber field name})
- [ ] Change Orders → Created Date (Created Time field)
- [ ] Expenses → Job (Linked Record → Jobs)
- [ ] Expenses → Expense ID (Formula: "EXP-" & {autonumber field name})

### Round 7 — Default Values
- [ ] Jobs → Labor Rate: default $26
- [ ] Jobs → Overhead Rate: default $23
- [ ] Jobs → Dump Fee Revenue: default $300
- [ ] Jobs → Target Margin Percent: default 25%
- [ ] Jobs → Credit Card Fee Percent: default 3%
- [ ] Invoice Line Items → Quantity: default 1
- [ ] Invoice Line Items → Include on Invoice: default checked

---

## Fillout Form — Planned Updates (Phase 5)

**Add:**
- Job Scope (multi-select — 19 options)
- Engagement Type (Contractor Job / Homeowner Direct / Subcontract Work)
- Estimator (Dane / Jackson)
- Path B toggle (collapses estimate fields for invoice-at-completion jobs)

**Rename:** Any Other Details → Scope Notes

**Configure pre-fill:** Labor Rate, Overhead Rate, CC Fee %, Dump Fee pulled from Pricing Variables table

**Field mapping updates to new Airtable field names:**

| Current Fillout Field | Maps to Airtable Field |
|---|---|
| Direct Labor Costs Estimate | Estimated Labor Cost |
| Other Job Specific Costs Estimate | Estimated Materials |
| Dump Fee Estimate | Estimated Dump Cost |
| Total Direct Costs | Estimated Base Cost |
| Overhead Allocation | Estimated Overhead |
| Total Bid Amount | Final Estimated Price |
| Profit Percentage (slider) | Target Margin Percent |

---

## Pricing Assumptions (As of April 2026)

| Metric | Value | Notes |
|---|---|---|
| Blended Labor Rate | $26/hr | Review quarterly against Gusto actuals |
| Overhead Rate | $23/hr | Review quarterly against P&L |
| Target Gross Margin | 25% | Minimum floor |
| Credit Card Fee | 3% | Stripe processing estimate |
| Typical Dump Fee | $300/load | Update Estimated Dump Cost per job |

---

## Key Contacts

| Role | Name |
|---|---|
| CFO | Matt Risenmay (CTA Integrity) |
| Crew 1 Leader | Nick |
| Crew 2 Leader | Alex |
| Estimators | Dane, Jackson |

---

*Update this file whenever schema or architectural decisions change. Read at the start of every Claude Code session.*
