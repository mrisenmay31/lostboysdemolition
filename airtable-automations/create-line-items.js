// ============================================================
// Automation 1: "Create Invoice Line Items from Job"
// Trigger: When record is created → Jobs table
// Condition: Line Item 1 (fldmDhTI8cv8DDhVd) is not empty
// Action: Run script
// Input variable: recordId → Airtable Record ID from trigger
// ============================================================

const { recordId } = input.config();

const JOBS_TABLE_ID       = 'tbl6WcLuLL0uUcpI1';
const LINE_ITEMS_TABLE_ID = 'tblTwK8K0HkyluBec';

const JOB = {
  li1Name:       'fldmDhTI8cv8DDhVd',
  li1Desc:       'fld9Nh9HaRRYj9Hqx',
  li1Qty:        'fld6p8qo43OllIWj8',
  li1Price:      'fldsbx7IGc3ACRvwx',
  li1Scope:      'fldOdV0naVJpNdZKc',
  li2Name:       'fld75RhQn42uA9aaR',
  li2Desc:       'fldBAG4h6qlMsfFIJ',
  li2Qty:        'fldZSXcTPCYojw7DB',
  li2Price:      'fldOlkrEmc5Pe94Xv',
  li2Scope:      'fldV3mBpnDm8qYTFn',
  li3Name:       'fldbymXYKV19BEg3b',
  li3Desc:       'fldQDaLjePgG6kPND',
  li3Qty:        'fldCVv7f1msG2F9KX',
  li3Price:      'fldaJi5MNxZSB9NAx',
  li3Scope:      'fldXbHvXSEGOqTnDx',
  lineItemsLink: 'fldD6xumylrVQEVMo',
};

const LI = {
  name:      'fldva3wLkKqJD7t7r',
  desc:      'fldWGM7wIVac7rxEy',
  amount:    'fldR0cBZlSC25CXhq',
  quantity:  'fldLP3TR2pveYKFOc',
  sortOrder: 'fld5kCTH3LByLIFT8',
  include:   'fldBo2XaZZHFIzJT5',
  jobLink:   'fldh9U7Gxh2kYMmqN',
  scopeRef:  'flddQSYDsgnunFlnO',
};

const jobsTable      = base.getTable(JOBS_TABLE_ID);
const lineItemsTable = base.getTable(LINE_ITEMS_TABLE_ID);

const jobRecord = await jobsTable.selectRecordAsync(recordId, {
  fields: Object.values(JOB),
});
if (!jobRecord) { console.error('Job not found.'); return; }

// Idempotency: skip if Invoice Line Items already exist for this job
const existingLinks = jobRecord.getCellValue(JOB.lineItemsLink);
if (existingLinks && existingLinks.length > 0) {
  console.log('Line items already exist. Skipping.');
  return;
}

const candidates = [
  {
    sortOrder: 1,
    name:      jobRecord.getCellValueAsString(JOB.li1Name),
    desc:      jobRecord.getCellValueAsString(JOB.li1Desc),
    qty:       jobRecord.getCellValue(JOB.li1Qty),
    price:     jobRecord.getCellValue(JOB.li1Price),
    scopeRef:  jobRecord.getCellValue(JOB.li1Scope),
  },
  {
    sortOrder: 2,
    name:      jobRecord.getCellValueAsString(JOB.li2Name),
    desc:      jobRecord.getCellValueAsString(JOB.li2Desc),
    qty:       jobRecord.getCellValue(JOB.li2Qty),
    price:     jobRecord.getCellValue(JOB.li2Price),
    scopeRef:  jobRecord.getCellValue(JOB.li2Scope),
  },
  {
    sortOrder: 3,
    name:      jobRecord.getCellValueAsString(JOB.li3Name),
    desc:      jobRecord.getCellValueAsString(JOB.li3Desc),
    qty:       jobRecord.getCellValue(JOB.li3Qty),
    price:     jobRecord.getCellValue(JOB.li3Price),
    scopeRef:  jobRecord.getCellValue(JOB.li3Scope),
  },
];

// Include any slot where the name is present, even if price is $0.
// Zero-price items will appear on the invoice with name/description and $0.
// The edge function's lump-sum fallback handles the case where all amounts are 0.
const validItems = candidates.filter(i => i.name.trim() !== '');

if (validItems.length === 0) {
  console.log('No named line items found. Nothing to create.');
  return;
}

const createdIds = [];
for (const item of validItems) {
  const fields = {
    [LI.name]:      item.name.trim(),
    [LI.desc]:      item.desc.trim(),
    [LI.amount]:    item.price != null ? item.price : 0,
    [LI.quantity]:  item.qty  != null ? item.qty   : 1,
    [LI.sortOrder]: item.sortOrder,
    [LI.include]:   true,
    [LI.jobLink]:   [{ id: recordId }],
  };
  if (item.scopeRef && item.scopeRef.length > 0) {
    fields[LI.scopeRef] = [{ id: item.scopeRef[0].id }];
  }
  const newId = await lineItemsTable.createRecordAsync(fields);
  createdIds.push(newId);
  console.log(`✓ "${item.name}" | $${item.price ?? 0} × ${item.qty ?? 1} | Sort: ${item.sortOrder}`);
}

await jobsTable.updateRecordAsync(recordId, {
  [JOB.lineItemsLink]: createdIds.map(id => ({ id })),
});
console.log(`✅ ${createdIds.length} line item(s) created for job ${recordId}`);
