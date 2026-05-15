require('dotenv').config();
const fs = require('fs');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

if (!GHL_API_KEY || !GHL_LOCATION_ID) {
  console.error('ERROR: GHL_API_KEY and GHL_LOCATION_ID must be set in .env');
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const FIELD_DEFS = [
  // Group 1 — Job Info
  { group: 'Group 1 — Job Info', label: 'Job Address', dataType: 'TEXT' },
  { group: 'Group 1 — Job Info', label: 'Job Type', dataType: 'SINGLE_OPTIONS', options: ['Residential', 'Commercial'] },
  { group: 'Group 1 — Job Info', label: 'Engagement Type', dataType: 'SINGLE_OPTIONS', options: ['Contractor Job', 'Homeowner Direct', 'Subcontract Work'] },
  { group: 'Group 1 — Job Info', label: 'Estimator', dataType: 'SINGLE_OPTIONS', options: ['Dane', 'Jackson'] },

  // Group 2 — Estimate
  { group: 'Group 2 — Estimate', label: 'Estimated Labor Hours', dataType: 'NUMERICAL' },
  { group: 'Group 2 — Estimate', label: 'Estimated Labor Cost', dataType: 'MONETORY' },
  { group: 'Group 2 — Estimate', label: 'Estimated Materials', dataType: 'MONETORY' },
  { group: 'Group 2 — Estimate', label: 'Estimated Dump Fees', dataType: 'MONETORY' },
  { group: 'Group 2 — Estimate', label: 'Estimated Overhead', dataType: 'MONETORY' },
  { group: 'Group 2 — Estimate', label: 'Estimated Profit', dataType: 'MONETORY' },
  { group: 'Group 2 — Estimate', label: 'Estimated Profit Margin', dataType: 'NUMERICAL' },
  {
    group: 'Group 2 — Estimate',
    label: 'Job Scope',
    dataType: 'MULTIPLE_OPTIONS',
    options: [
      'Kitchen Demo', 'Bathroom Demo', 'Full House Gut', 'Flooring Removal',
      'Concrete Demo', 'Drywall & Wall Demo', 'Ceiling Demo', 'Exterior Demo',
      'Fireplace Demo', 'Stair & Trim Demo', 'Window & Door Removal', 'Cabinet Removal',
      'Shed & Structure Removal', 'Deck & Patio Removal', 'Pool & Water Feature Demo',
      'Carport Removal', 'Junk Removal & Cleanout', 'Construction Debris Hauling',
      'Jobsite Cleanup',
    ],
  },
  { group: 'Group 2 — Estimate', label: 'Scope Notes', dataType: 'LARGE_TEXT' },

  // Group 3 — Scheduling
  { group: 'Group 3 — Scheduling', label: 'Crew', dataType: 'SINGLE_OPTIONS', options: ['Crew 1', 'Crew 2', 'Crew 3', 'Crew 4', 'Jackson', 'Other'] },
  { group: 'Group 3 — Scheduling', label: 'Job Start Date', dataType: 'DATE' },
  { group: 'Group 3 — Scheduling', label: 'Job End Date', dataType: 'DATE' },
  { group: 'Group 3 — Scheduling', label: 'Job Start Time', dataType: 'TEXT' },

  // Group 4 — Integration
  { group: 'Group 4 — Integration', label: 'Airtable Job ID', dataType: 'TEXT' },
  { group: 'Group 4 — Integration', label: 'Airtable Record ID', dataType: 'TEXT' },
];

function isMonetaryTypeError(body) {
  const text = JSON.stringify(body).toLowerCase();
  return (
    (text.includes('invalid') && text.includes('monetory')) ||
    (text.includes('datatype') && text.includes('monetory')) ||
    (text.includes('type') && text.includes('not supported')) ||
    text.includes('not a valid') ||
    (text.includes('enum') && text.includes('monetory'))
  );
}

async function fetchExistingFields() {
  const res = await fetch(`${GHL_BASE}/locations/${GHL_LOCATION_ID}/customFields?model=opportunity`, { headers: HEADERS });
  const body = await res.json();
  if (!res.ok) {
    console.error('ERROR fetching existing fields:', JSON.stringify(body, null, 2));
    process.exit(1);
  }
  const fields = body.customFields ?? body.data ?? body ?? [];
  const map = new Map();
  for (const f of fields) {
    const name = f.name ?? f.label ?? f.fieldLabel;
    if (name) map.set(name, { id: f.id, dataType: f.dataType ?? f.fieldType ?? 'UNKNOWN' });
  }
  return map;
}

async function createField(label, dataType, options) {
  const body = { name: label, dataType, model: 'opportunity' };
  if (options && options.length) body.options = options;
  const res = await fetch(`${GHL_BASE}/locations/${GHL_LOCATION_ID}/customFields`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const responseBody = await res.json();
  return { ok: res.ok, status: res.status, body: responseBody };
}

function extractId(body) {
  return body?.customField?.id ?? body?.data?.id ?? body?.id ?? null;
}

async function main() {
  console.log('Fetching existing GHL custom fields...');
  const existing = await fetchExistingFields();
  console.log(`Found ${existing.size} existing field(s) on opportunity model.\n`);

  const results = [];
  const fallbackNotes = [];

  for (const def of FIELD_DEFS) {
    if (existing.has(def.label)) {
      const ex = existing.get(def.label);
      console.log(`[EXISTS]  ${def.label} → ${ex.id} (${ex.dataType})`);
      results.push({ ...def, id: ex.id, typeUsed: ex.dataType, status: 'EXISTS' });
      continue;
    }

    // Attempt create
    const res1 = await createField(def.label, def.dataType, def.options);
    await delay(300);

    if (res1.ok) {
      const id = extractId(res1.body);
      console.log(`[CREATED] ${def.label} → ${id} (${def.dataType})`);
      results.push({ ...def, id, typeUsed: def.dataType, status: 'CREATED' });
      continue;
    }

    // MONETORY fallback
    if (def.dataType === 'MONETORY' && isMonetaryTypeError(res1.body)) {
      console.log(`[RETRY]   ${def.label} — MONETORY rejected, retrying as NUMERICAL...`);
      const res2 = await createField(def.label, 'NUMERICAL', def.options);
      await delay(300);
      if (res2.ok) {
        const id = extractId(res2.body);
        const note = `${def.label}: MONETORY rejected by API, created as NUMERICAL`;
        console.log(`[CREATED-FALLBACK] ${def.label} → ${id} (NUMERICAL, MONETORY rejected)`);
        fallbackNotes.push(note);
        results.push({ ...def, id, typeUsed: 'NUMERICAL (fallback — MONETORY rejected)', status: 'CREATED-FALLBACK' });
        continue;
      }
      console.error(`[ERROR]   ${def.label} (fallback also failed): ${JSON.stringify(res2.body, null, 2)}`);
      results.push({ ...def, id: null, typeUsed: 'ERROR', status: 'ERROR', error: res2.body });
      continue;
    }

    console.error(`[ERROR]   ${def.label}: ${JSON.stringify(res1.body, null, 2)}`);
    results.push({ ...def, id: null, typeUsed: 'ERROR', status: 'ERROR', error: res1.body });
  }

  // Build mapping file
  const groups = ['Group 1 — Job Info', 'Group 2 — Estimate', 'Group 3 — Scheduling', 'Group 4 — Integration'];
  let md = `# GHL Opportunity Custom Field Key Mapping\n`;
  md += `Generated: ${new Date().toISOString()}\n`;
  md += `Location ID: ${GHL_LOCATION_ID}\n\n`;

  for (const group of groups) {
    md += `## ${group}\n`;
    md += `| Field Name | GHL Field ID | Type Used |\n|---|---|---|\n`;
    for (const r of results.filter((r) => r.group === group)) {
      md += `| ${r.label} | ${r.id ?? 'ERROR'} | ${r.typeUsed} |\n`;
    }
    md += '\n';
  }

  md += `## Native GHL Fields (reference only)\n`;
  md += `| Purpose | GHL Native Field | Notes |\n|---|---|---|\n`;
  md += `| Job Name | Opportunity Name | Native — no ID needed |\n`;
  md += `| Final Estimated Price | Monetary Value | Native — sync fn writes here |\n`;
  md += `| Client info | Contact fields | Native — name, email, phone |\n`;
  md += `| Company | Company field | Native — company name |\n\n`;

  md += `## Notes\n`;
  if (fallbackNotes.length) {
    md += `The following fields were specified as MONETARY but GHL rejected that type and they were created as NUMERICAL:\n`;
    for (const n of fallbackNotes) md += `- ${n}\n`;
  } else {
    md += `None — all types accepted as specified.\n`;
  }

  fs.writeFileSync('ghl_field_mapping.md', md, 'utf8');
  console.log('\nghl_field_mapping.md written.');

  const errors = results.filter((r) => r.status === 'ERROR');
  if (errors.length) {
    console.warn(`\nWARNING: ${errors.length} field(s) failed — check [ERROR] lines above.`);
  } else {
    console.log('All fields processed successfully.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
