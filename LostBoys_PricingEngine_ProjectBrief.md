# Lost Boys Demolition — Pricing Engine & Operations System
## Comprehensive Project Brief
**Last Updated:** April 29, 2026
**Prepared by:** CTA Integrity (CFO Services)
**For:** AI Agent Project Oversight and Build Assistance

---

## 1. COMPANY OVERVIEW

**Company:** Lost Boys Demolition and Junk Removal LLC
**Location:** 1031 N 500 W, Orem, Utah 84057 (Wasatch Front area)
**Business Type:** Specialty contractor — surgical demolition (floors, countertops, cabinets, interior gut, exterior demo, concrete, junk removal). Not full structure / wrecking ball demolition.

**Revenue Range:** Residential $500–$25,000 / Commercial $5,000–$60,000+

**Key Personnel:**
- Matt Risenmay — Contracted CFO (CTA Integrity)
- Nick — Crew 1 Leader
- Alex — Crew 2 Leader
- Dane — Estimator
- Jackson — Estimator / Crew

**Financial Benchmarks (2025):**
- Labor as % of revenue: ~63%
- Target gross margin: 40–60%
- Target net profit: 8–15%
- Blended labor rate: $26/hr (includes payroll taxes)
- Overhead rate: $23/hr
- Default disposal charge: $300/load

---

## 2. PROJECT OVERVIEW

### What Is Being Built
A fully integrated Job Costing + Pricing Engine + Operations Management System. Goals:
- Accurate data-driven estimates with built-in margin targets
- Auto-generate professional invoices from job scope selections
- Track actual costs vs. estimates on every job
- Measure job profitability in real time
- Automate crew scheduling notifications
- Build a data layer supporting financial reporting and business intelligence

### Why It Matters
Lost Boys currently operates with manual estimates, manually created invoices in GHL, and no systematic connection between what was estimated, what was spent, and what was earned. This system closes that loop — every completed job improves future pricing accuracy.

### Primary Design Principles
1. Airtable is the single source of truth
2. Every job has a unique Job ID (JOB-1001 format) flowing through all connected systems
3. Automation handles routine tasks; humans review critical decisions
4. MVP-first, clean enough to support future automation
5. A system estimators actually use beats a theoretically perfect system they ignore

---

## 3. TECH STACK

| Tool | Role | Status |
|---|---|---|
| Airtable | Operational database / source of truth | Active — base being built |
| Fillout | Job intake form — estimate calculations and job creation | Active — rebuild planned Phase 5 |
| GoHighLevel (GHL) | CRM, proposals, invoicing | Active — manual invoicing currently |
| Stripe | Payment processing via GHL | Active |
| Gusto | Payroll and labor time tracking — populates Actual Labor Hours | Active |
| Divvy | Field expense cards — populates Expenses table | Active |
| Zapier | Automation layer | Active — Slack crew scheduling live |
| Slack | Crew communication and scheduling | Active |
| Google Calendar | Job scheduling | Active |
| Google Drive | Document storage | Active |
| GitHub | Version control — repo: mrisenmay31/lostboysdemolition (private) | Active |
| Claude Code | Airtable schema build and automation scripts | Active |

---

## 4. CRITICAL ARCHITECTURE DECISION — CALCULATION OWNERSHIP

Every agent and developer on this project must understand this before touching any build work.

| Layer | Owns | Method |
|---|---|---|
| Fillout | Estimate calculations | Live preview during estimating; submits final calculated values to Airtable |
| Airtable | Estimate outputs | Plain currency/percent fields — stores what Fillout submits, no formula |
| Airtable | Actual cost calculations | Formula fields — auto-calculated when Gusto and Divvy data syncs in |
| Airtable | Variance analysis | Formula fields — compares estimate vs. actual automatically |

**Why Fillout owns estimates:** Estimators need live calculations updating as they change inputs. Fillout provides this natively. Forcing them into Airtable kills adoption.

**Why no dual rate maintenance:** Fillout uses pre-fill capability to pull Labor Rate, Overhead Rate, and CC Fee % dynamically from the Airtable Pricing Variables table. One update propagates everywhere.

**Why Airtable owns actuals:** Actual costs don't exist at form submission time — they arrive weeks later from Gusto (labor) and Divvy (expenses). Airtable formula fields calculate actual costs and variances automatically as data flows in.

---

## 5. AIRTABLE SCHEMA

### TABLE 1: Clients
Primary Field: Client Name

| Field | Type | Notes |
|---|---|---|
| Client Name | Single Line Text | Primary |
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
| Jobs | Linked Record → Jobs | Auto-created when Jobs.Client link added |
| Total Jobs | Count | Linked Jobs |
| Total Revenue | Rollup | SUM Jobs.Actual Revenue |
| Total Profit | Rollup | SUM Jobs.Actual Profit |

---

### TABLE 2: Jobs
Primary Field: Job ID — Formula: "JOB-" & ({Job Number} + 1000)

**Section 1 — Job Info**

| Field | Type | Notes |
|---|---|---|
| Job Number | Autonumber | |
| Job ID | Formula | "JOB-" & ({Job Number} + 1000) — Primary |
| Job Name | Single Line Text | |
| Client | Linked Record → Clients | Single record |
| Client Type Lookup | Lookup | Clients.Client Type |
| Invoice Email Lookup | Lookup | Clients.Invoice Email Final |
| Engagement Type | Single Select | Contractor Job / Homeowner Direct / Subcontract Work |
| Job Type | Single Select | Residential / Commercial |
| Job Scope | Multi-Select | 19 options — see Scope Library |
| Estimator | Single Select | Dane / Jackson |
| Crew | Single Select | Crew 1 / Crew 2 / Crew 3 / Crew 4 / Jackson / Other |
| Status | Single Select | Lead-Request / Scheduled / In Progress / Completed / Ready for Invoice / Invoiced / Paid / Cancelled |
| Start Date | Date | |
| End Date | Date | |
| Job Start Time | Single Line Text | |
| Scope Notes | Long Text | Drives invoice description auto-generation |
| Days at Job | Number | |
| Number of Employees | Number | |
| Total Number of Dumps | Number | |

**Section 2 — Estimate Fields (PLAIN FIELDS — NOT FORMULAS)**
Fillout calculates and submits these. Airtable stores as static values only.

| Field | Type | Source |
|---|---|---|
| Estimated Labor Hours | Number | Fillout input |
| Labor Rate | Currency | Fillout pre-fill from Pricing Variables (default $26) |
| Overhead Rate | Currency | Fillout pre-fill from Pricing Variables (default $23) |
| Target Margin Percent | Percent | Fillout input slider (default 25%) |
| Credit Card Fee Percent | Percent | Fillout pre-fill from Pricing Variables (default 3%) |
| Estimated Materials | Currency | Fillout input |
| Dump Fee Revenue | Currency | Fillout pre-fill from Pricing Variables (default $300) |
| Estimated Dump Cost | Currency | Fillout input |
| Estimated Labor Cost | Currency | Fillout calculated → submitted |
| Estimated Overhead | Currency | Fillout calculated → submitted |
| Dump Fee Buffer | Currency | Fillout calculated → submitted |
| Estimated Base Cost | Currency | Fillout calculated → submitted |
| Price Before Fees | Currency | Fillout calculated → submitted |
| Final Estimated Price | Currency | Fillout calculated → submitted |
| Estimated Profit | Currency | Fillout calculated → submitted |
| Estimated Profit Margin | Percent | Fillout calculated → submitted |

**Section 3 — Actuals**
Input fields populated post-job from Gusto and Divvy via Zapier:

| Field | Type | Source |
|---|---|---|
| Actual Labor Hours | Number | Gusto → Zapier → Airtable |
| Actual Materials | Currency | Divvy → Zapier → Airtable |
| Actual Dump Cost | Currency | Divvy → Zapier → Airtable |
| Actual Revenue | Currency | Manual or GHL/Stripe webhook |

Airtable formula fields (auto-calculated — manual setup in UI required):

| Field | Formula |
|---|---|
| Actual Labor Cost | {Actual Labor Hours} * {Labor Rate} |
| Actual Overhead | {Actual Labor Hours} * {Overhead Rate} |
| Actual Total Cost | {Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Dump Cost} |
| Actual Profit | {Actual Revenue} - {Actual Total Cost} |
| Actual Profit Margin | IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK()) — Percent format |

**Section 4 — Variance Formulas (all Airtable — auto-calculated)**
Most valuable fields in the system — reveal estimate accuracy over time.

| Field | Formula |
|---|---|
| Labor Hour Variance | {Actual Labor Hours} - {Estimated Labor Hours} |
| Labor Cost Variance | {Actual Labor Cost} - {Estimated Labor Cost} |
| Material Variance | {Actual Materials} - {Estimated Materials} |
| Dump Fee Variance | {Actual Dump Cost} - {Estimated Dump Cost} |
| Revenue Variance | {Actual Revenue} - {Final Estimated Price} |
| Profit Variance | {Actual Profit} - {Estimated Profit} |
| Profit Variance Percent | IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK()) — Percent format |

**Section 5 — Invoice**

| Field | Type | Notes |
|---|---|---|
| Invoice Amount Override | Currency | Path B jobs and post-estimate adjustments |
| Invoice Notes | Long Text | |
| Deposit Required | Checkbox | |
| Deposit Type | Single Select | Percentage / Fixed Amount |
| Deposit Value | Currency | |
| Deposit Invoice Sent | Checkbox | |
| Deposit Collected | Checkbox | |
| Ready for Invoice | Checkbox | Zapier trigger — do not check until reviewed |
| Invoice Sent Date | Date | |
| Payment Date | Date | |
| Invoice Line Items | Linked Record → Invoice Line Items | |

**Section 6 — Change Orders and Expenses**

| Field | Type | Notes |
|---|---|---|
| Change Orders | Linked Record → Change Orders | |
| Change Order Total | Rollup | SUM Change Orders.Approved Value |
| Expenses | Linked Record → Expenses | |
| Expense Total | Rollup | SUM Expenses.Amount |

**Section 7 — Integrations**

| Field | Type | Notes |
|---|---|---|
| GHL Opportunity ID | Single Line Text | |
| GHL Invoice ID | Single Line Text | |
| Stripe Payment ID | Single Line Text | |
| Stripe Payment Link | URL | |
| Slack Channel ID | Single Line Text | |
| Slack Thread ID | Single Line Text | |
| Gusto Project ID | Single Line Text | Required for Gusto sync |
| Divvy Job Tag | Single Line Text | Required for Divvy sync |
| Google Calendar Event ID | Single Line Text | |
| Calendar Sync Status | Single Line Text | |
| Slack Message Sent | Checkbox | |

**Section 8 — Admin**

| Field | Type | Notes |
|---|---|---|
| Estimate Locked | Checkbox | |
| Internal Notes | Long Text | |
| Last Updated Source | Single Line Text | |
| Labor Estimation Method | Single Line Text | Keep during migration |

---

### TABLE 3: Change Orders

| Field | Type | Notes |
|---|---|---|
| Change Order ID | Formula | "CO-" & autonumber |
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

### TABLE 4: Expenses

| Field | Type | Notes |
|---|---|---|
| Expense ID | Formula | "EXP-" & autonumber |
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

### TABLE 5: Pricing Variables
Centralized rate control. Fillout pre-fills from this table — one place to maintain rates.

| Field | Type | Notes |
|---|---|---|
| Variable Name | Single Line Text | Primary |
| Value | Number | |
| Percent Value | Percent | |
| Currency Value | Currency | |
| Description | Long Text | |
| Active | Checkbox | |
| Last Updated | Date | Update whenever rates change |

Seeded: Labor Rate ($26) / Overhead Rate ($23) / Target Margin Percent (25%) / Credit Card Fee Percent (3%) / Dump Fee ($300)

---

### TABLE 6: Invoice Line Items

| Field | Type | Notes |
|---|---|---|
| Line Item Name | Single Line Text | Primary |
| Job | Linked Record → Jobs | |
| Scope Library Reference | Linked Record → Scope Library | |
| Description | Long Text | Auto-generated, fully editable |
| Amount | Currency | Pre-filled from estimate, overrideable |
| Quantity | Number | Default 1 |
| Sort Order | Number | Controls invoice display order |
| Line Item Type | Single Select | Scope Item / Change Order / Deposit / Materials Reimbursement / Labor / Other |
| Invoice Group | Single Select | Deposit Invoice / Final Invoice |
| Include on Invoice | Checkbox | Default checked |
| Line Item ID | Autonumber | |

---

### TABLE 7: Scope Library

| Field | Type | Notes |
|---|---|---|
| Scope Name | Single Line Text | Primary — matches Job Scope options exactly |
| Default Description | Long Text | Standard invoice language — editable per job |
| Default Labor Hours | Number | Baseline estimate input |
| Default Materials Cost | Currency | |
| Default Dump Count | Number | |
| Job Type Applicability | Multi-Select | Residential / Commercial |
| Active | Checkbox | |
| Jobs | Linked Record → Jobs | |

19 Seeded Records: Kitchen Demo (8hr/1 dump), Bathroom Demo (6/1), Full House Gut (40/4), Flooring Removal (6/1), Concrete Demo (8/2), Drywall-Wall Demo (6/1), Ceiling Demo (5/1), Exterior Demo (16/2), Fireplace Demo (6/1), Stair-Trim Demo (4/1), Window-Door Removal (4/1), Cabinet Removal (4/1), Shed-Structure Removal (6/1), Deck-Patio Removal (8/1), Pool-Water Feature Demo (16/2), Carport Removal (6/1), Junk Removal-Cleanout (4/1), Construction Debris Hauling (4/1), Jobsite Cleanup (3/1)

---

## 6. INVOICE WORKFLOWS

### Path A — Estimate First
1. Estimator opens Fillout — live calculations update as inputs change
2. Rates pre-filled dynamically from Pricing Variables table
3. Form submitted → Airtable record created with all estimate values as plain fields
4. Job completed → Gusto hours and Divvy expenses sync in
5. Airtable auto-calculates all Actual and Variance formula fields
6. Invoice Line Items auto-generated from Job Scope + Scope Library defaults
7. Review and edit line items and amounts
8. Ready for Invoice checked → GHL invoice created

### Path B — Invoice at Completion
1. Fillout submitted with job info only — Path B toggle hides estimate fields
2. Job completed → actuals sync in
3. Invoice Amount Override entered manually
4. Line items created manually or from Scope Library
5. Ready for Invoice checked → GHL invoice created

### Deposit Flow
Deposit Required → Deposit line item (Invoice Group = Deposit Invoice) → sent first → Final invoice held until deposit collected

### Change Order Flow
- Add to Final Invoice: CO line item added to job's Invoice Line Items
- Separate Invoice: standalone GHL invoice generated for CO

---

## 7. BUILD STATUS

### ✅ Completed
- Airtable tables created via Claude Code: Clients, Change Orders, Expenses, Pricing Variables (5 records seeded), Jobs (51 fields), Invoice Line Items (7 fields), Scope Library (6 fields + 19 records)
- GitHub repo created and initial commit pushed (mrisenmay31/lostboysdemolition, private)
- .gitignore configured (excludes .env, node_modules, CSV, PDF)
- Existing Zapier Slack crew scheduling automations live and working

### 🔄 In Progress — Manual Airtable UI Setup

Complete in this exact order:

**Round 1 — Foundation**
- [ ] Jobs → Job Number (Autonumber)
- [ ] Jobs → Job ID (Formula: "JOB-" & ({Job Number} + 1000)) → set as primary field
- [ ] Clients → Invoice Email Final (Formula: IF({Billing Email}, {Billing Email}, {Email}))

**Round 2 — Linked Records**
- [ ] Jobs → Client (Linked Record → Clients, single)
- [ ] Jobs → Client Type Lookup (Lookup from Clients.Client Type)
- [ ] Jobs → Invoice Email Lookup (Lookup from Clients.Invoice Email Final)
- [ ] Jobs → Change Orders (Linked Record → Change Orders, multiple)
- [ ] Jobs → Expenses (Linked Record → Expenses, multiple)
- [ ] Jobs → Invoice Line Items (Linked Record → Invoice Line Items, multiple)
- [ ] Invoice Line Items → Job (Linked Record → Jobs, single)
- [ ] Invoice Line Items → Scope Library Reference (Linked Record → Scope Library, single)
- [ ] Invoice Line Items → Line Item ID (Autonumber)
- [ ] Scope Library → Jobs (Linked Record → Jobs, multiple)

**Round 3 — Rollups and Counts**
- [ ] Jobs → Change Order Total (Rollup: SUM Change Orders.Approved Value)
- [ ] Jobs → Expense Total (Rollup: SUM Expenses.Amount)
- [ ] Clients → Total Jobs (Count linked Jobs)
- [ ] Clients → Total Revenue (Rollup: SUM Jobs.Actual Revenue)
- [ ] Clients → Total Profit (Rollup: SUM Jobs.Actual Profit)

**Round 4 — Actual Formula Fields (in order)**
- [ ] Actual Labor Cost → {Actual Labor Hours} * {Labor Rate}
- [ ] Actual Overhead → {Actual Labor Hours} * {Overhead Rate}
- [ ] Actual Total Cost → {Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Dump Cost}
- [ ] Actual Profit → {Actual Revenue} - {Actual Total Cost}
- [ ] Actual Profit Margin → IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK()) — Percent format

**Round 5 — Variance Formula Fields (in order)**
- [ ] Labor Hour Variance → {Actual Labor Hours} - {Estimated Labor Hours}
- [ ] Labor Cost Variance → {Actual Labor Cost} - {Estimated Labor Cost}
- [ ] Material Variance → {Actual Materials} - {Estimated Materials}
- [ ] Dump Fee Variance → {Actual Dump Cost} - {Estimated Dump Cost}
- [ ] Revenue Variance → {Actual Revenue} - {Final Estimated Price}
- [ ] Profit Variance → {Actual Profit} - {Estimated Profit}
- [ ] Profit Variance Percent → IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK()) — Percent format

**Round 6 — Change Orders and Expenses**
- [ ] Change Orders → Job (Linked Record → Jobs)
- [ ] Change Orders → Change Order ID (Formula: "CO-" & autonumber)
- [ ] Change Orders → Created Date (Created Time field)
- [ ] Expenses → Job (Linked Record → Jobs)
- [ ] Expenses → Expense ID (Formula: "EXP-" & autonumber)

**Round 7 — Default Values**
- [ ] Jobs → Labor Rate: $26
- [ ] Jobs → Overhead Rate: $23
- [ ] Jobs → Dump Fee Revenue: $300
- [ ] Jobs → Target Margin Percent: 25%
- [ ] Jobs → Credit Card Fee Percent: 3%
- [ ] Invoice Line Items → Quantity: 1
- [ ] Invoice Line Items → Include on Invoice: checked

### 📋 Upcoming Phases

**Phase 1 — Schema Completion (current)**
Complete manual UI setup → run test job record → migrate existing job data → populate Clients from GHL → commit to GitHub

**Phase 2 — Invoice Automation**
Build Invoice Review Airtable view → design Zapier: Ready for Invoice → GHL invoice creation → handle deposit and CO logic → test flow
Note: GHL API invoice automation is complex — DocuMint PDF + Stripe payment link is the identified fallback

**Phase 3 — Scope Library Auto-Generation**
Automation: Job Scope selected → auto-create Invoice Line Items from Scope Library defaults → refine default hours from historical data

**Phase 4 — Actuals Integration**
Gusto project hours → Actual Labor Hours via Zapier / Divvy job-tagged transactions → Expenses table via Zapier
Prerequisites: Gusto Project ID on each job; consistent Divvy job tagging in field

**Phase 5 — Fillout Form Rebuild**
Add: Job Scope, Engagement Type, Estimator, Path B toggle
Configure pre-fill from Pricing Variables
Remap field names to new Airtable schema
Field mapping: Direct Labor Costs Estimate → Estimated Labor Cost / Other Job Specific Costs → Estimated Materials / Dump Fee Estimate → Estimated Dump Cost / Total Direct Costs → Estimated Base Cost / Overhead Allocation → Estimated Overhead / Total Bid Amount → Final Estimated Price / Profit Percentage → Target Margin Percent / Any Other Details → Scope Notes

**Phase 6 — Reporting and Dashboards**
Airtable views: Invoice Queue, Jobs by Crew, Open Change Orders, Overdue Invoices
Financial dashboard: Revenue vs. Estimate, Gross Margin by Job Type, Labor Efficiency by Crew
Quarterly Pricing Variables review process

**Phase 7 — Enhancements**
Margin Alert formula field / Crew performance tracking / Dump fee by dump count model / Scope Library baselines by job type / Alternative invoicing tool evaluation

---

## 8. INSTRUCTIONS FOR AI AGENTS

**Session startup:**
Always read both `schema_overview.md` and this file before beginning any work.

**Claude Code working directory:** `/Users/mattrisenmay/lostboysdemolition/`

**Script requirements:**
- Idempotent — skip if exists, never duplicate
- 250ms delay between Airtable API calls
- Environment variables: AIRTABLE_API_KEY and AIRTABLE_BASE_ID
- Node.js preferred
- Commit to GitHub after every major build step: `git add . && git commit -m "description" && git push`

**Airtable API — cannot create via script (always flag as MANUAL SETUP REQUIRED):**
Formula fields / Rollup fields / Lookup fields / Linked record fields / Autonumber fields / Created time fields

**Do not touch:**
- Existing Zapier automations (Slack crew scheduling)
- .env file — never commit, never share

**Financial guardrails:**
- Do not use "10 and 10" markup logic
- Labor Rate and Overhead Rate must be reviewed quarterly against Gusto actuals
- True all-in labor cost is $27–$29/hr — $26 is conservative, monitor for drift

---

## 9. PROJECT FILES

| File | Purpose |
|---|---|
| schema_overview.md | Complete schema reference — read at every session start |
| LostBoys_PricingEngine_ProjectBrief.md | This file — master project brief |
| setup_airtable.js | Built initial 4 tables via API |
| jobs_schema_prompt.txt | Prompt used to build Jobs, Invoice Line Items, Scope Library |
| .env | API credentials — never share or commit |
| .env.example | Environment variable template |

---

*Master project brief for Lost Boys Demolition Pricing Engine. Update as phases complete and decisions are made.*
