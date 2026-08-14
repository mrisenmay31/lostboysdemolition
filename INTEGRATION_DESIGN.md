# Stage 3 & 4 — Actuals Integration Design

**Goal:** Get Gusto labor hours + Divvy/Bill expenses flowing into Airtable on a per-Job basis.

**Authored:** 2026-04-29 (after API research)
**Status:** Draft — awaiting Matt's verification of Zapier capabilities

---

## TL;DR — Recommended Architecture

| Source | Mechanism | Direction | Frequency |
|---|---|---|---|
| **Bill.com Spend & Expense** | Webhook → Zapier → Airtable Expenses | Real-time | On every transaction CLEAR event |
| **Gusto Project Hours** | Zapier polling → Airtable Jobs.Actual Labor Hours | Periodic (every 15 min) | Best-effort; GL Report API as fallback |

**Why Zapier as the bridge**: Lost Boys already has Zapier paid for and working (existing crew-scheduling Slack flow). Adding two more Zaps avoids building/hosting custom webhooks. Both Bill.com and Gusto have official Zapier apps.

**Critical caveat**: Gusto does NOT have a real-time public API for **Project Tracking** data. We have three options for Gusto hours, evaluated in detail below.

---

## Gusto — The Three Confusing "Jobs"

This was a key discovery. Gusto uses the word "job" in three different contexts. Don't confuse them.

### 1. Gusto Jobs (HR/Compensation)
- API: `/v1/companies/{company_uuid}/jobs`
- Means: An employee's title + pay rate (e.g., "Crew Leader, $25/hr")
- Each employee has 1+ Gusto Jobs (with a primary)
- **NOT what we need.** This is HR data, not customer-job time tracking.

### 2. Gusto Project Tracking
- Feature in Plus/Premium/Time & Attendance Plus plans
- Employees clock in/out to Projects, with Tasks
- Generates Workforce Costing Report by project
- **This IS what we need** — maps to Lost Boys customer jobs
- ⚠️ **NO PUBLIC API.** Per Gusto's help center, project data is only available via:
  - In-app reports
  - QuickBooks Online / Xero accounting integrations (chart of accounts mapping by project)
  - CSV export

### 3. Gusto Time Tracking API (Embedded Partner API)
- Endpoint: `POST /v1/companies/{company_uuid}/time_tracking/time_sheets`
- Direction: **Push time data INTO Gusto** (for partners like QuickBooks Time, Homebase)
- **NOT useful for us** — wrong direction, we want to read project hours OUT.

### 4. Gusto Payroll General Ledger Report API ⭐
- Endpoint: `POST /v1/companies/{company_uuid}/payrolls/{payroll_id}/general_ledger_report`
- Parameters: `aggregation: "job"` aggregates payroll cost by Gusto Job (#1 above) — NOT Project Tracking
- ⚠️ **Misleading name.** This aggregates by employee compensation tier, not by customer project.
- Verdict: Probably not what we want either.

### Conclusion for Gusto
- **No real-time project-hours API exists from Gusto directly.**
- Available paths to get Project Tracking hours into Airtable:

| Option | Method | Latency | Reliability |
|---|---|---|---|
| A | **Zapier** "New Project Time Entry" trigger (if Zapier offers it) | ~15 min | Depends on Zap configuration |
| B | **Scheduled CSV export** script (Matt exports weekly, script imports to Airtable) | Weekly | High |
| C | **QBO chart of accounts mapping** (if Lost Boys uses QBO) | Per-payroll | Medium (post-payroll lag) |
| D | **Ask employees to also log hours into Airtable** (manual double entry) | Real-time | Low |

**Action item:** Matt to log into Zapier and check what Gusto triggers are offered. Specifically look for:
- "New Time Entry"
- "New Project Time Entry"
- "Project Time Updated"
- Anything that fires when an employee clocks in/out to a project

If Zapier offers it (Option A): build a Zap.
If not: Option B (scheduled CSV export) is the fallback.

---

## Bill.com Spend & Expense — Solid API ✓

### Native Capabilities (verified via developer.bill.com)

1. **Webhooks** — `spend.transaction.updated` event fires when transactions clear/auth/decline
2. **Custom fields** — Can be created at company level via `POST /v3/spend/custom-fields`. Field types: `CUSTOM_SELECTOR` (dropdown) or `NOTE` (free text)
3. **Transaction tagging** — `PUT /v3/spend/transactions/{transactionUuid}/custom-fields` sets a tag value on a transaction
4. **List/Get transactions** — `GET /v3/spend/transactions` for polling, `GET /v3/spend/transactions/{transactionId}` for single
5. **Auth** — Spend & Expense API token (separate from BILL AP/AR token)
6. **Rate limit** — 60 calls/token/minute

### Recommended Bill.com Architecture

**Phase 4a — Tagging convention**
- Create a custom field in Bill.com: `Lost Boys Job ID`
- Type: `CUSTOM_SELECTOR` with `allowCustomValues: true` so crews can type a Job ID without admin pre-creating each one
- Crews tag every transaction with the Job ID (e.g., `JOB-1001`) at time of purchase via the Bill.com mobile app
- Untagged transactions go to a default catch-all

**Phase 4b — Sync mechanism (two equivalent options)**

**Option I — Zapier (recommended for speed):**
1. Bill.com → Zapier "New Transaction" trigger (or webhook receiver)
2. Filter: only `transactionType = CLEAR` (skip auth, declines)
3. Lookup: Airtable record where Job ID = transaction's Lost Boys Job ID custom field value
4. Action: Create Airtable Expenses record:
   - `Job` = linked record (resolved)
   - `Amount` = transaction amount
   - `Vendor` = `merchantName`
   - `Date` = `occurredTime`
   - `Bill Transaction ID` = `transaction.uuid`
   - `Receipt URL` = receipt URL if available
   - `Payment Source` = `Divvy`
   - `Category` = mapped from `merchantCategoryCode` (we'd build a mapping table)

**Option II — Direct webhook to custom endpoint:**
- Set up a small HTTP endpoint (e.g., on Vercel/Cloudflare Workers)
- Receive `spend.transaction.updated` webhook
- Validate signature, look up Job in Airtable, create Expense record
- More flexible but requires hosting + code maintenance

**Decision:** Start with Option I (Zapier). Lower complexity, leverages existing infra. Migrate to Option II only if Zapier limits become painful.

**Phase 4c — Edge cases to handle**

- **Untagged transactions** — Create Expense record with `Job = null` and a flag "Needs review". Surface in an Airtable "Untagged Expenses" view for Matt to manually link.
- **Tag typos** (e.g., "JOB-1001" vs "JOb-1001" vs "1001") — Either:
  - Strict: lookup must match exactly; mismatches go to "Needs review" view
  - Lenient: use a normalized Job ID (case-insensitive, prefix-tolerant)
  - Recommendation: **Strict** to prevent silent miscategorization
- **Refunds** — Bill.com may emit `transactionType = OTHER` or send a child transaction with negative amount. Handle as a separate Expenses record with negative amount.
- **Splits** — Bill.com supports parent/child transactions (`parentTransactionUuid`). Skip the parent, only ingest children.
- **Authorization-then-clear** — Skip `AUTHORIZATION` events, only ingest on `CLEAR` to avoid double-counting.

---

## Open Questions for Matt

### Q1: Zapier Gusto triggers
Log into Zapier → Make a Zap → choose Gusto as trigger app. **Screenshot or list every trigger Gusto offers.** I need to know if there's a project-time / time-tracking trigger.

### Q2: Zapier Bill.com triggers
Same — log into Zapier → choose Bill.com (and "BILL Spend & Expense" if separate) as trigger. List every trigger offered.

### Q3: Gusto plan tier
Confirm Lost Boys is on Gusto Plus/Premium/Time & Attendance Plus (i.e., Project Tracking is enabled). If only on Core/Simple, project tracking isn't available and we'd need a different approach.

### Q4: Existing tagging in Bill.com
Are crews already adding any kind of tag/note/memo to transactions? If yes, what convention? (We may be able to reuse it.)

### Q5: Gusto Project naming
What's the current Gusto Project naming convention (if any)? We'll need every Gusto Project name to map cleanly to a Lost Boys Job ID. Options:
- **A:** Gusto Project name = Job ID (e.g., "JOB-1001")
- **B:** Gusto Project name includes Job ID + readable suffix (e.g., "JOB-1001 — Maddie's Playground")
- **C:** Map via a separate table (Gusto Project ID stored on each Airtable Job)

Recommendation: **A** for simplicity, OR **B** for human-readable Gusto reports. **C** adds maintenance overhead.

---

## Dependencies / Pre-work

Before either sync goes live:

1. ✅ **Schema is ready on Airtable** — Jobs table has Gusto Project ID + Divvy Job Tag fields, Expenses table has Bill Transaction ID + Job link
2. **Need:** Defaults set on Jobs (Matt's UI work)
3. **Need:** Bill.com custom field "Lost Boys Job ID" created (Matt OR I can do via API once we have a Bill.com PAT)
4. **Need:** Gusto Project naming convention agreed and applied to existing projects

---

## Recommended Sequence

Once Matt answers Q1–Q5:

1. **Quick win first — Bill.com sync:** Bill.com has the cleaner API path. Set up tagging convention + Zapier. Likely 1-2 hours of work.
2. **Then Gusto:** Depending on Q1's answer:
   - If Zapier supports project triggers → 1-hour Zap setup
   - If not → 2-3 hours to build CSV import script + scheduling
3. **End-to-end test on one job:** Pick an in-flight job, run a full week of actuals through it, verify Actual Profit calculates correctly.
4. **Rollout to crews:** Brief Slack message to Nick/Alex with the tagging convention, then go live.

Total estimated effort once questions are answered: **4–8 hours of agent + Matt time combined.**

---

## Files Referenced

- [`SCHEMA_AUDIT_REPORT.md`](./docs/archive/SCHEMA_AUDIT_REPORT.md) — Schema audit (mentions Jobs table is ready for actuals). **Archived 2026-08-14 — superseded by `SYSTEM_AUDIT_2026-07-30.md`, and its `Clients.Jobs` recommendation is backwards.**
- [`schema_overview.md`](./docs/archive/schema_overview.md) — ~~Canonical Airtable schema~~. **This description is wrong** and was wrong when written: the file contains Supabase integration notes, not an Airtable schema. Archived 2026-08-14. For the real Airtable schema see `SYSTEM_AUDIT_2026-07-30.md`.
- [Bill.com Spend & Expense API](https://developer.bill.com/docs/spend-expense-api)
- [Bill.com webhook events](https://developer.bill.com/docs/webhooks)
- [Gusto Project Tracking](https://support.gusto.com/article/202018885100000/Manage-projects-and-track-project-time)
- [Gusto Time Tracking API (push, not pull)](https://docs.gusto.com/app-integrations/docs/syncing-time-tracking-data)
