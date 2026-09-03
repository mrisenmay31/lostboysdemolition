# Estimate Builder Redesign — design spec (approved by Matt 2026-09-02, Session 17)

> **Status: APPROVED.** Matt approved the revision-1 mockup and this design in Session 17 and ruled the build
> starts at the opening of Session 18. Implementation plan: `docs/superpowers/plans/2026-09-02-estimate-builder-redesign.md`.
> Approved mockup (interactive, live cost-plus total): https://claude.ai/code/artifact/3908bf51-612a-46e7-af81-70ca8315532b
> — preserved in-repo as `docs/prototypes/2026-09-02-estimate-builder-approved.html`. The three explored flows are kept
> (`docs/prototypes/2026-09-02-estimate-flow-{a,b,c}-*.html`; artifacts c83b0e4b…, b5e92222…, 692e7f53…).

## 1. Why

The Session 16 checkpoint found 0 real app estimates against 64 real Fillout estimates since 2026-07-31. Matt's
diagnosis: the builder "looks clunky and basic". His rulings: aesthetics driven, **mobile-first** (used mainly from a
phone), match the Job Dashboard's look, full rethink of fields, whole estimates section plus the app shell. The
profitability dashboard is the product; the builder is the front door every real number walks through.

## 2. Rulings that shape the design (all Matt, 2026-09-02)

| Topic | Ruling |
|---|---|
| Look | The dashboard **prototype's** ink/orange system (not the shipped gray `/jobs`), applied app-wide as swappable tokens; logo + palette are placeholders. `/jobs` is re-skinned in the same pass, styling only. |
| Scope | New/revise builder + estimates list + estimate detail + shell alignment. |
| Structure | Full rethink, incl. fields. Chosen flow: **Flow C (stepped)** with Matt's step order. |
| Bid moment | Mixed: some priced on the spot, some sent later as a written estimate. |
| Customer document | **GHL estimate document, itemized scope lines with prices.** The line prices are broken out of the total bid and each is editable. |
| Scope ↔ hours | Scope names the customer lines; **hours and dumps are entered once** at job level. |
| Costs | One **"Other job costs"** field with a tap-to-expand breakdown (materials / rentals / subcontractors / other direct). Expected dump cost and expected processing cost are computed silently. |
| Profit | Label **"Profit margin"**, chips 20 / 25 / 30 / 35 + Other…, with the realized **true margin** shown beside the total. Prices unchanged. |
| Dates | Estimate date (default today) + start date if known, on the Job step. |
| Drafts | **"Save as draft" on every step**, stored **server-side** in an editable drafts table, promoted to a real (immutable) estimate on finish. |
| Identity | Picker stays Dane / Jackson / Matt. **Owner auth goes dormant** (flag) so Dane and Jackson see everything. |
| Post-mockup changes | No dumps subtext. On Review, editing a line price **moves the total bid** to the new line sum. |

## 3. The flow

Four steps, one screen each, a progress bar per step (done / current / to do), Back / Next at the bottom, and
**Save as draft** available from every step.

### Step 1 — Job
Job name (required) · job address · job type (Residential / Commercial) · **Job scope**: a search field over the
active `scope_library` names rendered as toggle chips; when the typed text matches nothing, a dashed chip offers
`+ Add "…" as a custom line`; picked items list below with a remove control; custom items carry a `custom` tag ·
estimate date (default today) · start date if known · additional notes (becomes the customer description).

### Step 2 — Client
Client name (required) · client type (Homeowner / Contractor) · **business name, shown only for Contractor** ·
phone · email (hint: needed to send the estimate from GHL).

### Step 3 — Financial
**Total-bid band** on top: dark ink band, total in 36px tabular numerals, sub-line `true margin X% · N hrs · N loads`,
and a "How it adds up" disclosure listing labor, dump fees, other job costs, overhead, profit, card fee 3.5%, total.
**Direct costs**: total labor hours · dumps (loads; fractional allowed; no helper text) · other job costs with
`+ Break it down` → materials / rentals / subcontractors / other direct costs (the sum writes back to the lump).
**Profit margin**: chips 20 / 25 / 30 / 35 / Other… (free percent), hint that the realized share shows as true margin
in the band. The days × crew labor method is removed from the UI (used on 1 of 321 real estimates).

### Step 4 — Review
The same band. Then the **customer document**: "Estimate", `<job name> · <address>`, "Valid 30 days", "Prepared for
<client> [· <business name>]", a Scope / Price table with one row per scope line and an **editable price** per row,
a Total row, and the notes as the description. Line prices start as an **even split of the total in cents** (largest
remainder so they sum exactly). **Editing any line sets the quoted price to the new line sum**; the band then shows
`Quoted $X · calculated $Y` and a required **reason chip row** appears (Rounded / Competitive / Customer budget /
Other… with free text). Zero scope lines → a single "Demolition services" line at the full price.
Below: **Record only** switch (Path B: no proposal sent, invoice at completion; hides the document push) and an
internal summary (estimator, job type, hours · loads, profit margin with true margin).
Actions: **Save and send to GHL** (primary: creates the estimate, pushes opportunity fields + the draft estimate
document) · **Save estimate** (no push) · Save as draft.

### Drafts
Save as draft writes the whole wizard state and the current step to `estimate_drafts`. The list page shows drafts at
the top with a Draft pill; opening one resumes at the saved step on any device. Finishing promotes the draft: the real
estimate is created through the existing RPC, and the draft is marked promoted. Discard is a soft delete.

## 4. Data and rules

- **Line items become customer lines**: `estimate_line_items.customer_price` (numeric 12,2, default 0) and
  `is_custom` (boolean). Existing hours/dumps/materials columns remain (default 0). `scope_library_id` was already
  nullable. `create_estimate_with_items_v2` inserts the two columns and **raises when lines are present and their
  prices do not sum to `coalesce(quoted_price, total_bid)`** (±0.01).
- **Prices are edited before the first save only** (line items are immutable by trigger). A later correction is a new
  version, as today.
- **Reason required** when quoted ≠ calculated — the existing `quote_override_reason_required` table CHECK (fires on
  insert) is the backstop; the UI requires a chip, `validateQuoteOverride` and the repo re-check stay.
- **Two new immutable estimate columns**: `client_business_name`, `requested_start_date` (added to the
  `enforce_estimate_immutability` watched list). `schedule_estimate` is unchanged; the schedule form prefills from
  `requested_start_date`.
- **`estimate_drafts`**: `id`, `created_by_name`, `job_name`, `current_step` (1–4), `payload jsonb`,
  `promoted_estimate_id`, `discarded_at`, timestamps; RLS on, no policies; service-role RPCs `upsert_estimate_draft`,
  `discard_estimate_draft`, `mark_estimate_draft_promoted`.
- **Economics**: lump → `other_direct_cost`; breakdown → the four categories; `expected_dump_cost` = loads × $65;
  `expected_processing_cost` = the engine's card fee. Engine input `jobSpecificCosts` = lump (or breakdown sum).
- **No pricing in scope text**: line names/descriptions may not contain a currency amount (they are copied into the
  crew-visible `jobs.scope_summary` at scheduling).
- **GHL document and Scope Notes use the stored `customer_price`** directly; the proportional allocation is no longer
  used (file kept). Custom names still land in the "Scope not in GHL Job Scope list" note.
- **Unchanged**: pricing engine (golden-321), immutability + version chains, lifecycle (present/accept/reverse,
  sent/accepted/declined), schedule flow, GHL push idempotency, estimator picker.

## 5. Design system

Tokens as CSS variables with a dark set: `--ink #192534`, `--ink-soft #2b3949`, `--muted #697585`,
`--surface #fff`, `--canvas #edf0f3`, `--canvas-warm #f7f8fa`, `--line #dfe4e9`, `--accent #e45a34`
(`-strong #cf4d29`, `-soft #fff0ea`), `--success #27834e`, `--warning #9f6700`, `--danger #b63831`, `--info #315f8a`
(+ softs), band `#192534` / `#374657` / `#adb8c5` / `#7dd5a3`, radius 14px, shadow `0 14px 36px rgba(25,37,52,.10)`.
Type: Inter (next/font), 15px body, 16px inputs (no iOS zoom), 36px band total, tabular numerals for money.
Controls: 48px inputs, 50px primary button (accent), 38px chips, 44px segmented controls, 4px step bars.
`BrandMark` = striped accent square, a logo placeholder. One health color map shared by pills and banners.

## 6. Out of scope (recorded)
8b status action + engine manual-phase rules (staged, `docs/superpowers/plans/2026-09-02-v2-task8b-status-action-staged.md`);
list pagination past 100 rows; GHL push concurrency guard; foreman area; per-line hours for calibration (revisit
with Phase G).
