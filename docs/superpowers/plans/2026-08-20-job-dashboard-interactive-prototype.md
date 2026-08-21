# Job Dashboard Interactive Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one directly openable, responsive HTML file that lets Dane explore a fictitious Lost Boys Demolition job dashboard, stage workspaces, estimate details, job P&Ls, health conditions, and preview actions.

**Architecture:** The prototype is a single HTML document with embedded CSS and three embedded scripts: immutable sample data, a pure calculation/query model, and a DOM renderer. A dependency-free Node test extracts and evaluates the data/model scripts to verify arithmetic, health rules, stage grouping, search, and script syntax without requiring a browser server.

**Tech Stack:** HTML5, CSS custom properties and media queries, browser JavaScript, Node.js built-ins (`assert`, `fs`, `vm`).

## Global Constraints

- The deliverable must open directly from `file://`; no server, build step, network access, external font, framework, or third-party script is allowed.
- The interface title is **Job Dashboard**; the interface must not contain the word “portfolio.”
- Approved Revenue excludes change orders; Total Revenue equals Approved Revenue plus fully approved Change Order Revenue.
- P&L order is Revenue → Direct Costs → Gross Profit → Overhead Allocation → Processing Fees → Job Profit → Job Profit Margin.
- Draft, pending, declined, and unapproved change orders must remain outside Total Revenue.
- Desktop and phone must preserve the same decision hierarchy.
- Prototype actions may accept temporary input but must disclose that nothing is permanently saved.
- Refreshing the page resets all state to the original fictitious data.

---

## File Structure

- `docs/prototypes/lost-boys-job-dashboard-prototype.html` — complete deliverable: markup, styles, data, model, renderers, and interactions.
- `tests/job-dashboard-prototype.test.mjs` — dependency-free structural, arithmetic, grouping, health, search, and syntax verification.

### Task 1: Build the Tested Sample-Data and Financial Model

**Files:**
- Create: `docs/prototypes/lost-boys-job-dashboard-prototype.html`
- Create: `tests/job-dashboard-prototype.test.mjs`

**Interfaces:**
- Produces: `window.JobDashboardData` with `periods`, `records`, and `actions`.
- Produces: `window.JobDashboardModel` with `money`, `percent`, `getPnl`, `getHealth`, `getStageGroup`, `getStageRecords`, `searchRecords`, and `getPeriodMetrics`.
- `getPnl(record, column)` returns `{ approvedRevenue, changeOrderRevenue, totalRevenue, directCosts, totalDirectCosts, grossProfit, overhead, processingFees, jobProfit, jobProfitMargin }`.

- [ ] **Step 1: Write the failing dependency-free model test**

Create `tests/job-dashboard-prototype.test.mjs` with extraction and evaluation logic:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const path = new URL('../docs/prototypes/lost-boys-job-dashboard-prototype.html', import.meta.url);
const html = fs.readFileSync(path, 'utf8');

function script(id) {
  const match = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `missing script #${id}`);
  return match[1];
}

const context = vm.createContext({ window: {}, Intl, Date, console });
vm.runInContext(script('prototype-data'), context);
vm.runInContext(script('prototype-model'), context);

const { JobDashboardData: data, JobDashboardModel: model } = context.window;
assert.equal(data.records.length, 15);

const riverside = data.records.find((record) => record.id === 'JOB-1042');
const pnl = model.getPnl(riverside, 'forecast');
assert.equal(pnl.approvedRevenue, 36300);
assert.equal(pnl.changeOrderRevenue, 1500);
assert.equal(pnl.totalRevenue, 37800);
assert.equal(pnl.totalDirectCosts, 21326);
assert.equal(pnl.grossProfit, 16474);
assert.equal(pnl.jobProfit, 6848);
assert.equal(Number(pnl.jobProfitMargin.toFixed(3)), 0.181);
assert.equal(model.getHealth(riverside).label, 'At Risk');

assert.equal(model.getStageRecords(data.records, 'estimates').length, 5);
assert.equal(model.getStageRecords(data.records, 'scheduled').length, 3);
assert.equal(model.getStageRecords(data.records, 'in-progress').length, 3);
assert.equal(model.getStageRecords(data.records, 'complete').length, 4);
assert.equal(model.searchRecords(data.records, 'Apex').length, 1);
assert.doesNotMatch(html, /portfolio/i);
console.log('job-dashboard prototype model: PASS');
```

- [ ] **Step 2: Run the test and confirm the missing-file failure**

Run:

```bash
node tests/job-dashboard-prototype.test.mjs
```

Expected: FAIL with `ENOENT` for `docs/prototypes/lost-boys-job-dashboard-prototype.html`.

- [ ] **Step 3: Create the HTML shell and immutable sample data**

Create the semantic shell and `prototype-data` script:

```html
<body>
  <a class="skip-link" href="#app">Skip to dashboard</a>
  <div id="app"></div>
  <div id="modal-root"></div>
  <div id="toast-root" aria-live="polite"></div>

  <script id="prototype-data">
    const records = [
      { id: 'EST-2018', name: 'Oak Street Garage Removal', kind: 'estimate', stageGroup: 'estimates', stage: 'Quote Sent', client: 'Aaron Cole', estimateValue: 18450 },
      { id: 'EST-2021', name: 'Summit Dental Selective Demo', kind: 'estimate', stageGroup: 'estimates', stage: 'Estimate in Progress', client: 'Summit Dental Partners', estimateValue: 32100 },
      { id: 'EST-2016', name: 'Glenarm Home Interior Demo', kind: 'estimate', stageGroup: 'estimates', stage: 'Quote Accepted', client: 'Tessa Morgan', estimateValue: 24750 },
      { id: 'EST-2024', name: 'Cherry Creek Basement Demo', kind: 'estimate', stageGroup: 'estimates', stage: 'Intake / Qualification', client: 'Elliot Shaw', estimateValue: 51500 },
      { id: 'JOB-1046', name: 'Highland Bath Removal', kind: 'job', stageGroup: 'scheduled', stage: 'Job Scheduled', client: 'Maya Dalton', approvedRevenue: 12600 },
      { id: 'JOB-1047', name: 'Lakewood Retail Strip-Out', kind: 'job', stageGroup: 'scheduled', stage: 'Job Scheduled', client: 'FrontRange Retail Group', approvedRevenue: 28400 },
      { id: 'JOB-1048', name: 'Arvada Pool House Removal', kind: 'job', stageGroup: 'scheduled', stage: 'Job Scheduled', client: 'Sawyer Construction', approvedRevenue: 17240 },
      { id: 'JOB-1042', name: 'Riverside Retail Interior', kind: 'job', stageGroup: 'in-progress', stage: 'Job In Progress', client: 'Apex Commercial Group', approvedRevenue: 36300, approvedChangeOrderRevenue: 1500, forecastJobProfit: 6840 },
      { id: 'JOB-1038', name: 'Westbrook Kitchen Demo', kind: 'job', stageGroup: 'in-progress', stage: 'Job In Progress', client: 'Maria Ellison', approvedRevenue: 14580, forecastJobProfit: 3120 },
      { id: 'JOB-1045', name: 'Federal Boulevard Offices', kind: 'job', stageGroup: 'in-progress', stage: 'Job In Progress', client: 'Northline Builders', approvedRevenue: 29100, forecastJobProfit: 8760 },
      { id: 'JOB-1034', name: 'Mountain View Offices', kind: 'job', stageGroup: 'complete', stage: 'Job Completed', client: 'Peakstone Development', approvedRevenue: 32980 },
      { id: 'JOB-1031', name: 'Cedar Ridge Garage Removal', kind: 'job', stageGroup: 'complete', stage: 'Paid / Closed Won', client: 'Drew Harmon', approvedRevenue: 11800 },
      { id: 'JOB-1036', name: 'Capitol Hill Retail Demo', kind: 'job', stageGroup: 'complete', stage: 'Invoice Review', client: 'Juniper Retail LLC', approvedRevenue: 22140 },
      { id: 'JOB-1037', name: 'Boulder Kitchen Demo', kind: 'job', stageGroup: 'complete', stage: 'Invoice Sent', client: 'Lena Ortiz', approvedRevenue: 15760 }
    ];
    window.JobDashboardData = Object.freeze({ periods: ['august', 'july', 'ytd'], records });
  </script>
</body>
```

Use the exact 14-record manifest above. Add the fields required by the design—address, estimator, dates, crew, confidence, freshness, progress, crew-days, activity, exceptions, and original/current/actual/forecast financial columns—to each manifest entry. Riverside forecast values must reconcile to Total Revenue `$37,800`, Total Direct Costs `$21,326`, Gross Profit `$16,474`, Job Profit `$6,848`, and Job Profit Margin `18.1%`; the remaining job records must use internally consistent values that exercise On Track, Watch, missing-crew, invoice, closed, and Reconciliation Required states.

**Labor, overhead, and processing fees are derived, never hand-entered.** Each financial column carries a `productiveHours` figure; labor is `hours × $26`, overhead is `hours × $23` on the same hours, and processing fees are `3.5%` of recognised revenue. A pre-start column passes `{ started: false }` so it posts zero costs and zero fees. This is what keeps allocated overhead moving in the same direction as labor.

- [ ] **Step 4: Implement the pure model**

Embed the model in `script#prototype-model`:

```js
window.JobDashboardModel = (() => {
  const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
  const money = (value) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  }).format(value);
  const percent = (value) => new Intl.NumberFormat('en-US', {
    style: 'percent', maximumFractionDigits: 1
  }).format(value);

  function getPnl(record, column) {
    const financial = record.financials[column];
    const approvedRevenue = financial.approvedRevenue;
    const changeOrderRevenue = financial.approvedChangeOrderRevenue;
    const totalRevenue = approvedRevenue + changeOrderRevenue;
    const totalDirectCosts = sum(Object.values(financial.directCosts));
    const grossProfit = totalRevenue - totalDirectCosts;
    const jobProfit = grossProfit - financial.overhead - financial.processingFees;
    return {
      approvedRevenue,
      changeOrderRevenue,
      totalRevenue,
      directCosts: financial.directCosts,
      totalDirectCosts,
      grossProfit,
      overhead: financial.overhead,
      processingFees: financial.processingFees,
      jobProfit,
      jobProfitMargin: totalRevenue ? jobProfit / totalRevenue : 0
    };
  }

  function getHealth(record) {
    if (record.kind !== 'job' || record.stageGroup !== 'in-progress') return record.health;
    const current = getPnl(record, 'current').jobProfit;
    const forecast = getPnl(record, 'forecast').jobProfit;
    const retention = current ? forecast / current : 0;
    if (forecast < 0 || retention < 0.75) return { label: 'At Risk', tone: 'risk', retention };
    if (retention < 0.9 || record.confidence !== 'High' || record.dataFreshness !== 'Fresh') {
      return { label: 'Watch', tone: 'watch', retention };
    }
    return { label: 'On Track', tone: 'track', retention };
  }

  const getStageGroup = (record) => record.stageGroup;
  const getStageRecords = (records, group) => records.filter((record) => getStageGroup(record) === group);
  const searchRecords = (records, query) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) => [record.id, record.name, record.client, record.address]
      .join(' ').toLowerCase().includes(needle));
  };

  function getPeriodMetrics(records, period) {
    const included = records.filter((record) => record.periods.includes(period));
    const official = included.filter((record) => record.kind === 'job');
    const estimates = included.filter((record) => record.stageGroup === 'estimates' && record.stage !== 'Closed Lost');
    return {
      approvedRevenue: sum(official.map((record) => getPnl(record, 'current').totalRevenue)),
      forecastJobProfit: sum(official.map((record) => getPnl(record, 'forecast').jobProfit)),
      actualCommittedCosts: sum(official.map((record) => {
        const pnl = getPnl(record, 'actual');
        return pnl.totalDirectCosts + pnl.overhead + pnl.processingFees;
      })),
      openEstimateValue: sum(estimates.map((record) => record.estimateValue))
    };
  }

  return { money, percent, getPnl, getHealth, getStageGroup, getStageRecords, searchRecords, getPeriodMetrics };
})();
```

- [ ] **Step 5: Run the model test and confirm it passes**

Run:

```bash
node tests/job-dashboard-prototype.test.mjs
```

Expected: `job-dashboard prototype model: PASS`.

- [ ] **Step 6: Commit the tested model foundation**

```bash
git add docs/prototypes/lost-boys-job-dashboard-prototype.html tests/job-dashboard-prototype.test.mjs
git commit -m "feat: add job dashboard prototype model"
```

### Task 2: Implement Dashboard and Stage Workspace Navigation

**Files:**
- Modify: `docs/prototypes/lost-boys-job-dashboard-prototype.html`
- Modify: `tests/job-dashboard-prototype.test.mjs`

**Interfaces:**
- Consumes: `JobDashboardData.records` and all `JobDashboardModel` query/formatting helpers.
- Produces: `state = { screen, period, stage, query, healthFilter, selectedId, detailTab, modal }`.
- Produces: `renderDashboard()`, `renderStageWorkspace()`, `navigate(screen, options)`, and `render()`.

- [ ] **Step 1: Extend the test with structural UI requirements**

Add assertions:

```js
for (const id of ['app', 'modal-root', 'toast-root']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
for (const fn of ['renderDashboard', 'renderStageWorkspace', 'navigate', 'render']) {
  assert.match(html, new RegExp(`function ${fn}\\(`));
}
for (const label of ['Job Dashboard', 'Work in Motion', 'Needs Attention', 'Live Job Health']) {
  assert.match(html, new RegExp(label));
}
```

- [ ] **Step 2: Run the test and confirm missing-renderer failure**

Run `node tests/job-dashboard-prototype.test.mjs`.

Expected: FAIL because `renderDashboard` is absent.

- [ ] **Step 3: Add responsive visual tokens and application shell styles**

Define exact primitives in embedded CSS:

```css
:root {
  --ink: #192534; --muted: #697585; --surface: #ffffff; --canvas: #edf0f3;
  --line: #dfe4e9; --accent: #e45a34; --success: #27834e;
  --warning: #9f6700; --danger: #b63831; --radius: 14px;
}
body { margin: 0; background: var(--canvas); color: var(--ink); font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
button, input, select { font: inherit; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid rgba(228,90,52,.3); outline-offset: 2px; }
@media (max-width: 760px) { .desktop-table { display: none; } .mobile-cards { display: grid; } }
```

Implement a white global navigation bar, dark navy business snapshot, four Work in Motion cards, white exception panels, status pills, desktop tables, mobile cards, and bottom mobile navigation.

- [ ] **Step 4: Implement state, dashboard rendering, and period selection**

Use a single state object:

```js
const state = {
  screen: 'dashboard', period: 'august', stage: 'in-progress', query: '',
  healthFilter: 'all', selectedId: null, detailTab: 'overview', modal: null
};

function navigate(screen, options = {}) {
  Object.assign(state, options, { screen });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}
```

`renderDashboard()` must calculate headline metrics from the model, render stage counts and values, show three action-queue examples, and render all active-job health states. Stage-card buttons use `data-stage` and navigate to the workspace.

- [ ] **Step 5: Implement the shared stage workspace**

`renderStageWorkspace()` must:

1. show all four stage tabs;
2. preserve the selected stage;
3. apply search and health filters;
4. render stage-specific columns on desktop;
5. render touch-friendly cards on phone;
6. show explicit empty-state copy when no records match;
7. open estimate or job detail through `data-record-id`.

- [ ] **Step 6: Add delegated event handling**

Use one click listener and targeted input/change listeners:

```js
document.addEventListener('click', (event) => {
  const stage = event.target.closest('[data-stage]');
  if (stage) return navigate('workspace', { stage: stage.dataset.stage, query: '', healthFilter: 'all' });
  const record = event.target.closest('[data-record-id]');
  if (record) return navigate('detail', { selectedId: record.dataset.recordId, detailTab: 'overview' });
  const back = event.target.closest('[data-back]');
  if (back) return navigate(back.dataset.back);
});
```

- [ ] **Step 7: Run tests and commit dashboard/workspace navigation**

Run `node tests/job-dashboard-prototype.test.mjs`.

Expected: PASS.

```bash
git add docs/prototypes/lost-boys-job-dashboard-prototype.html tests/job-dashboard-prototype.test.mjs
git commit -m "feat: add dashboard and job stage navigation"
```

### Task 3: Implement Estimate and Job Detail Experiences

**Files:**
- Modify: `docs/prototypes/lost-boys-job-dashboard-prototype.html`
- Modify: `tests/job-dashboard-prototype.test.mjs`

**Interfaces:**
- Consumes: `state.selectedId`, `state.detailTab`, `JobDashboardModel.getPnl`, and `JobDashboardModel.getHealth`.
- Produces: `renderEstimateDetail(record)`, `renderJobDetail(record)`, `renderPnl(record)`, `openModal(type, record)`, `closeModal()`, and `showToast(message)`.

- [ ] **Step 1: Add failing detail/P&L assertions**

Add:

```js
for (const fn of ['renderEstimateDetail', 'renderJobDetail', 'renderPnl', 'openModal', 'closeModal']) {
  assert.match(html, new RegExp(`function ${fn}\\(`));
}
for (const label of [
  'Approved Revenue', 'Approved Change Order Revenue', 'Total Revenue', 'Total Direct Costs',
  'Gross Profit', 'Overhead Allocation', 'Processing Fees', 'Job Profit', 'Job Profit Margin'
]) assert.match(html, new RegExp(label));
```

- [ ] **Step 2: Run the test and confirm missing-detail failure**

Run `node tests/job-dashboard-prototype.test.mjs`.

Expected: FAIL because `renderEstimateDetail` is absent.

- [ ] **Step 3: Implement estimate detail**

Render estimate identity, client/site, estimator, stage, next action, estimate value, labor assumption, direct costs, overhead, processing fees, job profit, margin, and quote activity. Quote Accepted records expose a prominent `Schedule Job` preview action while remaining labeled “Pre-job estimate.”

- [ ] **Step 4: Implement job overview and health explanation**

Render health and confidence first, then forecast job profit, forecast margin, Total Revenue, a plain-language health explanation, progress, crew-days used/remaining, labor hours, source freshness, and recommended actions.

Use explicit phrases for the sample conditions:

- Riverside: `Labor is the primary source of forecast erosion.`
- Westbrook: `Forecast profit retention is below the approved plan.`
- Federal Boulevard: `Fresh actuals and the crew forecast support the approved plan.`
- Mountain View: `A late Bill transaction requires reconciliation.`

- [ ] **Step 5: Implement the P&L renderer**

`renderPnl(record)` must render the approved row order and five comparison columns. Costs display in parentheses. Unfavorable forecast variances receive text and color treatment. Mobile initially combines non-labor direct costs; a `Show all direct costs` button reveals the full list.

- [ ] **Step 6: Implement detail tabs and preview modals**

Tabs: Overview, Financials, Change Orders, Checklists, Activity.

Preview actions: Edit Schedule, Add Actual Cost, Add Change Order, Open Checklist, View Activity. Each modal contains realistic labeled fields, a close button, and this disclosure:

`Prototype only — this information will not be permanently saved.`

Submitting a preview form closes the modal and calls `showToast('Prototype entry recorded for this demo only.')` without changing financial data.

Escape and backdrop clicks close the modal. Opening stores the previously focused element; closing restores it.

- [ ] **Step 7: Run tests and commit detail interactions**

Run `node tests/job-dashboard-prototype.test.mjs`.

Expected: PASS.

```bash
git add docs/prototypes/lost-boys-job-dashboard-prototype.html tests/job-dashboard-prototype.test.mjs
git commit -m "feat: add estimate and job profitability details"
```

### Task 4: Verify the Directly Openable Prototype

**Files:**
- Modify: `docs/prototypes/lost-boys-job-dashboard-prototype.html`
- Modify: `tests/job-dashboard-prototype.test.mjs`

**Interfaces:**
- Consumes: the completed standalone prototype.
- Produces: a verified deliverable that opens directly without a local server.

- [ ] **Step 1: Add syntax and accessibility-oriented static checks**

Extend the test to compile every inline JavaScript block and assert essential semantics:

```js
for (const id of ['prototype-data', 'prototype-model', 'prototype-app']) {
  new vm.Script(script(id), { filename: `${id}.js` });
}
assert.match(html, /class="skip-link"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /aria-modal="true"/);
assert.match(html, /@media \(max-width: 760px\)/);
```

- [ ] **Step 2: Run full automated verification**

Run:

```bash
node tests/job-dashboard-prototype.test.mjs
git diff --check
```

Expected:

- `job-dashboard prototype model: PASS`
- `git diff --check` exits 0 with no output.

- [ ] **Step 3: Verify requirement copy and sample conditions**

Run:

```bash
rg -n "Job Dashboard|Work in Motion|Needs Attention|Live Job Health|Approved Change Order Revenue|Reconciliation Required|Prototype only" docs/prototypes/lost-boys-job-dashboard-prototype.html
rg -ni "portfolio" docs/prototypes/lost-boys-job-dashboard-prototype.html
```

Expected: the first command finds each required phrase; the second command exits 1 with no matches.

- [ ] **Step 4: Open the file directly for visual and interaction verification**

Run:

```bash
open docs/prototypes/lost-boys-job-dashboard-prototype.html
```

Verify manually at wide and narrow browser widths:

1. August is the default period; July and YTD update totals.
2. All four Work in Motion cards and tabs navigate.
3. Search and health filtering change visible results.
4. Every sample record opens.
5. Riverside shows `$37,800` Total Revenue and `$6,848` forecast Job Profit.
6. Change Orders, Checklists, Activity, schedule, and actual-cost previews open and close.
7. Refresh returns to the dashboard and original data.

- [ ] **Step 5: Commit final verification adjustments**

```bash
git add docs/prototypes/lost-boys-job-dashboard-prototype.html tests/job-dashboard-prototype.test.mjs
git commit -m "test: verify standalone job dashboard prototype"
```

## Completion Output

Hand off:

- clickable local path to `docs/prototypes/lost-boys-job-dashboard-prototype.html`;
- automated test result;
- concise interaction summary;
- explicit note that all records are fictitious and preview actions do not save;
- any browser-only behavior that could not be automatically verified.
