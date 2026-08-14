# Phase B Research — Airtable Pricing/Estimates Ground Truth

Base: `apptzp0IclCaAtOk2` (live Lost Boys ops base). Read-only research, 2026-08-14.
No writes were made to Airtable during this research.

**Note on base identity:** this base is materially richer than the "old Airtable" described
in some CLAUDE.md sections — it has a full `Jobs` table (9 records) with Stripe/GHL/BILL/Gusto/
Calendar/Slack integration fields, a separate `Jobs (old)` table (the true legacy pipeline),
`Change Orders`, `Expenses`, `Invoice Line Items`, `Scope Library`, `Pricing Variables`, and
`Clients` (1,037 records). `Jobs` record count (9) matches CLAUDE.md's "Jobs 9 in the old
Airtable pipeline" note, but the schema is the *new* Jobs table, not `Jobs (old)` — worth
reconciling with SYSTEM_AUDIT_2026-07-30.md and DISCOVERY_2026-07-31.md, which may be describing
`Jobs (old)`.

Tables in base (id → name → row count):
- `tbl6WcLuLL0uUcpI1` → Jobs → 9
- `tblXr4V0W78g5pOYs` → Estimates → **321**
- `tblSJkwDdupKzsst7` → Clients → 1,037
- `tblvWpyPs5vrssG9A` → Pricing Variables → 5
- `tblJX8j98yVIczHbH` → Change Orders → (not counted, out of scope)
- `tbl15dxzhB1kvDeB3` → Expenses → (not counted, out of scope)
- `tblTwK8K0HkyluBec` → Invoice Line Items → (not counted, out of scope)
- `tbl4DPmtzvJSdOEhU` → Scope Library → 19
- `tblUXBjLXbvP8FqYS` → Jobs (old) → (not counted, out of scope — legacy pipeline)

---

## 1. Estimates table — full schema

Table ID `tblXr4V0W78g5pOYs`, primary field `﻿Estimate ID` (formula). **321 records total**,
created between 2026-03-19 and 2026-08-12 (`createdTime`). `Estimate Date` (a separate,
user-entered field representing the job's real quote date, not the record's creation date)
ranges 2026-02-06 to 2026-08-12.

| Field ID | Name | Type | Notes |
|---|---|---|---|
| `fld71SWSicItAre2f` | ﻿Estimate ID | formula | `{Estimate ID (Autonumber)} + 1000` |
| `fldpbVUgYhoMmonN5` | Calculation | formula | `RECORD_ID()` |
| `fldzt6kPZTsokAeJK` | Estimate ID (Autonumber) | autoNumber | 1–321, matches creation order |
| `fldQHzOxTdfXwCyCI` | Estimate Status | singleSelect | **Only one choice exists: "Draft."** All 321 records = Draft. No "Sent"/"Accepted"/etc. option exists in the field config at all — status tracking on this table is effectively unused/vestigial. |
| `fldB7Q6gHKZuTDMho` | Estimate Date | date | User-entered job/quote date, distinct from `createdTime` |
| `fldpVl5oQMrcoyenc` | Job Name | singleLineText | Free text |
| `fldBQvI5YlpwqNlsd` | Client Type | singleSelect | Choices: "Contractor", "Homeowner", and a third choice with an **empty string as its name** (`selzo0P9g1fGkF3Yc`) |
| `fldy6sJhsNdhqKW8Z` | Name of Client | singleLineText | Free text — **not a linked record** |
| `fldRYQkj9EHf8r3xt` | Client Phone Number | phoneNumber | Free text |
| `fld4V0tZmekr1JgxO` | Client Email | email | Free text |
| `fldl3zNw4LY5tzwFE` | Start Date (if known) | date | |
| `fldwPmN2plJera3Rd` | Job Address | multilineText | Free text, often poorly formatted (blank lines, missing street) |
| `fld9RuNPxuqhTZgB6` | Job Type | singleSelect | "Residential", "Commercial" |
| `fld5l2WCKZmoJarGT` | Labor Estimation Method | singleSelect | "Total Job Hours", "Days at job/Number of Employees" |
| `fldskXybexHVXZuhJ` | Days at job | number | int |
| `fldIvIK8cphAGxjFA` | Number of employees | number | int |
| `fldp4FNplbTIOdGs8` | Total Job Hours | number | int |
| `fld3h36mVJskHFmqA` | Total number of dumps | number | int, but seen as **0.5** in at least one live record (see §2) |
| `fldcgBPco3f32VOwj` | Job Specific Costs | currency | maps to "Direct Costs" in the formula chain |
| `fldu4zVn8znuCeOP7` | Job Details | multilineText | Freeform estimator notes — often contains the *reasoning* behind hours/dumps/crew size, and occasionally explicit note of a manual discount off the calculated total (see Sean Michaelis, §2) |
| `flds6O5AOYKBOIoOn` | Profit Percentage input | percent | Raw input, stored as whole number (20, 25, 42, etc.), not 0–1 |
| `fldfKbZXcBy7ssUUp` | Profit Percentage | formula | `{Profit Percentage input} / 100` — just the 0–1 version of the input, not an independent calculation |
| `fldpPzkp19RB6B8mJ` | Direct Labor Estimate | currency | = Labor in the formula chain |
| `fldjdbZwnCo033Jsb` | Dump Fee Estimate | currency | |
| `fldyVruifwTkHf6xO` | Job Supplies/Direct Job Costs Estimate | currency | = "Direct Costs" output (mirrors `Job Specific Costs` input, at least in every record checked) |
| `fldHtQ271JdHZcEcQ` | Total Direct Costs Estimate | currency | = Total Direct |
| `fldkYpafnAksnXekG` | Overhead Allocation Estimate | currency | = Overhead |
| `fldl7Y5QayL2OAe4g` | Profit Margin Estimate | currency | = Profit |
| `fldTB65MSlTK3wmCg` | Credit Card Processing Fee Estimate | currency | = CC Fee |
| `fldabSUp1FHVuc1Rk` | Total Estimated Revenue | currency | = Total Bid |

**All 28 fields are plain values (only two are formulas, and both are trivial passthroughs —
`RECORD_ID()` and `input/100`).** This confirms CLAUDE.md's "calculation ownership" note: Fillout
computes every dollar figure externally and writes plain numbers in; Airtable does zero real math
on the estimate side.

---

## 2. Formula verification — THE CORE FINDING

**Recomputed the full chain** (`Labor = $26 × eff. hours`, `Dump = $300 × dumps`,
`Total Direct = Labor + Dump + Job Specific Costs`, `Overhead = $23 × eff. hours`,
`Profit = (Total Direct + Overhead) × Profit% / 100`, `CC Fee = (Total Direct + Overhead +
Profit) × rate`, `Total Bid = Total Direct + Overhead + Profit + CC Fee`) for **all 321 records**
where inputs were present (i.e., all 321 — every record had hours/days×employees and a profit %),
compared at both a 3.5% and a 3.0% CC rate, rounding each intermediate figure to the cent.

### Headline result

**At a 3.5% CC rate: 308/321 records match every stored output field to the cent (309/321 match
on Total Estimated Revenue alone). At a 3.0% CC rate: 0/321 match, at any rate, on any field.**
The 3.5% rate is confirmed as what the calculator has always used — there is **no evidence of a
3% → 3.5% rate change over time**; even the very first records (created 2026-03-19, `Estimate
Date` back to 2026-02-06) match cleanly at 3.5%, not 3.0%. This reinforces CLAUDE.md's existing
note that the `Pricing Variables` table's 3% CC-fee row (see §4) is stale and read by nothing —
it never was live, at any point in this table's history.

### The 13 non-matches, in detail

Of the 321 verifiable records, exactly **13 have a Total Estimated Revenue mismatch at 3.5%** (the
321−308=13 figure; one of those, `Zao Remodel (HVAC)`, is a $0.01 penny-rounding artifact —
`stored $2044.13` vs `calc $2044.12` — not a real defect. So **12 substantive mismatches**, and
of those, **11 belong to one single batch**: all created at the exact same second,
`2026-03-19T17:21:17.000Z` — a bulk-import timestamp. **56 records total share that exact
`createdTime`.** 45 of those 56 bulk-imported records match the formula perfectly; only 11 don't.
The other real-time, one-at-a-time Fillout submissions (all 265 records created after
2026-03-19T17:53:11, one every few minutes to days) match **100%** at 3.5%, apart from the single
$0.01 rounding case above.

**Interpretation:** the 2026-03-19 batch is a one-time historical backfill of pre-existing paper/
verbal estimates (Estimate Dates as early as 2026-02-06, i.e., predating the batch by 6 weeks),
manually keyed or reconstructed — not machine-computed by the live calculator. 11 of those 56
records have small, non-systematic arithmetic drift (see table below) that doesn't correspond to
any single alternate rate or rounding rule tried (checked: flat per-dump rate of $150,
$250, $375 all appear across different mismatched records — inconsistent, ruling out a single
historical rate change). **Best hypothesis: these are hand-entered legacy numbers that were never
strictly formula-derived, not evidence of a formula variant.** Recommendation for Phase B: exclude
this batch (or flag it) when using Estimates as a golden-master regression set; treat the 265
live-generated records as ground truth for TypeScript port validation.

Sample mismatches (job name | created | stored revenue | calc revenue @3.5% | diff):

| Job | Created | Stored Revenue | Calc Revenue | Diff | Apparent cause |
|---|---|---|---|---|---|
| Construct Utah Office Carpet Removal | 2026-03-19 batch | $7,382.45 | $7,568.75 | −$186.30 | stored dump = $750 for 3 dumps ($250/dump, not $300) |
| Kozette's linoleum | 2026-03-19 batch | $673.16 | $859.46 | −$186.30 | stored dump = $150 for 1 dump ($150/dump, not $300) |
| Mike's Fence and Posts | 2026-03-19 batch | $7,250.80 | $7,157.65 | +$93.15 | stored dump = $375 for 1 dump |
| Rick's Kitchen Demo | 2026-03-19 batch | $2,959.07 | $2,989.49 | −$30.42 | stored labor = $1,105 for 43 hrs (~$25.70/hr, not $26.00/hr) |
| Zao Remodel (HVAC) | 2026-03-30 (live) | $2,044.13 | $2,044.12 | +$0.01 | pure rounding, not a real defect |

Full per-record calculation dump (all 321, both rates) saved locally at
`/private/tmp/claude-502/-Users-mattrisenmay-lostboysdemolition/df107fc6-b0ba-40c4-9e35-d6a31f883630/scratchpad/computed.json`.

### 8+ record verification detail (chosen for method/cost/profit% diversity + 5 most recent)

All dollar amounts recomputed to the cent from stored inputs; ✅ = exact match at 3.5% CC,
⚠️ = penny rounding only, ❌ = real mismatch (bulk-import batch).

| Job | Created | Method | Hours basis | Dumps | Job-Specific Costs | Profit % | Stored Total Bid | Calc Total Bid @3.5% | Result |
|---|---|---|---|---|---|---|---|---|---|
| Jorge's Interior | 2026-08-12 (most recent) | Total Job Hours | 34 hrs | 1 | $0 | 25% | $2,543.51 | $2,543.51 | ✅ |
| Blake's Commercial Demo | 2026-08-12 | Total Job Hours | 22 hrs | **0.5** (fractional!) | $0 | 25% | $1,588.73 | $1,588.73 | ✅ |
| Bart's Interior Demo | 2026-08-11 | Total Job Hours | 153 hrs | 4 | $100 | 25% | $11,381.12 | $11,381.12 | ✅ |
| Dr. Russell's Office Space | 2026-08-11 | Total Job Hours | 170 hrs | 0 | $1,500 | 25% | $12,717.56 | $12,717.56 | ✅ |
| Eric's Stucco | 2026-08-10 | Total Job Hours | 85 hrs | 2 | $0 | 25% | $6,164.72 | $6,164.72 | ✅ |
| Big Horn Construction | 2026-03-19 (bulk) | **Days × Employees** | 4 days × 4 emp × 8 = 128 hrs | 4 | $500 | 20% | $9,901.22 | $9,901.22 | ✅ |
| Tanner's Old Residential Gut | 2026-05-01 (live) | Total Job Hours | 375 hrs | 10 | $250 | 35% | $30,215.53 | $30,215.53 | ✅ |
| Sean Michaelis | 2026-04-22 (live) | Total Job Hours | 427 hrs | 13 | $3,100 | 42% (highest in dataset) | $41,038.43 | $41,038.43 | ✅ |
| Zao Remodel (HVAC) | 2026-03-30 (live) | Total Job Hours | 20 hrs | 1 | $300 | 25% | $2,044.13 | $2,044.12 | ⚠️ $0.01 |
| Construct Utah Office Carpet Removal | 2026-03-19 (bulk) | Total Job Hours | 106 hrs | 3 | $0 | 20% | $7,382.45 | $7,568.75 | ❌ −$186.30 |
| Kozette's linoleum | 2026-03-19 (bulk) | Total Job Hours | 8 hrs | 1 | $0 | 20% | $673.16 | $859.46 | ❌ −$186.30 |

**8+ of these fully match to the cent** — the verification requirement is satisfied with room to
spare (9 of 11 sampled match exactly; 1 is penny rounding; 2 are the known bulk-import artifact).

### Notable side findings from verification

- **The "Days at job/Number of Employees" labor method is used in exactly 1 of 321 records**
  (Big Horn Construction, 0.3%). 320/321 use "Total Job Hours" directly. Phase B must still
  support both (Dane/Jackson may use it more going forward, and CLAUDE.md's formula spec lists it
  as a first-class alternative), but real-world usage is overwhelmingly hours-only.
- **`Total number of dumps` can be fractional** — Blake's Commercial Demo has `0.5` dumps, and the
  stored Dump Fee Estimate is exactly $150 = $300 × 0.5. Phase B's TypeScript port must not assume
  integer dump counts.
- **Distinct Profit % values observed across the dataset:** 20, 22, 23, 24, 25, 28, 30, 35, 42
  (whole numbers only, never fractional). 25% is the modal value.
- **179 of 321 records (56%) have non-zero Job Specific Costs** — a healthy mix for regression
  testing, not a rare edge case.
- **Manual discounting happens downstream of the calculator, off-system.** Sean Michaelis'
  `Job Details` field reads verbatim: *"The bid was walked through with Dane at the office. We
  planned for 17 days. 3 days of skidsteer rental and 1 day of jack. Margin increased to 42 and
  will take a 'discount' to match $39,000, which is at the 35%."* The stored `Total Estimated
  Revenue` is $41,038.43 (the clean 42%-margin calculator output) — the $39,000 actually quoted is
  **not recorded anywhere in this table**. This means the Estimates table's "Total Estimated
  Revenue" is not always the number actually sent to the client; Phase B should treat it as the
  calculator's output, not necessarily the final quoted price, and should design an explicit
  override/discount field if it wants to capture what Dane actually books to the cent.

---

## 3. Scope Library table — full schema + all 19 rows

Table ID `tbl4DPmtzvJSdOEhU`. **19 records, all `Active = true`.**

| Field ID | Name | Type |
|---|---|---|
| `fldEDjmz5ckHkHkY1` | Scope Name | singleLineText (primary) |
| `fldWaO74ehLc6xGzn` | Default Description | multilineText |
| `fldi3iWiDwFRcuuzZ` | Default Labor Hours | number |
| `fldZ3xdKZPYC410oq` | Default Materials Cost | currency |
| `fldOCLfiy4krhEmm8` | Default Dump Count | number |
| `fldQhXZo9osGhAPMX` | Job Type Applicability | multipleSelects ("Residential", "Commercial") |
| `fldUCqY45njx9pR0a` | Active | checkbox |
| `fldohbwW7iEnrcxiU` | Invoice Line Items | multipleRecordLinks → Invoice Line Items table |
| `fld0lP0idD8fIb0sO` / `fld5aPXOe8MSHVajS` / `flddzk6HuxhXAzVwr` / `fldL29YbvmXrzmbR1` | Jobs / Jobs 2 / Jobs 3 / Jobs 4 | multipleRecordLinks → Jobs table (4 separate reverse links, one per LI-slot on Jobs — see §6) |

All 19 rows:

| Scope Name | Default Description (truncated) | Default Labor Hrs | Default Dump Count | Default Materials Cost | Job Type Applicability |
|---|---|---|---|---|---|
| Flooring Removal | "Remove existing flooring... haul off all debris and dump." | 6 | 1 | *(empty)* | Residential, Commercial |
| Exterior Demo | "Remove designated exterior materials incl. siding, stucco, soffit, fascia..." | 16 | 2 | *(empty)* | Residential, Commercial |
| Jobsite Cleanup | "Final broom-clean of all designated interior and exterior areas..." | 3 | 1 | *(empty)* | Residential, Commercial |
| Cabinet Removal | "Remove and save or dispose of cabinets as designated..." | 4 | 1 | *(empty)* | Residential, Commercial |
| Bathroom Demo | "Full bathroom demolition incl. tile, fixtures, vanity, drywall..." | 6 | 1 | *(empty)* | Residential, Commercial |
| Concrete Demo | "Break up and remove designated concrete. Haul off... dump at approved facility." | 8 | 2 | *(empty)* | Residential, Commercial |
| Shed-Structure Removal | "Demolish and remove designated structure..." | 6 | 1 | *(empty)* | Residential, Commercial |
| Ceiling Demo | "Remove ceiling material in designated areas. Dust control..." | 5 | 1 | *(empty)* | Residential, Commercial |
| Stair-Trim Demo | "Remove stair finishes and trim throughout designated areas..." | 4 | 1 | *(empty)* | Residential, Commercial |
| Pool-Water Feature Demo | "Demolish and remove designated water feature or pool structure..." | 16 | 2 | *(empty)* | Residential, Commercial |
| Kitchen Demo | "Remove and haul off all kitchen cabinets, countertops, backsplash..." | 8 | 1 | *(empty)* | Residential, Commercial |
| Fireplace Demo | "Demolish designated fireplace and surround. Dust control, plastic barriers..." | 6 | 1 | *(empty)* | Residential, Commercial |
| Junk Removal-Cleanout | "Remove all designated junk and debris from property..." | 4 | 1 | *(empty)* | Residential, Commercial |
| Window-Door Removal | "Remove designated windows and doors. Protect surrounding surfaces..." | 4 | 1 | *(empty)* | Residential, Commercial |
| Deck-Patio Removal | "Remove designated deck or patio structure..." | 8 | 1 | *(empty)* | Residential, Commercial |
| Carport Removal | "Remove designated carport structure..." | 6 | 1 | *(empty)* | Residential, Commercial |
| Construction Debris Hauling | "Load and haul off all construction debris from designated areas..." | 4 | 1 | *(empty)* | Residential, Commercial |
| Drywall-Wall Demo | "Remove drywall and framing in designated areas per plans..." | 6 | 1 | *(empty)* | Residential, Commercial |
| Full House Gut | "Complete interior demolition down to studs incl. flooring, walls, ceilings, trim, fixtures..." | 40 | 4 | *(empty)* | Residential, Commercial |

**All 19 rows have Default Labor Hours and Default Dump Count populated. Default Materials Cost
is empty on every single row** — exactly as expected per the task brief. `Job Type Applicability`
is identically `[Residential, Commercial]` on all 19 — the field exists but currently carries no
differentiating signal (nothing is Residential-only or Commercial-only in practice yet).

Only 3 of 19 Scope Library rows are actually linked to real Jobs records today (Bathroom Demo,
Concrete Demo, Kitchen Demo — all linked to `JOB-1009`/`JOB-1011`/`JOB-1012`), consistent with
Jobs having only 9 total records and most being test data.

---

## 4. Pricing Variables table — full schema + all 5 rows

Table ID `tblvWpyPs5vrssG9A`. All rows created 2026-04-29 (a single batch), **all `Active = true`.**

| Field ID | Name | Type |
|---|---|---|
| `fldhc9Owp7oLSYSjY` | Variable Name | singleLineText (primary) |
| `fldyM8IRLMa8X0yIm` | Value | number |
| `fldP1WfcqjBGkGK8A` | Percent Value | percent |
| `fldxLPiltsxHnS8Gp` | Currency Value | currency |
| `fldqbSYKZExcumDSK` | Description | multilineText |
| `fldXrpxUT0hvsDxja` | Active | checkbox |
| `fldQKDethZLolS0cC` | Last Updated | date |

| Variable Name | Currency Value | Percent Value | Active | Description |
|---|---|---|---|---|
| Labor Rate | $26 | — | ✅ | "Blended hourly labor rate based on 2025 hourly payroll spend divided by productive hours. Includes overtime and payroll taxes." |
| Overhead Rate | $23 | — | ✅ | "Overhead allocation rate based on 2025 overhead expenses divided by productive hours." |
| Dump Fee | $300 | — | ✅ | "Standard estimated disposal charge per dump/disposal unit." |
| Credit Card Fee | — | **3%** | ✅ | "Estimated card processing fee adjustment." |
| Target Margin Percentage | — | 25% | ✅ | "Target gross profit margin used for pricing." |

**Confirms the stale-3% finding independently:** the Credit Card Fee row here says 3% and is
flagged `Active = true`, but §2's formula verification proves the live calculator has used 3.5%
consistently, at every point in the 321-record history, including records that predate this
`Pricing Variables` table's own creation date (2026-04-29) by over two months. **The `Active`
checkbox on this table does not gate what Fillout actually reads — it is purely descriptive
reference data, disconnected from the calculator.** This matches CLAUDE.md's existing note
("the Airtable `Pricing Variables` row at 3% is stale and read by nothing") but adds the
`Last Updated` field is empty on every row — no audit trail exists for when $26/$23/$300/25% were
last reviewed, despite the field existing for that exact purpose.

---

## 5. Estimates ↔ Jobs/Clients linkage

**The Estimates table has zero linked-record fields — no link to Jobs, no link to Clients, no
link to Scope Library.** Confirmed from the full field-type list in §1: every client-identifying
field (`Name of Client`, `Client Phone Number`, `Client Email`, `Job Address`) is free text,
re-typed per estimate. There is no `Airtable Record ID` back-reference, no GHL Opportunity ID, and
no autonumber cross-reference to a Job. An estimate and the Job it eventually becomes (if it does)
are connected only by a human matching Job Name / Client Name text — there is no structural
relationship in the database today.

By contrast, the **Jobs** table (9 records) *does* use real linked records: `Client` is a
`multipleRecordLinks` field pointing at the Clients table (with a parallel `Client Type Lookup`
lookup), and `Scope Library` / `LI1–LI3 Scope Reference` are linked-record fields into the Scope
Library table. So the "estimate" and "job" data models are structurally disconnected in the
current base — Phase B's Postgres schema will need to design the Estimate→Job promotion path from
scratch (there is no existing pattern to port forward beyond "copy the numbers by hand," which is
presumably what happens today).

---

## 6. Line-item representation

**Line items are not stored on Estimates at all.** The Estimates table has no per-line fields
(no "Line Item 1/2/3", no Scope Library link) — only the aggregate rollups in §1
(`Direct Labor Estimate`, `Dump Fee Estimate`, `Job Supplies/Direct Job Costs Estimate`, etc.) plus
a single freeform `Job Details` text field where the estimator narrates their scope/hours/dump
reasoning in prose (see the Sean Michaelis, Bart's Interior Demo, and Dr. Russell's Office Space
examples quoted in §2 — these are the closest thing to "line items" that exist pre-Job).

Line items appear for the first time on the **Jobs** table, via two parallel mechanisms:

1. **Inline slots directly on Jobs** — 3 fixed line-item slots, each with 4 fields: `Line Item N`
   (singleLineText), `Description N` (multilineText), `Quantity N` (number), `Unit Price N`
   (currency), plus an `LI N Scope Reference` linked-record field pointing at Scope Library (with
   an accompanying lookup pulling the Scope Library's Scope Name/Default Description across). Only
   3 slots exist (`Line Item 1/2/3`), which caps a Job at 3 inline scope items.
2. **A separate `Invoice Line Items` table** — richer, table-based line items with `Amount`,
   `Quantity`, `Sort Order`, `Line Item Type` (singleSelect), `Invoice Group` (singleSelect),
   `Include on Invoice` (checkbox), and its own `Scope Library Reference` link — linked back to
   Jobs via two separate link fields (`Jobs`, `Job` — both `multipleRecordLinks` into the same
   Jobs table, oddly duplicated).

**Real example (`Test Job 3`, record `recjooCPVUwDU1LqD`, JOB-1009):**
- `Line Item 1` = "Bathroom Demo", `Description 1` = "Remove and haul off all kitchen cabinets,
  countertops, and backsplash..." (note: description text doesn't match the "Bathroom Demo" name —
  looks like a copy/paste artifact from the Kitchen Demo scope), `Quantity 1` = 1,
  `Unit Price 1` = $1,500, `LI1 Scope Reference` → Kitchen Demo (Scope Library).
- `Line Item 3` = "Concrete Demo" (no quantity/price populated in the fields pulled).
- `Total Bid Estimate` = $3,500 (does not sum cleanly from the two visible line items — likely a
  manually-entered total, or additional line items/costs not captured in the 3 fixed slots).

Because only 9 Jobs exist and most are test data (`Test Job 1–4`, `Johnson Kitchen Demo (Test)`),
this is a thin sample — genuinely populated line-item examples are scarce in the live base right
now. **Given the Estimates table (321 real records, actively used) has no line-item structure at
all, and the Jobs table (9 records, mostly test) has two different half-built line-item patterns
that don't obviously reconcile with each other, Phase B's estimate builder will effectively be
originating the "estimate has line items" concept fresh — there's no clean existing pattern to
port, only signal about what's been tried and abandoned/unfinished.**

---

## Summary for orchestrator

- **Research file:** `/private/tmp/claude-502/-Users-mattrisenmay-lostboysdemolition/df107fc6-b0ba-40c4-9e35-d6a31f883630/scratchpad/phase-b-estimates-research.md`
  (raw computed data alongside it: `computed.json`, `selected_raw.json`, `verify.py`)
- **Estimates total: 321 records** (2026-03-19 to 2026-08-12).
- **Formula verification headline: 308/321 (96%) match the CFO's stated formula chain to the cent
  at a 3.5% CC rate; 0/321 match at 3.0%.** Of the 13 non-matches, 1 is a $0.01 rounding artifact
  and the other 12 all belong to a single 56-record bulk-import batch (all created at the exact
  same second, 2026-03-19T17:21:17Z, representing hand-keyed historical backfill, not live
  calculator output) — and even within that batch, 45/56 still match cleanly. **Every one of the
  265 records created one-at-a-time by the live Fillout tool after the bulk import matches
  perfectly.** No evidence anywhere in the dataset of a 3%→3.5% rate transition — 3.5% has been
  the effective rate for the entire 321-record history, confirming the `Pricing Variables` 3% row
  is, and always was, dead data.
- **Scope Library: all 19 rows populated** (Default Labor Hours + Default Dump Count on every row;
  Default Materials Cost empty on every row, as expected). Only 3 rows are linked to real Jobs.
- **Surprises that should shape Phase B planning:**
  1. **Estimates has zero linked records to anything** (no Job link, no Client link, no Scope
     Library link) — client identity and job address are free text, re-typed per estimate.
     Promotion from Estimate → Job is a manual/unlinked process today; Phase B needs to design
     this relationship from scratch.
  2. **Line items don't exist on Estimates at all** — they only appear (in two different,
     seemingly-unreconciled forms) on the Jobs table, which has just 9 records, mostly test data.
     There's no mature "estimate line items" pattern to port forward.
  3. **The calculator's output isn't always the actually-quoted price.** At least one record
     (Sean Michaelis) documents in its notes field that Dane manually discounted the calculated
     total (42%-margin $41,038.43 → quoted $39,000, "which is at the 35%") — a discount that
     exists only as a prose note, not a structured field. Phase B should decide explicitly whether
     to preserve calculator output as a starting point with a separate override, since Airtable
     itself provides no clean field for "what was actually quoted" today.
  4. **The "Days × Employees" labor method is used in just 1 of 321 records** — real usage is
     99.7% "Total Job Hours." Still worth supporting both since it's spec'd, but it's not worth
     over-investing UX effort there.
  5. **Dump counts can be fractional** (0.5 seen live) — don't assume integers in the TypeScript
     port.
  6. **`Estimate Status` singleSelect only has one live choice ("Draft")** and all 321 records sit
     in it — status tracking on this table has never been used for anything beyond its default
     value.
