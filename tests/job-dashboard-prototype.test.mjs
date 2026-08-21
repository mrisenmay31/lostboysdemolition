import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const prototypePath = new URL('../docs/prototypes/lost-boys-job-dashboard-prototype.html', import.meta.url);
const html = fs.readFileSync(prototypePath, 'utf8');

function script(id) {
  const match = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `missing script #${id}`);
  return match[1];
}

const context = vm.createContext({ window: {}, Intl, Date, console });
vm.runInContext(script('prototype-data'), context);
vm.runInContext(script('prototype-model'), context);

const { JobDashboardData: data, JobDashboardModel: model } = context.window;
assert.equal(data.records.length, 15, 'prototype includes all fifteen sample records');

const riverside = data.records.find((record) => record.id === 'JOB-1042');
assert.ok(riverside, 'Riverside at-risk sample exists');
const pnl = model.getPnl(riverside, 'forecast');
assert.equal(pnl.approvedRevenue, 36300);
assert.equal(pnl.changeOrderRevenue, 1500);
assert.equal(pnl.totalRevenue, 37800);
assert.equal(pnl.totalDirectCosts, 21326);
assert.equal(pnl.grossProfit, 16474);
assert.equal(pnl.jobProfit, 6848);
assert.equal(Number(pnl.jobProfitMargin.toFixed(3)), 0.181);

// Labor and allocated overhead must both fall out of the same productive-hour count.
const RATES = data.rates;
assert.equal(RATES.laborPerHour, 26);
assert.equal(RATES.overheadPerHour, 23);
assert.equal(RATES.ccFeeRate, 0.035);
for (const record of data.records.filter((r) => r.kind === 'job')) {
  for (const columnName of ['original', 'current', 'actual', 'forecast']) {
    const column = record.financials[columnName];
    const hours = column.productiveHours;
    assert.equal(column.directCosts.labor, Math.round(hours * RATES.laborPerHour),
      `${record.id}.${columnName} labor = hours x $26`);
    assert.equal(column.overhead, Math.round(hours * RATES.overheadPerHour),
      `${record.id}.${columnName} overhead = hours x $23`);
    const revenue = column.approvedRevenue + column.approvedChangeOrderRevenue;
    assert.equal(column.processingFees, column.started ? Math.round(revenue * RATES.ccFeeRate) : 0,
      `${record.id}.${columnName} processing fees at 3.5% of recognised revenue`);
  }
}

// A job that has not started carries no posted costs at all.
for (const id of ['JOB-1046', 'JOB-1047', 'JOB-1048']) {
  const actual = data.records.find((r) => r.id === id).financials.actual;
  assert.equal(actual.started, false, `${id} actual column is pre-start`);
  assert.equal(model.getPnl(data.records.find((r) => r.id === id), 'actual').totalDirectCosts, 0);
  assert.equal(actual.processingFees, 0, `${id} posts no processing fee before it starts`);
}
assert.equal(model.getHealth(riverside).label, 'At Risk');

assert.equal(model.getStageRecords(data.records, 'estimates').length, 5);
assert.equal(model.getStageRecords(data.records, 'estimates').filter(model.isOpenEstimate).length, 4,
  'Closed Lost / Declined is excluded from open estimate counts');
assert.equal(model.getStageRecords(data.records, 'scheduled').length, 3);
assert.equal(model.getStageRecords(data.records, 'in-progress').length, 3);
assert.equal(model.getStageRecords(data.records, 'complete').length, 4);
assert.equal(model.searchRecords(data.records, 'Apex').length, 1);
assert.doesNotMatch(html, /portfolio/i);

for (const id of ['app', 'modal-root', 'toast-root']) {
  assert.match(html, new RegExp(`id="${id}"`), `includes #${id}`);
}

for (const functionName of ['renderDashboard', 'renderStageWorkspace', 'navigate', 'render']) {
  assert.match(html, new RegExp(`function ${functionName}\\(`), `includes ${functionName}()`);
}

for (const label of ['Job Dashboard', 'Work in Motion', 'Needs Attention', 'Live Job Health']) {
  assert.match(html, new RegExp(label), `includes ${label}`);
}

for (const functionName of ['renderEstimateDetail', 'renderJobDetail', 'renderPnl', 'openModal', 'closeModal']) {
  assert.match(html, new RegExp(`function ${functionName}\\(`), `includes ${functionName}()`);
}

for (const label of [
  'Total Revenue',
  'Approved Revenue',
  'Approved Change Order Revenue',
  'Total Revenue',
  'Total Direct Costs',
  'Gross Profit',
  'Overhead Allocation',
  'Processing Fees',
  'Job Profit',
  'Job Profit Margin'
]) {
  assert.match(html, new RegExp(label), `includes P&L label ${label}`);
}

// Mid-job actuals: derived profit is withheld, cost completion replaces it as the burn signal.
assert.match(html, /In progress/, 'in-progress actual columns state their condition');
assert.match(html, /Not started/, 'pre-start actual columns state their condition');
for (const id of ['JOB-1042', 'JOB-1038', 'JOB-1045']) {
  const record = data.records.find((r) => r.id === id);
  const cost = model.getCostCompletion(record);
  assert.ok(cost, `${id} exposes cost completion`);
  assert.ok(cost.pct > 0 && cost.pct < 2, `${id} cost completion is a sane ratio`);
  const expected = ['actual', 'current'].map((columnName) => {
    const pnl = model.getPnl(record, columnName);
    return pnl.totalDirectCosts + pnl.overhead + pnl.processingFees;
  });
  assert.equal(cost.posted, expected[0], `${id} posted cost = actual direct + overhead + fees`);
  assert.equal(cost.budget, expected[1], `${id} budget = current approved direct + overhead + fees`);
}
// A job that has not started has no cost-completion figure at all.
for (const id of ['JOB-1046', 'JOB-1047', 'JOB-1048']) {
  assert.equal(model.getCostCompletion(data.records.find((r) => r.id === id)), null,
    `${id} reports no cost completion before it starts`);
}
// The burn signal must corroborate health, not contradict it: the At Risk job is spending
// furthest ahead of its reported completion.
const burn = (id) => {
  const record = data.records.find((r) => r.id === id);
  return Math.round(model.getCostCompletion(record).pct * 100) - record.progress;
};
assert.ok(burn('JOB-1042') > burn('JOB-1038'), 'At Risk job is spending further ahead than the Watch job');
assert.ok(burn('JOB-1038') > burn('JOB-1045'), 'Watch job is spending further ahead than the On Track job');

for (const id of ['prototype-data', 'prototype-model', 'prototype-app']) {
  new vm.Script(script(id), { filename: `${id}.js` });
}

assert.match(html, /class="skip-link"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /aria-modal="true"/);
assert.match(html, /@media \(max-width: 760px\)/);
assert.match(html, /Prototype only — this information will not be permanently saved\./);
assert.match(html, /@media \(max-width: 760px\)[\s\S]*?\.snapshot-heading \{[^}]*flex-direction: column;/, 'phone snapshot stacks period control');
assert.match(html, /@media \(max-width: 420px\)[\s\S]*?\.demo-chip \{ display: none; \}/, 'narrow header hides demo badge');

const pendingChange = riverside.changeOrders.find((change) => change.status === 'Pending');
assert.ok(pendingChange, 'Riverside includes a pending change-order example');
assert.equal(model.getPnl(riverside, 'current').totalRevenue, 37800, 'pending change remains outside Total Revenue');

// Headline metrics must distinguish Approved Revenue from Total Revenue.
const august = model.getPeriodMetrics(data.records, 'august');
assert.equal(august.approvedRevenue, 207660, 'Approved Revenue excludes change orders');
assert.equal(august.changeOrderRevenue, 2940);
assert.equal(august.totalRevenue, 210600, 'Total Revenue = Approved + approved change orders');
assert.equal(august.approvedRevenue + august.changeOrderRevenue, august.totalRevenue);

// Closed Lost value never reaches Open Estimate Value.
const closedLost = data.records.find((record) => record.closedLost);
assert.ok(closedLost, 'a Closed Lost / Declined estimate exists');
assert.ok(!model.isOpenEstimate(closedLost));
assert.ok(august.openEstimateValue < data.records.filter((r) => r.kind === 'estimate')
  .reduce((total, r) => total + r.estimateValue, 0), 'Closed Lost excluded from Open Estimate Value');

// Crews mirror the live roster, and stages mirror the live 12-stage pipeline.
const LIVE_STAGES = new Set(['New Lead', 'Intake / Qualification', 'Estimate in Progress', 'Quote Sent',
  'Quote Accepted', 'Job Scheduled', 'Job In Progress', 'Job Completed', 'Invoice Review', 'Invoice Sent',
  'Paid / Closed Won', 'Closed Lost / Declined']);
for (const record of data.records) {
  assert.ok(LIVE_STAGES.has(record.stage), `${record.id} stage "${record.stage}" mirrors the live pipeline`);
}
const CREWS = new Set(['Crew 1 · Nick', 'Crew 2 · Alex', 'Crew 3 · Brady', 'Crew 4 · Cade', 'Missing']);
for (const record of data.records.filter((r) => r.kind === 'job')) {
  assert.ok(CREWS.has(record.crew), `${record.id} crew "${record.crew}" is Crew 1-4 or unassigned`);
}
assert.doesNotMatch(html, /Crew [ABC]\b/, 'no letter-named crews remain');
assert.equal(model.getHealth(data.records.find((record) => record.id === 'JOB-1038')).label, 'Watch');
assert.equal(model.getHealth(data.records.find((record) => record.id === 'JOB-1045')).label, 'On Track');
assert.equal(data.records.find((record) => record.id === 'JOB-1034').health.label, 'Reconciliation Required');

console.log('job-dashboard prototype model: PASS');
