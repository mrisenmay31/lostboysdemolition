# Job Dashboard Interactive Prototype Design

Date: 2026-08-20
Status: Approved for prototype planning
Audience: Dane and the Lost Boys Demolition implementation team

## 1. Purpose

Create a standalone, responsive HTML prototype that demonstrates how Lost Boys Demolition could monitor work from estimate through financial closeout. The prototype is a feedback tool for Dane, not production application code.

The prototype must make it easy to answer:

1. How is the business performing this month?
2. Where is current work in the operating lifecycle?
3. Which jobs need attention?
4. How is a specific job trending against its approved budget?
5. Why is a job On Track, Watch, or At Risk?

The prototype will use fictitious customers, addresses, jobs, costs, and revenue.

## 2. Design Principles

- Use construction-oriented terminology. The primary screen is **Job Dashboard**. Do not use “portfolio.”
- Lead with company totals, followed by work stages and exceptions.
- Preserve the same decision-making hierarchy on desktop and phone.
- Keep pre-job estimates visibly separate from official operational jobs.
- Show financial comparisons in a familiar P&L order.
- Explain health conditions in plain language instead of relying on color alone.
- Favor quick drill-down over dense configuration controls.

## 3. Prototype Boundary

The deliverable is one self-contained HTML file with embedded CSS, JavaScript, and sample data:

`docs/prototypes/lost-boys-job-dashboard-prototype.html`

The prototype will not:

- connect to GHL, Google Calendar, Bill, Gusto, Stripe, QuickBooks, or Supabase;
- authenticate users;
- permanently save edits;
- reproduce the complete estimate builder;
- implement production financial-close or audit controls;
- represent a final visual brand system.

Refreshing the page resets the demo to its original fictitious data.

## 4. Users and Responsive Behavior

The financial experience is designed primarily for Dane, the owner and CEO. Desktop/laptop and phone are equally important.

Desktop prioritizes comparison:

- four-column summary metrics;
- table-based stage views;
- full P&L comparison columns;
- side-by-side job progress and recommended actions.

Phone prioritizes scanability without removing essential information:

- two-column summary metrics;
- touch-friendly stage cards;
- record cards instead of dense job rows;
- a condensed P&L with expandable direct-cost detail;
- persistent, compact navigation.

## 5. Information Architecture

The prototype contains three primary surfaces.

### 5.1 Job Dashboard

The landing page uses this reading order:

1. Global navigation and selected period.
2. Current-month business snapshot.
3. **Work in Motion** stage navigation.
4. **Needs Attention** action queue.
5. **Live Job Health** summary.

The default period is August 2026 for stable demo data. The period selector also demonstrates July 2026 and Year to Date.

Headline metrics:

- **Approved Revenue:** revenue associated with official jobs active during the selected period.
- **Forecast Job Profit:** expected job profit across included official jobs.
- **Actual + Committed Costs:** posted actuals plus explicitly recorded commitments.
- **Open Estimate Value:** pre-job estimate value, displayed separately and never added to Approved Revenue.

Each official job is counted once within a selected period, even if it spans multiple days.

### 5.2 Work in Motion

Four prominent cards serve as the primary entry points:

- **Estimates**
- **Scheduled**
- **In Progress**
- **Complete**

Clicking a card opens a shared work-list screen filtered to that stage. The same four filters remain visible as tabs.

Stage group membership:

Stage names mirror the live 12-stage GHL pipeline exactly (see `CLAUDE.md` → 12-Stage GHL Pipeline).

- **Estimates:** New Lead, Intake / Qualification, Estimate in Progress, Quote Sent, and Quote Accepted. Quote Accepted remains pre-job until scheduling.
- **Scheduled:** Job Scheduled.
- **In Progress:** Job In Progress.
- **Complete:** Job Completed, Invoice Review, Invoice Sent, and Paid / Closed Won.

Closed Lost / Declined records are hidden from the default estimate list and excluded from Open
Estimate Value and every Work in Motion count. They stay reachable through the condition filter, so
no record disappears from history.

### 5.3 Job or Estimate Detail

Selecting a record opens a representative detail view.

Estimate detail emphasizes:

- estimate number and stage;
- client and job-site information;
- estimator and next action;
- base estimate value;
- estimated labor, direct costs, overhead, processing fees, job profit, and margin;
- quote history;
- scheduling action after acceptance.

Official job detail emphasizes:

- job identity, GHL stage, client, location, crew, and schedule;
- health status and confidence;
- forecast job profit and margin;
- plain-language health explanation;
- P&L comparison;
- progress and crew-days remaining;
- recommended actions;
- change orders, checklists, and activity history.

## 6. Stage Workspace

All four stage views share search, stage tabs, and contextual filters. Desktop uses rows; phone uses cards.

### Estimates

Show:

- estimate name and identifier;
- client;
- current quote stage;
- estimate value;
- estimator;
- last activity and next action.

### Scheduled

Show:

- job name and `JOB-XXXX` identifier;
- scheduled dates;
- assigned crew;
- approved revenue and current budget;
- calendar-sync state;
- operational-readiness exceptions.

### In Progress

Show:

- job name and identifier;
- On Track, Watch, or At Risk status;
- progress percentage;
- remaining crew-days;
- forecast job profit;
- forecast job-profit margin;
- plan comparison and data freshness.

### Complete

Show:

- job name and identifier;
- completion date;
- actual job profit and margin when sufficiently complete;
- estimate-to-actual variance;
- invoice stage;
- financial close or Reconciliation Required status;
- late-cost exceptions.

## 7. Job Health Presentation

The prototype uses the approved health model:

- **On Track:** forecast retains at least 90% of current approved economic profit and no confidence rule prevents green.
- **Watch:** forecast retains 75% to less than 90%, or data is stale or incomplete.
- **At Risk:** forecast retains less than 75%, forecast job profit is negative, or another hard-risk rule applies.

Confidence is shown separately as High, Medium, or Low. Medium or Low confidence prevents an On Track presentation.

Every health status includes a plain-language explanation, such as:

- labor forecast exceeds current budget;
- foreman increased remaining crew-days;
- Bill data has not refreshed recently;
- a likely cost has not posted;
- a late cost reopened reconciliation.

## 8. Job P&L Comparison

The job financial statement follows this exact hierarchy:

1. Revenue
   - Approved Revenue
   - Approved Change Order Revenue
   - **Total Revenue**
2. Direct Costs
   - Labor
   - Materials
   - Rentals
   - Dump Fees
   - Subcontractors
   - Other Direct Costs
   - **Total Direct Costs**
3. **Gross Profit**
4. Overhead Allocation
5. Processing Fees
6. **Job Profit**
7. **Job Profit Margin**

Definitions:

- **Approved Revenue** is the accepted base estimate only.
- **Approved Change Order Revenue** includes only changes with documented customer approval and internal approval.
- **Total Revenue** equals Approved Revenue plus Approved Change Order Revenue.
- Draft, pending, declined, or unapproved change orders remain outside the P&L.
- **Gross Profit** equals Total Revenue minus Total Direct Costs.
- **Job Profit** equals Gross Profit minus Overhead Allocation and Processing Fees.
- **Job Profit Margin** equals Job Profit divided by Total Revenue.

The sample data is generated from the ratified rate model rather than hand-entered, so the two
cannot drift apart:

- Labor equals productive hours × **$26/hr**.
- Overhead Allocation equals the **same** productive hours × **$23/hr**, so allocated overhead always
  moves in the same direction as labor.
- Processing Fees equal **3.5%** of recognised revenue (the ratified card allowance, not the stale 3%).
- A job that has not started posts no costs and no fee at all; its Actual + Committed profit rows
  read “Not started” rather than showing revenue-minus-nothing as margin.
- Dump fees remain modelled at the charged rate; separating charged dump revenue from true per-load
  dump cost is a pricing decision held outside this prototype.

The comparison columns are:

- Original Estimate
- Current Approved
- Actual + Committed
- Forecast at Completion
- Forecast Variance vs Current Approved

For revenue, Actual + Committed represents contractually approved revenue. For costs, it represents posted actual costs plus recorded commitments. The interface labels this distinction in a tooltip or inline note.

Desktop shows every direct-cost row. Phone initially groups non-labor direct costs and offers an expansion control for the full category detail.

## 9. Sample Data Scenarios

The prototype will include enough fictitious records to demonstrate different decisions.

### Estimates

- Oak Street Garage Removal — Quote Sent.
- Summit Dental Selective Demo — Estimate in Progress.
- Glenarm Home Interior Demo — Quote Accepted but not scheduled.
- Cherry Creek Basement Demo — Intake / Qualification.
- Sloan's Lake Duplex Demo — Closed Lost / Declined; excluded from all counts and Open Estimate Value.

### Scheduled Jobs

- Highland Bath Removal — ready, synced to Calendar, Crew 4 · Cade.
- Lakewood Retail Strip-Out — missing crew assignment.
- Arvada Pool House Removal — approved change before start, Crew 2 · Alex.

Crews are the live roster only: Crew 1 · Nick, Crew 2 · Alex, Crew 3 · Brady, Crew 4 · Cade.

### Jobs in Progress

- Riverside Retail Interior — At Risk because of labor and dump-fee forecast erosion; one approved change order.
- Westbrook Kitchen Demo — Watch because forecast profit retention is below plan.
- Federal Boulevard Offices — On Track with fresh data and favorable forecast.

### Complete Jobs

- Mountain View Offices — Reconciliation Required after a late Bill transaction.
- Cedar Ridge Garage Removal — financially closed with favorable actual margin.
- Capitol Hill Retail Demo — in Invoice Review.
- Boulder Kitchen Demo — Invoice Sent.

## 10. Prototype Interactions

The following interactions work locally in the browser:

- select August, July, or Year to Date;
- open a Work in Motion stage;
- switch among stage tabs;
- search by job, estimate, client, address, or identifier;
- filter by health or contextual status;
- open estimate and job detail;
- return to the prior list or dashboard;
- switch detail tabs;
- expand mobile financial detail;
- open preview panels for schedule, actual cost, change order, checklist, and activity actions;
- close panels with a button, Escape key, or backdrop click where appropriate.

Preview forms accept temporary input only. Submission shows a clear “prototype only” confirmation and does not mutate the financial model permanently.

## 11. Missing, Stale, and Exceptional Data

The UI must not silently substitute zero for unknown values.

- Missing values display as “Not available” or “Missing.”
- Stale actuals show the source and last-refresh age.
- Low confidence prevents an On Track status.
- Pending change orders display separately from approved revenue.
- Late costs on financially closed jobs display Reconciliation Required and preserve the prior close snapshot in the activity preview.
- Rows and cards remain understandable without color through explicit status text and icons.

## 12. Implementation Structure

The standalone file will contain:

- semantic HTML application regions;
- CSS custom properties for colors, spacing, typography, and status treatments;
- responsive layout rules without external frameworks;
- one immutable sample-data object;
- pure JavaScript calculation helpers for revenue, cost subtotals, job profit, margin, and health retention;
- a small client-side state object for current screen, period, stage, search, filters, selected record, active tab, and open preview panel;
- render functions for dashboard, stage workspace, estimate detail, job detail, and modal/panel content;
- event delegation for navigation and controls.

No network access, build tooling, external fonts, or third-party scripts are required.

## 13. Accessibility and Usability

- All interactive elements use buttons, links, form controls, or appropriate roles.
- Keyboard focus is visible.
- Status is expressed by words as well as color.
- Tables include meaningful headers.
- Modal previews trap focus where practical and restore focus on close.
- Tap targets are sized for phone use.
- Financial numbers use tabular numerals and consistent currency formatting.
- Negative cost and unfavorable variance treatments remain legible at common contrast levels.

## 14. Verification

Before delivery, verify:

1. The file opens directly in a browser without a server.
2. All dashboard stage cards navigate correctly.
3. Tabs, search, filters, back navigation, and period selection work.
4. Every representative record opens without console errors.
5. Revenue and profit arithmetic reconciles for each detailed sample job.
6. Approved change orders appear in Total Revenue; pending changes do not.
7. Gross Profit, Job Profit, and Job Profit Margin follow the approved formulas.
8. Health labels match the configured profit-retention and confidence rules.
9. Reconciliation Required and stale/missing-data examples remain visible.
10. Preview actions clearly disclose that they do not permanently save.
11. Layout remains usable at desktop, tablet, and narrow-phone widths.
12. The interface contains no use of the word “portfolio.”
13. Labor divided by $26 equals the productive hours displayed, and overhead divided by $23 equals
    the same figure, on every record and every column.
14. Stage names and crew names match the live pipeline and the live crew roster exactly.

## 15. Success Criterion

Dane can open one HTML file on a laptop or phone, understand the proposed operating model without explanation, navigate from the company snapshot to relevant work, inspect a job’s P&L and health drivers, and provide concrete feedback before production implementation begins.
