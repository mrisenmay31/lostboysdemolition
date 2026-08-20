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
assert.equal(data.records.length, 14, 'prototype includes all fourteen sample records');

const riverside = data.records.find((record) => record.id === 'JOB-1042');
assert.ok(riverside, 'Riverside at-risk sample exists');
const pnl = model.getPnl(riverside, 'forecast');
assert.equal(pnl.approvedRevenue, 36300);
assert.equal(pnl.changeOrderRevenue, 1500);
assert.equal(pnl.totalRevenue, 37800);
assert.equal(pnl.totalDirectCosts, 25260);
assert.equal(pnl.grossProfit, 12540);
assert.equal(pnl.jobProfit, 6840);
assert.equal(Number(pnl.jobProfitMargin.toFixed(3)), 0.181);
assert.equal(model.getHealth(riverside).label, 'At Risk');

assert.equal(model.getStageRecords(data.records, 'estimates').length, 4);
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
assert.equal(model.getHealth(data.records.find((record) => record.id === 'JOB-1038')).label, 'Watch');
assert.equal(model.getHealth(data.records.find((record) => record.id === 'JOB-1045')).label, 'On Track');
assert.equal(data.records.find((record) => record.id === 'JOB-1034').health.label, 'Reconciliation Required');

console.log('job-dashboard prototype model: PASS');
