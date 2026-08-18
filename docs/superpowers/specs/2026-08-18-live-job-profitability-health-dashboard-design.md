# Live Job Profitability Health Dashboard — Approved Design

**Status:** Approved by Matt Risenmay on 2026-08-18  
**Project:** Lost Boys Demolition  
**Primary user:** Dane, CEO and owner  
**Implementation source of truth:** This document and the implementation plan that cites it supersede older job-creation and profitability assumptions where they conflict.

## 1. Objective

Build a continuous job-level feedback loop:

```text
Estimate → Schedule → Perform work → Capture actuals
→ Forecast outcome → Reconcile → Learn → Improve future pricing
```

The system must let Dane understand within seconds whether an active job is on track, what is causing a variance, what the job is forecast to earn, and what action is required.

## 2. System ownership

- The Next.js estimator application backed by Supabase is the source of truth for estimates, jobs, budgets, forecasts, change orders, actual-cost attribution, profitability, and audit history.
- GoHighLevel owns contacts, companies, opportunities, customer communications, estimates/proposals, and invoices.
- Google Calendar is the synchronized operational calendar. It is not the job-creation authority.
- A selected construction timekeeping provider owns clock events, time corrections, and time approval. Gusto remains the payroll destination.
- BILL owns original expense and bill transactions.
- Slack is the primary out-of-app operational and profitability notification channel.

## 3. Lifecycle

```text
Lead
→ Draft estimate
→ Estimate issued
→ Accepted / Ready to schedule
→ Scheduled
→ In progress
→ Fieldwork complete
→ Invoiced
→ Financially reconciled
→ Paid / Closed
```

- An estimate or GHL opportunity is not an official job.
- Estimate acceptance does not mint `JOB-XXXX`.
- Scheduling inside the estimator application atomically mints `JOB-XXXX`, creates the canonical job, attaches the accepted estimate, freezes the original financial baseline, and queues integrations.
- The estimator application creates and updates the Google Calendar event.
- A foreman's start checklist automatically moves `Scheduled` to `In Progress`.
- A completion checklist moves the job to `Fieldwork Complete`, subject to Dane's review.
- Invoice and collection state are tracked separately from operational job status. Dane alone initially approves `Financially Reconciled` after final invoice data is present; payment may occur before or after that approval.
- Only jobs created after the launch date use the new workflow. No full historical operational migration is required.

## 4. Estimate model

The existing two labor-entry methods remain:

```text
Method A: Productive hours = user-entered total hours
Method B: Productive hours = crew size × workdays × hours per day
```

The accepted estimate snapshots all inputs, rates, outputs, and formula version. Existing rates remain:

- Labor estimating rate: $26/productive hour
- Overhead allocation rate: $23/productive hour
- Dump pricing rate: $300/load
- Credit-card pricing allowance: 3.5%
- Default markup: 25%
- Advisory markup floor: 15%

The existing calculation remains cost-plus markup, not a margin divisor:

```text
Labor pricing basis = Productive hours × labor estimating rate
Dump pricing basis = Dump count × dump pricing rate
Total direct pricing basis = Labor + Dump pricing + job-specific pricing basis
Overhead = Productive hours × overhead rate
Markup = (Total direct pricing basis + overhead) × markup percentage
Card allowance = (Total direct pricing basis + overhead + markup) × 3.5%
Calculated bid = Total direct pricing basis + overhead + markup + card allowance
```

The redesign must separately represent operational cost and pricing:

```text
Estimated operational direct costs
+ Allocated overhead
= Estimated fully loaded job cost

Fully loaded job cost
+ Risk/pricing allowances
+ Cost-plus markup
+ Payment-processing allowance
− Discounts
= Quoted customer price
```

This separation must not change existing prices by itself.

## 5. Financial comparison model

Every official job exposes three durable views:

1. **Original estimate:** immutable accepted baseline.
2. **Current approved plan:** original baseline plus customer-authorized and internally approved change orders.
3. **Actual and forecast:** provisional, committed, approved, and expected remaining costs.

The financial table is job-level, not phase-level:

- Direct labor
- Materials
- Rentals
- Dump costs
- Subcontractors
- Other direct costs
- Allocated overhead
- Payment-processing cost
- Revenue
- Economic profit

## 6. Economic profit

Markup is a pricing input; it is not the primary profitability metric.

```text
Planned economic profit =
Quoted revenue
− Estimated operational direct costs
− Allocated overhead
− Expected payment-processing cost

Forecast economic profit =
Current approved revenue
− Forecast operational direct costs
− Forecast allocated overhead
− Forecast payment-processing cost

Actual economic profit =
Final net invoiced revenue
− Actual direct costs
− Actual allocated overhead
− Actual payment-processing cost
```

Collected cash is shown separately and does not determine job profitability.

## 7. Forecasting

```text
Forecast final cost = Approved actual + Provisional actual + Committed + Estimate to complete
Forecast profit % = Forecast economic profit ÷ Current approved revenue
```

Labor uses crew-days remaining:

```text
Expected remaining hours = Remaining workdays × Expected crew size × Hours per day
Forecast final hours = Hours worked to date + Expected remaining hours
```

The latest Job Checklist supplies remaining workdays and expected crew size. When no current checklist exists, remaining hours default to unused approved hours and forecast confidence declines.

Nonlabor estimate-to-complete defaults to unused approved category budget until an explicit forecast override or evidence of an overrun exists.

## 8. Health and confidence

Initial configurable thresholds:

- **On Track:** forecast retains at least 90% of current planned economic profit.
- **Watch:** forecast retains 75%–90%, or material data is stale/missing.
- **At Risk:** forecast retains less than 75%, forecast profit is negative, or a hard-risk rule fires.

Hard-risk rules include:

- Forecast labor hours more than 10% above the current plan
- Actual plus committed category cost above its current budget
- Work occurring on unapproved changed scope
- Work occurring without a canonical scheduled job
- Material time, expense, or checklist data missing

Confidence:

- **High:** checklist, time, and expense feeds are current and no material records are unassigned.
- **Medium:** one material source is stale or incomplete.
- **Low:** progress or financial data is materially incomplete.

Incomplete data must never produce a misleading green status; medium or low confidence downgrades an otherwise On Track job to Watch.

## 9. Live Job Profitability Health Dashboard

The job page presents:

1. Job identity and operational status
2. On Track / Watch / At Risk headline
3. Forecast economic profit dollars and percentage
4. Original expected profit and variance
5. Plain-language primary explanation
6. Original / current approved / actual+committed / forecast comparison table
7. Labor hours and cost variance, expandable into productivity versus rate variance
8. Change orders and approval state
9. Action queue
10. Time, expense, checklist, invoice, and audit details

Dane also receives a portfolio view sorted At Risk, Watch, On Track, missing data, and reconciliation pending.

## 10. Labor reconciliation

- Estimates use the snapshotted blended burden rate.
- Actual labor uses approved hours multiplied by each employee's burdened rate effective on the work date.
- Forecast remaining labor uses the expected assigned crew's burdened rates when available, otherwise the estimate's blended rate.
- The default dashboard shows total labor variance.
- The expanded explanation separates hours/productivity variance from labor-rate variance.

## 11. Job Checklist

The mobile-responsive operational area contains three event types:

- Job start
- End of day on multi-day jobs
- Job completion

The foreman submits the checklist through an individual authenticated identity. Dane can review and override forecasts. Every override preserves the original submission and records actor, time, old value, new value, and reason.

Detailed checklist fields and foreman financial visibility are deferred. The stable required fields are checklist type, job, foreman, submission time, remaining workdays, expected crew size, hours per day, scope-change flag, notes, photos, and completion assertion.

## 12. Change orders

- A change order is an additive estimate attached to an existing `JOB-XXXX` and uses the normal pricing engine.
- The foreman documents and flags changed scope; Dane decides, prices, and issues the change order.
- Actual costs remain job-level and are not required to be allocated to individual change orders.
- An approved change requires customer authorization and internal approval by Dane.
- Customer authorization methods include signature, email, text, verbal, and other documented evidence.
- Verbal authorization records customer contact, employee receiving authorization, timestamp, scope, amount, conversation note, and optional evidence.
- Only the exact immutable approved version updates current approved revenue and budget.
- Work authorized internally before customer authorization remains pending; related cost enters the forecast, but revenue does not enter the official plan.

## 13. Actual-cost ledger

Every time or cost record stores:

- `JOB-XXXX`
- Category
- Amount or hours
- Date/time
- Source system and stable source ID
- Employee or vendor
- Provisional/committed/approved/void state
- Reconciliation state
- Audit history

BILL transactions normally belong to exactly one job or to overhead. Transaction splitting is not required for the first release.

Overhead expenses remain categorized outside jobs. Crew overhead and company overhead remain analytically separate but combine into one productive-hour allocation rate.

Unassigned and overhead are distinct; missing job information must not silently convert an expense to overhead.

## 14. Notifications

- In-app alerts are the permanent action queue.
- Slack sends immediate At Risk events.
- Slack sends one daily digest for Watch jobs, stale checklists, missing time, unassigned BILL expenses, and reconciliation exceptions.
- Normal On Track updates do not generate noise.
- Alerts are idempotent, link to the exact job/action, and retain resolution history.

## 15. Integration requirements

Any timekeeping provider is disqualified unless it can:

1. Accept a newly scheduled `JOB-XXXX` automatically.
2. Return corrected and approved job-coded time to Supabase through API, webhook, or deterministic export.

Provider selection is deferred. The application must implement a provider-neutral adapter boundary and manual/import fallback first.

All external writes use an outbox/idempotency pattern. Calendar, Slack, GHL, BILL, and timekeeping failures create visible retryable exceptions and never roll back a successfully created canonical job.

## 16. Rollout and deferred scope

The delivery is phased:

1. Financial/job foundation
2. Core user experience and manual reconciliation
3. External automation
4. Historical intelligence and rate recommendations

Deferred without blocking the first release:

- Detailed Job Checklist content
- Foreman financial visibility
- Timekeeping vendor choice
- Automatic BILL/timekeeping connectors
- Automated labor, overhead, dump, and pricing-rate recommendations
- Full historical operational migration

The schema must preserve the facts required for those later capabilities without implementing them prematurely.

## 17. Acceptance outcome

For a new job, Lost Boys can complete this loop:

```text
Create/prefill estimate → Accept → Schedule in app → Mint JOB-XXXX
→ Create calendar event → Start checklist → In Progress
→ Enter/import time and expenses → Update crew-days forecast
→ View live health → Approve change order if needed
→ Completion checklist → Reconcile → Dane closes
→ View original vs current plan vs final actual profitability
```

No historical job is required to be migrated for launch.
