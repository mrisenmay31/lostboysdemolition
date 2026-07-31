# Discovery & Financial Analysis — 2026-07-31

Built from Matt's `Lost Boys Workflow Overview` plus 45 answered discovery questions, verified
against the live Airtable base, the live Supabase project, and four exported datasets: Stripe
payments, BILL card transactions, Gusto payroll, and the GHL invoice list.

**This document is evidence.** `SYSTEM_AUDIT_2026-07-30.md` audited the *systems*; this audits the
*business*. Where they disagree, this one is newer and sourced from operating data.

> **Headline:** the business is meaningfully more profitable than its own numbers say, and the
> reason is that a deliberate dump-fee pad has been silently financing a ~$246k/yr labor estimating
> shortfall. Every individual number in the pricing engine is wrong; they cancel.

---

## 1. The pricing engine as actually built

The Fillout calculator's real formulas (confirmed by Matt, 2026-07-31):

```
Labor        = $26 × total job hours
               OR $26 × employees × 8 × days at job
Dump Fees    = $300 × number of dumps
Direct Costs = job-specific costs (rentals live here, ~20% of jobs)
Total Direct = Labor + Dump Fees + Direct Costs
Overhead     = $23 × total job hours (or × employees × 8 × days)
Profit       = (Total Direct + Overhead) × (Profit % / 100)
CC Fee       = (Total Direct + Overhead + Profit) × 0.035
Total Bid    = Total Direct + Overhead + Profit + CC Fee
```

### It is a markup, not a margin

`base × (1 + rate)`, not `base / (1 − rate)`. `CLAUDE.md` carries an explicit rule against exactly
this ("No '10 and 10' markup logic — pricing is margin-divisor"). The specified chain was never
implemented, and nobody had ever compared the built form against the spec.

| Profit % entered | Actual % of revenue |
|---|---|
| 25% | **19.3%** |
| 20% | 15.6% |
| 15% (stated floor) | **12.6%** |

**Confirmed intentional.** Dane and Jackson understand it as cost-plus markup. This is a *labeling*
problem, not a pricing bug — rename the field, report true margin alongside, change no prices.

### Other pricing facts

- Profit % is a **per-job input**, adjusted at discretion — job size, relationship, competition.
  Floor 15% (really 12.6%). The engine needs a per-job override with a default.
- Same rate card for contractors and homeowners; only discretionary margin varies, more often for
  contractors.
- CC fee is **3.5% in the calculator** and charged to every customer regardless of payment method;
  the customer never sees it as a line item. Airtable `Pricing Variables` stores `0.03` — **stale,
  nothing reads it.** Go-forward rate is **3.5%** (Matt, 2026-07-31).
- Multi-crew jobs are avoided (hurts productivity) — no special handling needed.
- Materials and rentals are estimated from experience; **no reference list exists.**
- **No standardised estimating process exists.** Matt: "there needs to be one."

---

## 2. Stripe — 183 paid payments, 2025-11-21 → 2026-07-31

| | Count | Revenue | Share | Effective fee |
|---|---|---|---|---|
| Card | 170 | $546,785 | 81.3% | 2.909% |
| ACH | 13 | $125,532 | 18.7% | 0.052% |
| **Blended** | **183** | **$672,317** | | **2.376%** |

- Median invoice $2,500; mean $3,674; range $88–$45,000.
- **You charge 3.5% and pay 2.376%.** ACH payments average $9,656 and cost 0.05% — the largest jobs
  carry the fattest pad.
- 39 jobs over $5,000 = **21% of jobs but 57% of revenue** (relevant to the deposit decision).
- 11 failed payments of 194 attempts (5.7%).

---

## 3. Revenue — measured from the GHL invoice list (272 invoices, 2025-11-20 → 2026-07-31)

| Status | Count | Total |
|---|---|---|
| Paid | 205 | $809,544 |
| **Overdue** | **18** | **$61,150** |
| Draft | 1 | $25,750 |
| Sent | 2 | $14,250 |
| *(blank, $0)* | 46 | $0 |
| **Total** | **272** | **$910,694** |

**Annualized: $1,315k invoiced / $1,169k paid.**

Check-paid = $809,544 − $672,317 (Stripe) = **$137,227, ~17% of paid revenue.** All clients are
invoiced through GHL; checks are marked paid there, so GHL — not Stripe — holds the complete
revenue picture.

**Two items needing attention:** $61,150 sits overdue across 18 invoices, and 46 invoices (17% of
all) carry blank status and $0 — drafts, voids, or a data problem.

### Invoice structure — two structural findings

- **226 of 272 invoices (83%) have exactly one line item.** Invoices are a lump sum plus a prose
  description; scope detail lives in free text. **Per-scope attribution must therefore come from the
  estimate side, not the invoice side.**
- **Line-item names are uncontrolled free text.** "Interior Demolition" (114) vs. "Interior Demo"
  (30); "Commercial Demo" vs. "Commerical Demo" (typo). **This is precisely why scope-mix data — one
  of the two metrics Matt named as decision-changing — does not exist.** Sourcing line-item names
  from `Scope Library` fixes it as a side effect.
- Change orders *do* reach invoices ad hoc — "Added items", "Added Demo", "Demo Items Added",
  "Change Order" — roughly **$26,750 across 18 instances**, consistent with Matt's <10% leakage
  estimate.

---

## 4. BILL — 1,815 transactions, 2026-01-01 → 2026-07-31

Total card spend **$333,760** over 7 months (~$572k annualized).

### Dump economics

`Dump Fees` holds 422 transactions / $51,814, mixing two unrelated things:

**Hauling services** — 7 transactions, $19,664 (38% of tagged dump spend):
Blue Collar Haulers (4, $10,808, avg $2,702) and Chew It Up Enterprises (3, $8,856, avg $2,952).
*Pending: Dane to confirm what these vendors actually do — likely their own category.*

**Landfill tipping** — 415 transactions, **$32,150, mean $77, median $65** (p25 $43, p75 $92,
p90 $128):

| Merchant | n | Total | Avg |
|---|---|---|---|
| North Point Solid Waste | 268 | $16,409 | $61 |
| Ace Intermountain | 43 | $4,505 | $105 |
| Te Co | 47 | $3,827 | $81 |
| Trans Jordan Cities | 11 | $1,485 | $135 |
| Payson City Landfill | 18 | $1,000 | $56 |
| Wave Sunny Desert Dump | 3 | $1,162 | $387 |
| Weber County Solid Waste | 4 | $589 | $147 |
| Onp Landfill | 4 | $373 | $93 |
| Bannock County Landfill | 2 | $176 | $88 |
| City of Bountiful | 3 | $132 | $44 |
| Washington County Solid | 1 | $123 | $123 |

**One card swipe = one billable load** (confirmed by Matt) — loads are simply far cheaper than the
$300 charge implies. Load *count* is therefore derivable from BILL; no foreman form field required.

| | |
|---|---|
| Effective charge per load | $300 × 1.25 × 1.035 = **$388** |
| Median actual cost per load | **$65** (mean $77) |
| Loads per year | ~712 (415 ÷ 7 months) |
| Dump revenue | **~$276,000** |
| Dump cost | **~$55,000** |
| **Gross spread** | **~$221,000** |

Cross-check: ~712 loads ÷ ~264 jobs/yr = **2.7 loads per job** — plausible for demolition.

**The $300 is deliberate risk pricing, not merely profit** (Matt). It absorbs three things: profit,
per-ton cost variability by material, and **load-count estimation error** — "if we estimate two dump
loads and it ends up being four, which happens." At $388 charged against $65 median cost, the pad
tolerates a **~5–6× load overrun** before it stops covering.

**Design consequence:** because the pad absorbs the error, nobody ever *feels* a bad load estimate,
so there is no pressure to improve it and no data on how wrong it runs — yet
`Scope Library.Default Dump Count` is meant to calibrate from exactly that signal. **Dump variance
must be reported as two separate numbers:** load-count variance (feeds scope calibration, never
touches price) and dump-cost variance (feeds margin reporting).

### Data quality problems in BILL

- **Job Name populated on only 35.5%** of transactions (645/1,815, $114,612 of $333,760).
- **148 transactions / $46,407 (14% of spend) have no category at all.**
- **Dump spend under-tagged by ~$6,944 (~13%):** Local Dumpster 9 txns/$5,273 (blank), Pay Fulltilt
  Dump $671 (*Donations & Charitable*), Round Up Transfer $523 (*Gas*), Wave Sunny Desert Dump $325
  (*Job Supplies*), North Point $151 (*Small Tools / Job Supplies*).
- **Mis-tagged into dump:** Little Caesars $4.33, Home Depot $94.68, Ace Rents $736.55, Asphalt
  Materials $10.38.

---

## 5. Payroll — Gusto, 2026-01-01 → 2026-07-31

| | Field crew | Dane + Jackson |
|---|---|---|
| People | 25 | 2 |
| Productive hours (reg + OT) | 15,613 | 2,272 |
| Gross wages | $334,392 | $53,654 |
| Employer cost | $361,188 | $57,896 |
| **All-in per productive hour** | **$23.13** | $25.48 |

Field annualized: **26,765 hours · $619,179.** Average gross wage $21.42/hr with an 8% employer
burden — internally consistent.

### The $26 standard rate is a pad — the docs have it backwards

`CLAUDE.md` states true all-in labor is "$27–29/hr" and that "$26 is conservative, so actual profit
is structurally **overstated** by $1–3 per labor hour." **The opposite is true:** all-in is **$23.13**,
so $26 sits **$2.87/hr above** cost and profit is *understated*.

**Caveat:** Gusto's employer cost covers payroll taxes, **not workers' compensation** — expensive in
demolition. BILL shows Auto-Owners $6,616, Kinsale Capital $4,360, "Insurance Payment" $7,897. At
~10% of payroll, true cost lands near **$25.30** — still at or below $26, but the pad is thinner.
**Confirm from the actual WC policy before treating $2.87 as real.**

---

## 6. Labor underestimation — confirmed

```
$1,314,855 / 1.29375         = $1,016,313
  less dump (712 × $300)     =   $213,600
  less other direct (~$100k) =   $100,000
49H                          =   $702,713   →  H ≈ 14,300 estimated hrs/yr
Actual field hours                             ≈ 26,800/yr
```

| | Share of revenue |
|---|---|
| Labor **assumed in bids** (14,300 hrs × $26) | **28.4%** |
| Labor **actually paid** ($619,179 all-in) | **47.1%** |
| **Shortfall** | **~$246,000/yr** |

**The gap is two different things, and nothing in the stack can separate them:**

1. **Genuine underestimation** — bids assume fewer hours than the work takes.
2. **Unbillable time** — drive, shop, maintenance, loading, training.

**This is the real argument for job-level time tracking:** not to produce a variance number, but to
split that shortfall into "bid better" versus "cost of running crews," which have completely
different remedies.

*Soft input: the ~$100k other-direct-costs figure remains an estimate backed into from BILL
categories that are not all job-billable.*

---

## 7. The four pads — and why they must be fixed together

| Pad | Direction | Annual value |
|---|---|---|
| Dump: ~$388 charged vs. $65 median cost | + | **+$221,000** |
| CC fee: 3.5% charged vs. ~2.4% paid (check payers cost 0%) | + | +$15,000 |
| Labor rate: $26 standard vs. $23.13 all-in | + | +$41,000 |
| **Labor hours: ~14,300 bid vs. ~26,800 actual** | **−** | **−$246,000** |
| **Net** | | **≈ +$31,000** |

*(Separately, the markup-labeled-as-margin defect means an entered 25% realises 19.3%.)*

**The dump markup has been almost exactly financing a labor estimating shortfall.** That is why the
business hits roughly its intended margin while every individual number in the system is wrong. Not
luck — a pad sized generously enough to absorb an error nobody could see.

**Fixing the dump price before fixing labor estimation would be actively dangerous.** It would strip
out the buffer covering a quarter-million-dollar annual gap.

> **Governing decision: hold every quoted price exactly where it is today.** The engine must
> reproduce today's prices to the cent. Every one of these becomes a *reporting* line, not a pricing
> change. Repricing is Dane's decision, made once, on real data.

### This also reconciles the long-standing margin gap

`CLAUDE.md` and BUILD_PLAN both flagged an unexplained conflict — 25% engine target vs. 40–60%
company benchmark, "different denominators, never reconciled." The reconciliation is the pads above
running in opposite directions.

---

## 8. Corrections owed to other repo documents

1. **Roles.** Dane is **owner, founder, president**; Jackson is **sales/estimator**. `CLAUDE.md`
   lists both as estimators.
2. **Zapier's role is now known** — it runs **website lead form → Slack**, and previously ran the
   night-before Slack message (abandoned as unreliable). `CLAUDE.md` says its role is "unverified."
   **Retiring Zapier has a live prerequisite no plan identified.**
3. **`SYSTEM_AUDIT_2026-07-30.md` §2 describes `Jobs (old)`, not the live base.** On
   `tbl6WcLuLL0uUcpI1`: the five pricing defaults **are** set (all 5 rows in `Pricing Variables`,
   Active since 2026-04-29); there is **no `Price Before Fees` field**; estimate fields are plain
   `currency`, not formulas; and **no `Dump Fee Buffer` field exists anywhere in the base.** The
   per-record rate fields and the formula chain the audit describes all live on `Jobs (old)`
   (`tblUXBjLXbvP8FqYS`). *Still true:* the two hard-broken variance formulas
   (`fld5pKKhsSHP5eQVT`, `fld5FnWhKc2yF2JWg`) do exist on live `Jobs`.
4. **BUILD_PLAN Phase 1's "seed `scope_library.default_materials_cost`" is not doable** — no
   reference list exists and the field is empty on all 19 scopes. It is a **feedback-loop output,
   not a migration input.**
5. **BUILD_PLAN's "GHL opportunity = headline numbers + links" premise is false today** — GHL is not
   used for pipeline tracking at all. Matt wants it to be, and GHL is already in the daily routine,
   so adoption is plausible — but it must be designed for, not assumed.
6. **The labor-rate benchmark in `CLAUDE.md` is backwards** (see §5).

---

## Method note

Every figure above is derived from exported operating data, not from the repo's prior documentation.
Where a number rests on an assumption — the ~$100k other-direct-costs figure, the 712 loads/yr
extrapolation, workers' comp exclusion — that is stated inline. An earlier estimate of check-paid
share at 38%, derived from gaps in the Stripe invoice-number sequence, was **wrong**; the GHL
invoice list put it at 17%. Sequence-gap inference is not reliable here because 46 blank/$0
invoices and voided records occupy numbers in the same range.
