// ============================================================
// Automation 2: "Update Invoice Line Items on Job Edit"
// Trigger: When record is updated → Jobs table
// Watch fields (12 flat LI fields):
//   fldmDhTI8cv8DDhVd, fld9Nh9HaRRYj9Hqx, fld6p8qo43OllIWj8, fldsbx7IGc3ACRvwx,
//   fld75RhQn42uA9aaR, fldBAG4h6qlMsfFIJ, fldZSXcTPCYojw7DB, fldOlkrEmc5Pe94Xv,
//   fldbymXYKV19BEg3b, fldQDaLjePgG6kPND, fldCVv7f1msG2F9KX, fldaJi5MNxZSB9NAx
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

const targets = [
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

// A slot is valid if it has a name. Zero-price items are valid — they appear
// on the invoice with name/description and $0.
const isValid = i => i.name.trim() !== '';

// Build a map of existing child LI records by sort order
const existingLinks = jobRecord.getCellValue(JOB.lineItemsLink) || [];
const existingBySort = {};

if (existingLinks.length > 0) {
  const recs = await lineItemsTable.selectRecordsAsync({
    recordIds: existingLinks.map(r => r.id),
    fields: [LI.sortOrder, LI.include],
  });
  for (const rec of recs.records) {
    const sort = rec.getCellValue(LI.sortOrder);
    if (sort != null) existingBySort[sort] = rec;
  }
}

// finalLinkedIds preserves ALL linked records (including soft-deleted ones)
// so the audit trail stays intact. The edge function filters by Include on Invoice.
const finalLinkedIds = [];

for (const target of targets) {
  const existing = existingBySort[target.sortOrder] || null;
  const valid    = isValid(target);

  if (valid && existing) {
    // Slot has data and a child record exists — update it
    const fields = {
      [LI.name]:      target.name.trim(),
      [LI.desc]:      target.desc.trim(),
      [LI.amount]:    target.price != null ? target.price : 0,
      [LI.quantity]:  target.qty   != null ? target.qty   : 1,
      [LI.sortOrder]: target.sortOrder,
      [LI.include]:   true,
    };
    if (target.scopeRef && target.scopeRef.length > 0) {
      fields[LI.scopeRef] = [{ id: target.scopeRef[0].id }];
    }
    await lineItemsTable.updateRecordAsync(existing.id, fields);
    finalLinkedIds.push(existing.id);
    console.log(`↻ Updated slot ${target.sortOrder}: "${target.name}"`);

  } else if (valid && !existing) {
    // Slot has data but no child record — create one
    const fields = {
      [LI.name]:      target.name.trim(),
      [LI.desc]:      target.desc.trim(),
      [LI.amount]:    target.price != null ? target.price : 0,
      [LI.quantity]:  target.qty   != null ? target.qty   : 1,
      [LI.sortOrder]: target.sortOrder,
      [LI.include]:   true,
      [LI.jobLink]:   [{ id: recordId }],
    };
    if (target.scopeRef && target.scopeRef.length > 0) {
      fields[LI.scopeRef] = [{ id: target.scopeRef[0].id }];
    }
    const newId = await lineItemsTable.createRecordAsync(fields);
    finalLinkedIds.push(newId);
    console.log(`+ Created slot ${target.sortOrder}: "${target.name}"`);

  } else if (!valid && existing) {
    // Slot was cleared — soft delete by setting Include on Invoice = false.
    // The record is preserved for audit; the billing system filters it out.
    await lineItemsTable.updateRecordAsync(existing.id, {
      [LI.include]: false,
    });
    finalLinkedIds.push(existing.id);
    console.log(`○ Soft-deleted slot ${target.sortOrder} (Include on Invoice = false)`);

  } else {
    // Slot is empty and no child record — nothing to do
    console.log(`— Slot ${target.sortOrder}: empty, no action.`);
  }
}

await jobsTable.updateRecordAsync(recordId, {
  [JOB.lineItemsLink]: finalLinkedIds.map(id => ({ id })),
});
console.log(`✅ Sync complete. ${finalLinkedIds.filter(id => !Object.values(existingBySort).find(r => r.id === id && r.getCellValue(LI.include) === false)).length} active, ${finalLinkedIds.length} total linked.`);
