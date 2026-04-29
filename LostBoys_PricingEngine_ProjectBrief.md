# Lost Boys Demolition — Pricing Engine & Operations System
## Comprehensive Project Brief
**Last Updated:** April 29, 2026
**Prepared by:** CTA Integrity (CFO Services)
**For:** AI Agent Project Oversight and Build Assistance

---

## 1. COMPANY OVERVIEW

**Company:** Lost Boys Demolition and Junk Removal LLC
**Location:** 1031 N 500 W, Orem, Utah 84057 (Wasatch Front area)
**Business Type:** Specialty contractor — surgical demolition (floors, countertops, cabinets, interior gut, exterior demo, concrete, junk removal)
**Not:** Full structure / wrecking ball demolition

**Revenue Range:**
- Residential jobs: $500 – $25,000
- Commercial jobs: $5,000 – $60,000+

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
- Overhead allocation: ~29% of labor costs
- Blended labor rate: $26/hr (includes payroll taxes)
- Overhead rate: $23/hr
- Default disposal charge: $300/load

---

## 2. PROJECT OVERVIEW

### What Is Being Built
A fully integrated **Job Costing + Pricing Engine + Operations Management System** for Lost Boys Demolition. The system is designed to:

- Provide accurate, data-driven job estimates with built-in margin targets
- Auto-generate professional invoices from job scope selections
- Track actual costs vs. estimates on every job (labor, materials, disposal)
- Measure job profitability in real time
- Automate crew scheduling notifications
- Create a structured data layer that supports financial reporting and business intelligence

### Why It Matters
Lost Boys currently operates with manual estimates, manually created invoices in GoHighLevel, and no systematic connection between what was estimated, what was spent, and what was earned. This system closes that loop — creating a feedback mechanism where every completed job improves future pricing accuracy.

### Primary Design Principles
1. Airtable is the single source of truth — all other systems sync to it
2. Every job has a unique Job ID (format: JOB-1001) that flows through every connected system
3. Automation handles routine tasks; humans review critical decisions (estimate approval, invoice sending)
4. Systems are built MVP-first but clean enough to support future automation
5. Simplicity over complexity — 6-step workflows preferred over 12-step workflows

---

## 3. TECH STACK

| Tool | Role | Integration Status |
|---|---|---|
| **Airtable** | Operational database / source of truth | Active — base being built |
| **GoHighLevel (GHL)** | CRM, proposals, invoicing | Active — manual invoicing currently |
| **Stripe** | Payment processing (via GHL) | Active |
| **Gusto** | Payroll and labor time tracking | Active |
| **Divvy (Bill)** | Field expense cards and job cost tracking | Active |
| **Zapier** | Automation layer | Active — crew scheduling Slack notifications live |
| **Slack** | Crew communication and scheduling | Active |
| **Fillout** | Job intake and pricing forms | Planned |
| **Google Calendar** | Job scheduling | Active — Calendar Event IDs synced |
| **Google Drive** | Document storage | Active |
| **DocuMint** | PDF invoice generation | Planned |
| **Claude Code** | Airtable schema build and automation scripts | Active — used for this build |

---

## 4. AIRTABLE SCHEMA — COMPLETE OVERVIEW

The Airtable base contains 7 tables. Below is the complete schema.

---

### TABLE 1: Clients
**Purpose:** Master record for all contractors and homeowners.
**Primary Field:** Client Name

**Fields:**
- Client Name — Single Line Text (primary)
- Client Type — Single Select: Contractor / Homeowner
- Company Name — Single Line Text
- Contact Name — Single Line Text
- Email — Email
- Phone — Phone Number
- Notes — Long Text
- Address — Single Line Text
- City — Single Line Text
- State — Single Line Text
- Zip — Single Line Text
- Billing Contact Name — Single Line Text
- Billing Email — Email
- Billing Phone — Phone Number
- Billing Notes — Long Text
- Invoice Email Final — Formula: IF({Billing Email}, {Billing Email}, {Email})
- GHL Contact ID — Single Line Text
- GHL Company ID — Single Line Text
- Jobs — Linked Record → Jobs
- Total Jobs — Count of linked Jobs
- Total Revenue — Rollup: SUM of Jobs.Actual Revenue
- Total Profit — Rollup: SUM of Jobs.Actual Profit

---

### TABLE 2: Jobs
**Purpose:** Core operational and financial record for every job.
**Primary Field:** Job ID (Formula: "JOB-" & ({Job Number} + 1000))

#### Section 1 — Job Info
- Job Number — Autonumber
- Job ID — Formula: "JOB-" & ({Job Number} + 1000) [PRIMARY FIELD]
- Job Name — Single Line Text
- Client — Linked Record → Clients
- Client Type Lookup — Lookup from Clients.Client Type
- Invoice Email Lookup — Lookup from Clients.Invoice Email Final
- Engagement Type — Single Select: Contractor Job / Homeowner Direct / Subcontract Work
- Job Type — Single Select: Residential / Commercial
- Job Scope — Multi-Select (19 options — see Section 7: Scope Library for full list)
- Estimator — Single Select: Dane / Jackson
- Crew — Single Select: Crew 1 / Crew 2 / Crew 3 / Crew 4 / Jackson / Other
- Status — Single Select: Lead-Request / Scheduled / In Progress / Completed / Ready for Invoice / Invoiced / Paid / Cancelled
- Start Date — Date
- End Date — Date
- Job Start Time — Single Line Text
- Scope Notes — Long Text (drives invoice description auto-generation)
- Days at Job — Number
- Number of Employees — Number
- Total Number of Dumps — Number

#### Section 2 — Estimate Inputs
- Estimated Labor Hours — Number
- Labor Rate — Currency (default: $26)
- Overhead Rate — Currency (default: $23)
- Estimated Materials — Currency
- Disposal Charge Revenue — Currency (default: $300)
- Disposal Estimated Cost — Currency
- Target Margin Percent — Percent (default: 25%)
- Credit Card Fee Percent — Percent (default: 3%)

#### Section 2 — Estimate Formula Fields
- Estimated Labor Cost = {Estimated Labor Hours} * {Labor Rate}
- Estimated Overhead = {Estimated Labor Hours} * {Overhead Rate}
- Disposal Buffer = {Disposal Charge Revenue} - {Disposal Estimated Cost}
- Estimated Base Cost = {Estimated Labor Cost} + {Estimated Overhead} + {Estimated Materials} + {Disposal Estimated Cost}
- Price Before Fees = IF({Target Margin Percent}, {Estimated Base Cost} / (1 - {Target Margin Percent}), BLANK())
- Final Estimated Price = IF({Credit Card Fee Percent}, {Price Before Fees} / (1 - {Credit Card Fee Percent}), {Price Before Fees})
- Estimated Profit = {Final Estimated Price} - {Estimated Base Cost}
- Estimated Profit Margin = IF({Final Estimated Price}, {Estimated Profit} / {Final Estimated Price}, BLANK()) [format as Percent]

#### Section 3 — Actuals
- Actual Labor Hours — Number
- Actual Materials — Currency
- Actual Disposal Cost — Currency
- Actual Revenue — Currency

#### Section 3 — Actual Formula Fields
- Actual Labor Cost = {Actual Labor Hours} * {Labor Rate}
- Actual Overhead = {Actual Labor Hours} * {Overhead Rate}
- Actual Total Cost = {Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Disposal Cost}
- Actual Profit = {Actual Revenue} - {Actual Total Cost}
- Actual Profit Margin = IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK()) [format as Percent]

#### Section 4 — Variance Formula Fields
- Labor Hour Variance = {Actual Labor Hours} - {Estimated Labor Hours}
- Labor Cost Variance = {Actual Labor Cost} - {Estimated Labor Cost}
- Material Variance = {Actual Materials} - {Estimated Materials}
- Disposal Variance = {Actual Disposal Cost} - {Disposal Estimated Cost}
- Revenue Variance = {Actual Revenue} - {Final Estimated Price}
- Profit Variance = {Actual Profit} - {Estimated Profit}
- Profit Variance Percent = IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK()) [format as Percent]

#### Section 5 — Invoice
- Invoice Amount Override — Currency (manual override for Path B jobs and post-estimate adjustments)
- Invoice Notes — Long Text
- Deposit Required — Checkbox
- Deposit Type — Single Select: Percentage / Fixed Amount
- Deposit Value — Currency
- Deposit Invoice Sent — Checkbox
- Deposit Collected — Checkbox
- Ready for Invoice — Checkbox [ZAPIER TRIGGER — do not check until reviewed]
- Invoice Sent Date — Date
- Payment Date — Date
- Invoice Line Items — Linked Record → Invoice Line Items

#### Section 6 — Change Orders and Expenses
- Change Orders — Linked Record → Change Orders
- Change Order Total — Rollup: SUM of Change Orders.Approved Value
- Expenses — Linked Record → Expenses
- Expense Total — Rollup: SUM of Expenses.Amount

#### Section 7 — Integrations
- GHL Opportunity ID — Single Line Text
- GHL Invoice ID — Single Line Text
- Stripe Payment ID — Single Line Text
- Stripe Payment Link — URL
- Slack Channel ID — Single Line Text
- Slack Thread ID — Single Line Text
- Gusto Project ID — Single Line Text
- Divvy Job Tag — Single Line Text
- Google Calendar Event ID — Single Line Text
- Calendar Sync Status — Single Line Text
- Slack Message Sent — Checkbox

#### Section 8 — Admin
- Estimate Locked — Checkbox
- Internal Notes — Long Text
- Last Updated Source — Single Line Text
- Labor Estimation Method — Single Line Text

---

### TABLE 3: Change Orders
**Purpose:** Capture scope changes, extra work, and recovered revenue.
**Primary Field:** Change Order ID

- Change Order ID — Formula: "CO-" & autonumber
- Job — Linked Record → Jobs
- Description — Long Text
- Source — Single Select: Slack / Admin / Estimator / Client
- Estimated Value — Currency
- Approved Value — Currency
- Status — Single Select: Pending / Approved / Rejected / Invoiced
- Invoice Behavior — Single Select: Add to Final Invoice / Separate Invoice
- Created Date — Created Time
- Approved Date — Date
- Notes — Long Text

---

### TABLE 4: Expenses
**Purpose:** Track all job-level expenses from Divvy and manual entries.
**Primary Field:** Expense ID

- Expense ID — Formula: "EXP-" & autonumber
- Job — Linked Record → Jobs
- Amount — Currency
- Vendor — Single Line Text
- Date — Date
- Category — Single Select: Materials / Disposal / Fuel / Equipment Rental / Subcontractor / Other
- Payment Source — Single Select: Divvy / Manual
- Divvy Transaction ID — Single Line Text
- Receipt URL — URL
- Notes — Long Text

---

### TABLE 5: Pricing Variables
**Purpose:** Centralized control panel for all pricing assumptions. Update here to affect all estimates.
**Primary Field:** Variable Name

- Variable Name — Single Line Text
- Value — Number
- Percent Value — Percent
- Currency Value — Currency
- Description — Long Text
- Active — Checkbox
- Last Updated — Date

**Seeded Records:**
| Variable | Value |
|---|---|
| Labor Rate | $26/hr |
| Overhead Rate | $23/hr |
| Target Margin Percent | 25% |
| Credit Card Fee Percent | 3% |
| Default Disposal Charge | $300 |

---

### TABLE 6: Invoice Line Items
**Purpose:** Individual line items composing each invoice. Auto-generated from Job Scope + Scope Library, fully editable before sending.
**Primary Field:** Line Item Name

- Line Item Name — Single Line Text (primary)
- Job — Linked Record → Jobs
- Scope Library Reference — Linked Record → Scope Library
- Description — Long Text (auto-generated from Scope Library default, fully editable)
- Amount — Currency (pre-filled from estimate, overrideable)
- Quantity — Number (default: 1)
- Sort Order — Number (controls display order on invoice)
- Line Item Type — Single Select: Scope Item / Change Order / Deposit / Materials Reimbursement / Labor / Other
- Invoice Group — Single Select: Deposit Invoice / Final Invoice
- Include on Invoice — Checkbox (default: checked)
- Line Item ID — Autonumber

---

### TABLE 7: Scope Library
**Purpose:** Master library of scope types with default descriptions and estimate inputs. Drives Invoice Line Item auto-generation and provides estimating baselines.
**Primary Field:** Scope Name

- Scope Name — Single Line Text (primary)
- Default Description — Long Text
- Default Labor Hours — Number
- Default Materials Cost — Currency
- Default Dump Count — Number
- Job Type Applicability — Multi-Select: Residential / Commercial
- Active — Checkbox
- Jobs — Linked Record → Jobs

**19 Seeded Records:**
1. Kitchen Demo — 8 hrs / 1 dump
2. Bathroom Demo — 6 hrs / 1 dump
3. Full House Gut — 40 hrs / 4 dumps
4. Flooring Removal — 6 hrs / 1 dump
5. Concrete Demo — 8 hrs / 2 dumps
6. Drywall-Wall Demo — 6 hrs / 1 dump
7. Ceiling Demo — 5 hrs / 1 dump
8. Exterior Demo — 16 hrs / 2 dumps
9. Fireplace Demo — 6 hrs / 1 dump
10. Stair-Trim Demo — 4 hrs / 1 dump
11. Window-Door Removal — 4 hrs / 1 dump
12. Cabinet Removal — 4 hrs / 1 dump
13. Shed-Structure Removal — 6 hrs / 1 dump
14. Deck-Patio Removal — 8 hrs / 1 dump
15. Pool-Water Feature Demo — 16 hrs / 2 dumps
16. Carport Removal — 6 hrs / 1 dump
17. Junk Removal-Cleanout — 4 hrs / 1 dump
18. Construction Debris Hauling — 4 hrs / 1 dump
19. Jobsite Cleanup — 3 hrs / 1 dump

---

## 5. INVOICE WORKFLOWS

### Two Invoice Paths

**Path A — Estimate First (standard jobs)**
1. Job scoped and estimate built in Airtable
2. Job status updated to Completed
3. Invoice Line Items auto-generated from Job Scope selections + Scope Library defaults
4. Amounts pre-filled from Final Estimated Price (allocated across line items)
5. User reviews, edits descriptions, adjusts amounts as needed
6. Ready for Invoice checkbox checked → Zapier triggers GHL invoice creation
7. GHL Invoice ID written back to Jobs record

**Path B — Invoice Only (trusted contractor relationships, no prior estimate)**
1. Job completed without prior estimate
2. Actual Labor Hours pulled from Gusto; Expenses pulled from Divvy
3. Invoice Amount Override entered manually
4. Invoice Line Items created manually or selected from Scope Library
5. Ready for Invoice checkbox checked → Zapier triggers GHL invoice creation

### Invoice Flexibility Requirements
- **Amount override:** Final invoice amount is always manually reviewable and adjustable before sending
- **Multi-line invoices:** Jobs can have multiple line items broken out by scope area
- **Single-line invoices:** Jobs can have one line item with a full description (common for smaller residential jobs)
- **Change orders on same invoice:** Change Order Invoice Behavior = "Add to Final Invoice" adds a CO line item to the job's Invoice Line Items
- **Change orders as separate invoice:** Change Order Invoice Behavior = "Separate Invoice" triggers a standalone GHL invoice
- **Deposit invoices:** When Deposit Required = checked, a Deposit line item (Invoice Group = Deposit Invoice) is generated first. Final invoice held until deposit collected.
- **Auto-generated descriptions:** Scope Notes field drives the default description for each line item, pulled via Scope Library reference. All descriptions are editable before sending.

### Invoice Format Types (from GHL invoice history analysis)
Three formats observed in 176 invoices reviewed:
1. **Single line item + description** — most common, used for smaller jobs
2. **Multi-line itemized** — used for larger or multi-scope jobs (e.g., Tile Demo + Bathroom Demo + Kitchen Demo as separate line items with individual prices)
3. **Base invoice + change order line** — main scope as line 1, change order as line 2 on same invoice

---

## 6. CURRENT BUILD STATUS

### ✅ COMPLETED

**Airtable Base — Tables Created via API (Claude Code):**
- Clients — all non-formula fields created
- Change Orders — all non-formula fields created
- Expenses — all fields created
- Pricing Variables — all fields created + 5 records seeded
- Jobs — 51 fields created (all non-formula types)
- Invoice Line Items — 7 fields created
- Scope Library — 6 fields created + 19 scope records seeded

**Zapier Automations (Pre-Existing):**
- Crew scheduling Slack notifications live and working
- Timezone handling and crew-specific channel routing confirmed working

### 🔄 IN PROGRESS — Manual Setup in Airtable UI

The following fields cannot be created via Airtable API and must be added manually in the Airtable interface. Work through these in the exact order listed.

**IMPORTANT SEQUENCING NOTE:** Complete Step 14 (Clients: Invoice Email Final formula) BEFORE Step 5 (Jobs: Invoice Email Lookup) or the lookup field won't find the source field.

**Recommended Order:**
1. Jobs → Job Number (Autonumber)
2. Jobs → Job ID (Formula: "JOB-" & ({Job Number} + 1000)) → set as primary field
3. Clients → Invoice Email Final (Formula: IF({Billing Email}, {Billing Email}, {Email}))
4. Jobs → Client (Linked Record → Clients, single record)
5. Jobs → Client Type Lookup (Lookup from Clients.Client Type)
6. Jobs → Invoice Email Lookup (Lookup from Clients.Invoice Email Final)
7. Jobs → Change Orders (Linked Record → Change Orders, multiple records)
8. Jobs → Change Order Total (Rollup: SUM of Change Orders.Approved Value)
9. Jobs → Expenses (Linked Record → Expenses, multiple records)
10. Jobs → Expense Total (Rollup: SUM of Expenses.Amount)
11. Jobs → Invoice Line Items (Linked Record → Invoice Line Items, multiple records)
12. Jobs → All 20 formula fields (estimates, actuals, variances — see Section 4 above, enter in dependency order)
13. Invoice Line Items → Job (Linked Record → Jobs, single record)
14. Invoice Line Items → Scope Library Reference (Linked Record → Scope Library, single record)
15. Invoice Line Items → Line Item ID (Autonumber)
16. Scope Library → Jobs (Linked Record → Jobs, multiple records)
17. Clients → Jobs (auto-created when Jobs.Client link is added — verify it exists)
18. Clients → Total Jobs (Count of linked Jobs)
19. Clients → Total Revenue (Rollup: SUM of Jobs.Actual Revenue)
20. Clients → Total Profit (Rollup: SUM of Jobs.Actual Profit)

**After linked records and formulas are complete:**
- Set default values on Jobs fields: Labor Rate ($26), Overhead Rate ($23), Disposal Charge Revenue ($300), Target Margin Percent (25%), Credit Card Fee Percent (3%)
- Set default values on Invoice Line Items: Quantity (1), Include on Invoice (checked)
- Format Estimated Profit Margin, Actual Profit Margin, and Profit Variance Percent as Percent with 1 decimal place

### 📋 UPCOMING TASKS (In Priority Order)

#### Phase 1 — Schema Completion (Current Phase)
- [ ] Complete all manual Airtable UI setup items listed above
- [ ] Run test job record to verify full formula chain calculates correctly end to end
- [ ] Migrate existing job data from old Jobs table (renamed) into new Jobs table
- [ ] Populate Clients table from existing GHL customer data
- [ ] Link existing jobs to client records

#### Phase 2 — Invoice Automation
- [ ] Build Airtable Invoice Review view (filter: Status = Completed AND Ready for Invoice = unchecked)
- [ ] Design Zapier workflow: Ready for Invoice checked → create GHL invoice from Invoice Line Items
- [ ] Map Invoice Line Items fields → GHL invoice line item fields
- [ ] Handle Invoice Group logic (Deposit Invoice vs. Final Invoice) in Zapier
- [ ] Handle Change Order Invoice Behavior logic (Add to Final Invoice vs. Separate Invoice)
- [ ] Test full invoice generation flow on a real job
- [ ] Note: GHL invoice creation via automation is complex — may evaluate alternative invoicing tools if GHL API limitations are prohibitive

#### Phase 3 — Scope Library Integration
- [ ] Build Zapier or Airtable automation: when Job Scope tags are selected on a job → auto-create Invoice Line Item records pre-loaded from Scope Library defaults
- [ ] Test auto-generation of line items on new job creation
- [ ] Refine Scope Library default descriptions and labor hour estimates based on historical job data

#### Phase 4 — Actuals Integration
- [ ] Connect Gusto project hours → Airtable Jobs.Actual Labor Hours (via Zapier)
- [ ] Connect Divvy job-tagged transactions → Airtable Expenses table (via Zapier)
- [ ] Requires: Gusto Project ID on each job, consistent Divvy job tagging by crew

#### Phase 5 — Fillout Intake Form
- [ ] Build Fillout form for job intake that creates new Jobs records in Airtable
- [ ] Pre-populate Labor Rate, Overhead Rate, and other defaults from Pricing Variables table
- [ ] Include Job Scope multi-select tied to Scope Library

#### Phase 6 — Reporting and Dashboards
- [ ] Build Airtable views: Invoice Queue, Jobs by Crew, Open Change Orders, Expense by Job
- [ ] Build financial dashboard: Revenue vs. Estimate, Gross Margin by Job Type, Labor Efficiency by Crew
- [ ] Quarterly Pricing Variables review process (update Labor Rate and Overhead Rate from Gusto actuals)

#### Phase 7 — Enhancements (Post-MVP)
- [ ] Margin Alert formula field: flag jobs priced below target margin (red/yellow/green indicator)
- [ ] Crew performance tracking: revenue, hours, and profit margin by crew leader
- [ ] Disposal cost modeling: Total Number of Dumps × average dump cost replacing flat estimate
- [ ] Scope Library default hour estimates refined by job type (Residential vs. Commercial)
- [ ] Evaluate alternative invoicing tool if GHL automation proves too limited

---

## 7. KEY DECISIONS AND DESIGN RATIONALE

**Why Airtable as source of truth (not GHL)?**
GHL is excellent for client-facing CRM and invoicing but has limited API support for automated invoice creation. Airtable provides the structured relational database needed for job costing, formula calculations, and multi-system data aggregation that GHL cannot handle natively.

**Why a Scope Library table (not just multi-select tags)?**
Job Scope tags alone give you categorization. The Scope Library gives each tag a default description, labor hour estimate, and dump count — turning a tag into a starting estimate. This standardizes invoice language and dramatically speeds up the estimating process. It's also the foundation for future job templates.

**Why Invoice Amount Override instead of locking to Final Estimated Price?**
Two invoice paths exist: (A) jobs with prior estimates, and (B) trusted contractor jobs invoiced at completion without estimates. Path B requires a manual amount entry. Additionally, even estimate-based jobs sometimes require price adjustments before sending. The override field handles both without disrupting the formula chain.

**Why Keep Change Order Invoice Behavior flexible?**
Historical invoice data shows both patterns in use — some change orders on the original invoice (Scott's Interior Demo: $11,700 + $3,000 CO), some as separate invoices. Forcing one pattern would break existing client relationships. The Invoice Behavior field on Change Orders controls this per-job.

**Why not build formula fields via API?**
Airtable's Metadata API does not support creating formula fields, rollup fields, lookup fields, linked record fields, autonumber fields, or created time fields. All of these must be created manually in the Airtable UI. The Claude Code script handles all supported field types and outputs a precise checklist for the rest.

---

## 8. IMPORTANT CONTEXT FOR AI AGENT

**Working with Claude Code:**
- Project files live at: `/Users/mattrisenmay/lostboysdemolition/`
- Schema overview file: `/Users/mattrisenmay/lostboysdemolition/schema_overview.md`
- Always read schema_overview.md at the start of each Claude Code session for full context
- Scripts should be idempotent: skip if exists, never duplicate
- Use 250ms delay between Airtable API calls to prevent rate limiting
- Environment variables: AIRTABLE_API_KEY and AIRTABLE_BASE_ID (never hardcode)
- Node.js preferred unless Python is clearly better for the task

**Airtable API Limitations (important):**
The following field types CANNOT be created via Airtable's Metadata API and require manual UI setup:
- Formula fields
- Rollup fields
- Lookup fields
- Linked record fields
- Autonumber fields
- Created time fields
Always log these as "MANUAL SETUP REQUIRED" with exact instructions when encountered in scripts.

**Zapier Integration Notes:**
- Existing Zapier automations are live — do not modify without understanding current workflows
- Slack crew scheduling notification is working and timezone-handled correctly
- New Zapier workflows should be additive, not replacing existing ones
- Key trigger to build: Jobs.Ready for Invoice = checked → create GHL invoice

**GHL Invoice Creation Note:**
Manual invoice creation is the current process in GHL. Automated invoice creation via GHL API is technically complex and may have limitations. This is flagged for evaluation — an alternative invoicing tool (potentially DocuMint for PDF generation + Stripe for payment) may be considered if GHL automation proves insufficient.

**Financial Context:**
- Do not use "10 and 10" markup rule — it does not apply to specialty contractors
- Overhead allocation should be 15–25% of revenue (currently modeled at ~29% of labor)
- Labor rate ($26) and overhead rate ($23) should be reviewed quarterly against Gusto payroll actuals
- True all-in labor cost is $27–$29/hr when employer taxes are fully loaded — monitor for underestimation risk

---

## 9. FILES IN PROJECT FOLDER

| File | Purpose |
|---|---|
| schema_overview.md | Complete Airtable schema reference — read at start of every Claude Code session |
| jobs_schema_prompt.txt | Claude Code prompt used to build Jobs, Invoice Line Items, and Scope Library tables |
| setup_airtable.js | Node.js script that built the initial 4 tables (Clients, Change Orders, Expenses, Pricing Variables) |
| .env | API credentials — never share or commit to version control |
| .env.example | Template for environment variables |

---

*This document is the master project brief for the Lost Boys Demolition Pricing Engine build. Update it as phases are completed and decisions are made. It is intended to provide complete context to any AI agent, developer, or team member onboarding to this project.*
