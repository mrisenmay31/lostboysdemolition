# System Audit — 2026-07-30

Full audit of the live Airtable base, the live Supabase project, and this repo. Supersedes
`SCHEMA_AUDIT_REPORT.md` (2026-04-29), which is now materially out of date.

Read this before trusting any other doc in the repo. Several of them describe a system that
does not exist.

---

## 1. The headline: the system was never actually started

| | Records |
|---|---|
| Airtable `Estimates` (`tblXr4V0W78g5pOYs`) | **296** |
| Airtable `Clients` (`tblSJkwDdupKzsst7`) | **989** |
| Airtable `Jobs` (`tbl6WcLuLL0uUcpI1`) | **9** — 5 named "Test Job" |
| Airtable `Jobs (old)` (`tblUXBjLXbvP8FqYS`) | 51 real historical jobs |
| Airtable `Expenses` | **0** |
| Airtable `Change Orders` | **0** |
| Supabase `time_entries` / `labor_actuals` / `expense_actuals` | **0 / 0 / 0** |
| Supabase `users` / `crews` | **0 / 0** |

**There is no actual-cost data anywhere in this stack.** Every variance field on Jobs currently
reads −100%, because it subtracts a populated estimate from a blank actual.

The `Estimates` table — which holds all the real volume — appears in no spec, no brief, and no
version of `CLAUDE.md`, and has **zero link** to `Jobs`. The Jobs pipeline that every edge
function is built around is a nine-record prototype.

### What is actually in daily use
Fillout (bid calculator + three foreman checklists), Google Calendar (scheduling), Slack (four
crew channels), GHL (estimates sometimes, and payments), Stripe via GHL. Gusto for payroll.
Airtable and the Supabase stage pipeline are scaffolding.

---

## 2. The pricing engine has never computed a number

Three compounding causes:

1. **Estimate fields are Airtable formulas, but the architecture says Fillout owns the math.**
   Commit `9e86284` changed the doc; the base was never changed. You cannot write to a formula
   field, so Fillout's calculated output has nowhere to land.
2. **Five pricing defaults were never set** — Labor Rate, Overhead Rate, Dump Fee Revenue,
   Target Margin Percent, Credit Card Fee Percent. `Price Before Fees` is guarded by
   `IF({Target Margin Percent}, …)`, so **the entire chain returns blank on every record**.
3. **That is why live code bills off `Total Bid Estimate`** (`fldazwdB2mw4Zh0n1`) rather than
   `Final Estimated Price` (`fldO4T2ChPZgL2kCZ`). It is a workaround for a broken chain, not a
   design decision. Note `Revenue Variance` measures against `Final Estimated Price` — so the
   invoice and the variance were keyed to different fields.

### Two math defects in the specified chain
- **Credit-card gross-up inflates reported margin.** `Base / (1 − 0.25) / (1 − 0.03)` means a
  25% target reports as **27.25%** — the fee is added to price but never booked as a cost.
  *Awaiting decision: cost line or pass-through.*
- **`Dump Fee Buffer` is an orphan.** Computed as dump revenue − dump cost, referenced by zero
  downstream formulas. The $300/load revenue assumption never reaches the quoted price.
  *Awaiting decision: priced in or informational.*

### Two hard-broken formulas
Both `isValid: false`, referencing deleted fields:
- `Labor Cost Variance` `fld5pKKhsSHP5eQVT` → references deleted `fldBLRg32QxBVNBRr`
- `Revenue Variance` `fld5FnWhKc2yF2JWg` → references deleted `fldO4T2ChPZgL2kCZ`

### Formatting defects
`Labor Hour Variance` renders **hours as currency** (and it is the field driving the proposed
≥15% alert). `Actual Profit Margin` is typed currency, not percent. Three field names carry
stray whitespace: `Actual Profit  `, ` Actual Profit Margin`, `Labor Cost `.

---

## 3. Structural debt in the Airtable base

- **Four competing representations of line items**: the flat 3-slot pattern on Jobs
  (`Line Item 1/2/3` × name/desc/qty/price = 12 fields), the `Invoice Line Items` linked table,
  a redundant empty `Invoice Line Items 2` link, and a direct `Scope Library` link. The flat
  pattern caps a job at three line items.
- **Scope Library is populated but orphaned in the forward direction.** 19 scopes with default
  hours and dump counts. `Default Materials Cost` is **empty on all 19**. It has four separate
  `Jobs`/`Jobs 2`/`Jobs 3`/`Jobs 4` link fields, one per line-item slot.
- **`Clients.Jobs` points at the WRONG table.** `Jobs` (`fldefnvFlGeJSUeFx`) → `Jobs (old)`;
  `Jobs 2` (`fldQvLnbflwL0cAgU`) → the live Jobs table. The April audit guessed the opposite —
  deleting per its guidance would destroy legacy linkage.
- **No labor or time-entry table exists in Airtable at all.** Labor is a single scalar,
  `Actual Labor Hours`. No per-employee, per-day, or per-scope granularity — the substrate the
  feedback loop needs does not exist.
- `Estimates` primary field name begins with a **UTF-8 BOM** (`"﻿Estimate ID"`), which
  breaks name-based field access.
- `Client Type Lookup` returns the client *name*, not the client type.
- Crew select has drifted: both `Crew 2` and `Crew 2 - Alex` exist as separate options.

**Field naming drift since the April snapshot:** the base was reworked toward Fillout's naming
and the docs never caught up. `fldduPjuhcSKbubdn` is now "Direct Labor Costs Estimate" (was
"Estimated Labor Cost"); `fldazwdB2mw4Zh0n1` is "Total Bid Estimate". `schema_audit.json` is
stale and has not been re-run.

---

## 4. Supabase state

10 tables. `sync_log` (668) and `client_sync_state` (280) are real and actively used by the
client sync, which runs daily and is healthy. `job_events` has 8 rows. Everything else is
empty scaffolding.

**The `jobs` mirror is permanently stale by design.** `receive-airtable-webhook` only writes on
`Scheduled` and `Invoiced` — it never sees `Completed`. Live contradictions exist: JOB-1002 is
`Lead-Request` in Airtable but `Invoiced`/archived in Postgres; JOB-1005/1006/1007 are
`Completed` in Airtable but `Scheduled` in Postgres. Supabase is missing JOB-1003/1011/1012 and
has JOB-0001, which does not exist in Airtable.

**Inconsistent job keys — nothing joins cleanly.** `jobs.airtable_job_id` stores `JOB-1005`;
`job_events.job_id` stores the record ID `rec9AOlcpomOjzDNP`; `labor_actuals.job_id`,
`expense_actuals.job_id` and `invoice_reminders.job_id` are untyped text with no FK.

**A complete clock-in/clock-out schema already exists and has never been used.** `users` (roles
employee/foreman/admin, `hourly_rate`, `crew_id`), `crews` (`foreman_id`), `time_entries`
(clock in/out, duration, labor cost, edit audit trail). Zero rows in all three — not even the
first admin was provisioned. `push-to-airtable` was built to aggregate these into Airtable
actuals. The labor loop was designed and abandoned before first use.

---

## 5. Security

Fixed this session (migrations `20260730205654`, `20260730205752`):
- RLS was **off** on `sync_log`, `client_sync_state`, `job_events`, `invoice_reminders`,
  `labor_actuals`, `expense_actuals` — 989 client records and 668 webhook payloads readable and
  writable by anyone with the anon key. Now enabled, no policies by design (`service_role` has
  `rolbypassrls = true`, so edge functions are unaffected).
- **RLS alone was insufficient.** Two `SECURITY DEFINER` views over `sync_log`
  (`recent_sync_activity`, `sync_errors`) bypassed it — anon still read 50 rows after RLS was
  on, and `sync_errors` exposed full `payload_in` with names, phones, addresses. Both now
  `security_invoker = on`. Verified: anon 0 rows; service_role retains read + INSERT.

Still open:
- **`receive-airtable-webhook` has no `x-webhook-secret` validation** and permissive CORS —
  anyone with the URL can create or archive job records. Every other function validates.
  Deliberately left unchanged pending Matt's go-ahead, since it is a live endpoint.
- All 7 edge functions run `verify_jwt: false`.
- 5 `SECURITY DEFINER` functions are executable by `anon` via `/rest/v1/rpc/`.
- Leaked-password protection is disabled in Supabase Auth.

---

## 6. Latent bug in `push-to-airtable`

It PATCHes `Actual Labor Cost`, which is an **Airtable formula field** — the call would fail if
ever invoked. It also addresses fields by *name* rather than field ID, against the project's
stated convention. Dormant only because `time_entries` is empty.

---

## 7. Docs that cannot be trusted

- **`schema_overview.md` contains no Airtable schema.** `CLAUDE.md` and the Project Brief both
  cite it as the schema reference. It held the Supabase guide pasted twice; the duplicate was
  removed 2026-07-30 and a warning banner added. The original Airtable spec survives only at
  `git show d9eedd6:schema_overview.md`.
- **The 15-function `stageN-*` build sequence is a superseded plan**, not a backlog. Naming was
  abandoned for `airtable-*`, and triggers differ from what shipped (e.g. `airtable-job-completed`
  fires on Airtable Status, not the planned Fillout checklist webhook).
- `SCHEMA_AUDIT_REPORT.md` (April) predates significant base drift and gets the `Clients.Jobs`
  link backwards.
- The Project Brief's Path A/B steps say "GHL invoice created" — superseded by direct Stripe.
