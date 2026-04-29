require("dotenv").config();
const https = require("https");

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!API_KEY || !BASE_ID) {
  console.error("ERROR: AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set in .env");
  process.exit(1);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.airtable.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(method, path, body) {
  const res = await request(method, path, body);
  await sleep(250);
  return res;
}

// ─── Table / field helpers ────────────────────────────────────────────────────

async function getTables() {
  const res = await api("GET", `/v0/meta/bases/${BASE_ID}/tables`);
  if (res.error) throw new Error(`getTables failed: ${JSON.stringify(res.error)}`);
  return res.tables || [];
}

async function createTableIfMissing(tables, name, primaryFieldName) {
  const existing = tables.find((t) => t.name === name);
  if (existing) {
    console.log(`  SKIP   table already exists: ${name}`);
    return existing;
  }
  console.log(`  CREATE table: ${name}`);
  const res = await api("POST", `/v0/meta/bases/${BASE_ID}/tables`, {
    name,
    fields: [{ name: primaryFieldName, type: "singleLineText" }],
  });
  if (res.error) {
    console.error(`  ERROR  creating table ${name}: ${JSON.stringify(res.error)}`);
    return null;
  }
  return res;
}

async function createFieldIfMissing(tableId, existingFields, fieldDef) {
  const exists = existingFields.find(
    (f) => f.name.toLowerCase() === fieldDef.name.toLowerCase()
  );
  if (exists) {
    console.log(`    SKIP   field already exists: ${fieldDef.name}`);
    return exists;
  }
  const res = await api("POST", `/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, fieldDef);
  if (res.error) {
    console.warn(`    WARN   could not create ${fieldDef.name}: ${JSON.stringify(res.error)}`);
    return null;
  }
  console.log(`    CREATE field: ${fieldDef.name} (${fieldDef.type})`);
  return res;
}

function logManual(label) {
  console.log(`    MANUAL SETUP REQUIRED: ${label}`);
}

// ─── Jobs fields ──────────────────────────────────────────────────────────────

function jobsApiFields() {
  return [
    // Section 1 — Job Info
    { name: "Job Address", type: "singleLineText" },
    { name: "Engagement Type", type: "singleSelect", options: { choices: [{ name: "Contractor Job" }, { name: "Homeowner Direct" }, { name: "Subcontract Work" }] } },
    { name: "Job Type", type: "singleSelect", options: { choices: [{ name: "Residential" }, { name: "Commercial" }] } },
    {
      name: "Job Scope", type: "multipleSelects", options: {
        choices: [
          { name: "Kitchen Demo" }, { name: "Bathroom Demo" }, { name: "Full House Gut" },
          { name: "Flooring Removal" }, { name: "Concrete Demo" }, { name: "Drywall-Wall Demo" },
          { name: "Ceiling Demo" }, { name: "Exterior Demo" }, { name: "Fireplace Demo" },
          { name: "Stair-Trim Demo" }, { name: "Window-Door Removal" }, { name: "Cabinet Removal" },
          { name: "Shed-Structure Removal" }, { name: "Deck-Patio Removal" }, { name: "Pool-Water Feature Demo" },
          { name: "Carport Removal" }, { name: "Junk Removal-Cleanout" }, { name: "Construction Debris Hauling" },
          { name: "Jobsite Cleanup" },
        ],
      },
    },
    { name: "Estimator", type: "singleSelect", options: { choices: [{ name: "Dane" }, { name: "Jackson" }] } },
    { name: "Crew", type: "singleSelect", options: { choices: [{ name: "Crew 1" }, { name: "Crew 2" }, { name: "Crew 3" }, { name: "Crew 4" }, { name: "Jackson" }, { name: "Other" }] } },
    {
      name: "Status", type: "singleSelect", options: {
        choices: [
          { name: "Lead-Request" }, { name: "Scheduled" }, { name: "In Progress" },
          { name: "Completed" }, { name: "Ready for Invoice" }, { name: "Invoiced" },
          { name: "Paid" }, { name: "Cancelled" },
        ],
      },
    },
    { name: "Start Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "End Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "Job Start Time", type: "singleLineText" },
    { name: "Scope Notes", type: "multilineText" },
    { name: "Days at Job", type: "number", options: { precision: 0 } },
    { name: "Number of Employees", type: "number", options: { precision: 0 } },
    { name: "Total Number of Dumps", type: "number", options: { precision: 0 } },
    // Section 2 — Estimate Inputs
    { name: "Estimated Labor Hours", type: "number", options: { precision: 2 } },
    { name: "Labor Rate", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Overhead Rate", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Estimated Materials", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Disposal Charge Revenue", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Disposal Estimated Cost", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Target Margin Percent", type: "percent", options: { precision: 2 } },
    { name: "Credit Card Fee Percent", type: "percent", options: { precision: 2 } },
    // Section 3 — Actuals Inputs
    { name: "Actual Labor Hours", type: "number", options: { precision: 2 } },
    { name: "Actual Materials", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Actual Disposal Cost", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Actual Revenue", type: "currency", options: { precision: 2, symbol: "$" } },
    // Section 5 — Invoice
    { name: "Invoice Amount Override", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Invoice Notes", type: "multilineText" },
    { name: "Deposit Required", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Deposit Type", type: "singleSelect", options: { choices: [{ name: "Percentage" }, { name: "Fixed Amount" }] } },
    { name: "Deposit Value", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Deposit Invoice Sent", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Deposit Collected", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Ready for Invoice", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Invoice Sent Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "Payment Date", type: "date", options: { dateFormat: { name: "local" } } },
    // Section 6 — Integrations
    { name: "GHL Opportunity ID", type: "singleLineText" },
    { name: "GHL Invoice ID", type: "singleLineText" },
    { name: "Stripe Payment ID", type: "singleLineText" },
    { name: "Stripe Payment Link", type: "url" },
    { name: "Slack Channel ID", type: "singleLineText" },
    { name: "Slack Thread ID", type: "singleLineText" },
    { name: "Gusto Project ID", type: "singleLineText" },
    { name: "Divvy Job Tag", type: "singleLineText" },
    { name: "Google Calendar Event ID", type: "singleLineText" },
    { name: "Calendar Sync Status", type: "singleLineText" },
    { name: "Slack Message Sent", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    // Section 7 — Admin
    { name: "Estimate Locked", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Internal Notes", type: "multilineText" },
    { name: "Last Updated Source", type: "singleLineText" },
    { name: "Labor Estimation Method", type: "singleLineText" },
  ];
}

function jobsManualFields() {
  return [
    "Job Number — autonumber",
    'Job ID — formula: "JOB-" & ({Job Number} + 1000) — set as primary field',
    "Client — linked record to Clients table",
    "Client Type Lookup — lookup from Clients.Client Type",
    "Invoice Email Lookup — lookup from Clients.Invoice Email Final",
    "Change Orders — linked record to Change Orders table",
    "Change Order Total — rollup: SUM of Change Orders.Approved Value",
    "Expenses — linked record to Expenses table",
    "Expense Total — rollup: SUM of Expenses.Amount",
    "Invoice Line Items — linked record to Invoice Line Items table",
    // Estimate formulas
    "Estimated Labor Cost — formula: {Estimated Labor Hours} * {Labor Rate}",
    "Estimated Overhead — formula: {Estimated Labor Hours} * {Overhead Rate}",
    "Disposal Buffer — formula: {Disposal Charge Revenue} - {Disposal Estimated Cost}",
    "Estimated Base Cost — formula: {Estimated Labor Cost} + {Estimated Overhead} + {Estimated Materials} + {Disposal Estimated Cost}",
    "Price Before Fees — formula: IF({Target Margin Percent}, {Estimated Base Cost} / (1 - {Target Margin Percent}), BLANK())",
    "Final Estimated Price — formula: IF({Credit Card Fee Percent}, {Price Before Fees} / (1 - {Credit Card Fee Percent}), {Price Before Fees})",
    "Estimated Profit — formula: {Final Estimated Price} - {Estimated Base Cost}",
    "Estimated Profit Margin — formula: IF({Final Estimated Price}, {Estimated Profit} / {Final Estimated Price}, BLANK()) [format as percent]",
    // Actual formulas
    "Actual Labor Cost — formula: {Actual Labor Hours} * {Labor Rate}",
    "Actual Overhead — formula: {Actual Labor Hours} * {Overhead Rate}",
    "Actual Total Cost — formula: {Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Disposal Cost}",
    "Actual Profit — formula: {Actual Revenue} - {Actual Total Cost}",
    "Actual Profit Margin — formula: IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK()) [format as percent]",
    // Variance formulas
    "Labor Hour Variance — formula: {Actual Labor Hours} - {Estimated Labor Hours}",
    "Labor Cost Variance — formula: {Actual Labor Cost} - {Estimated Labor Cost}",
    "Material Variance — formula: {Actual Materials} - {Estimated Materials}",
    "Disposal Variance — formula: {Actual Disposal Cost} - {Disposal Estimated Cost}",
    "Revenue Variance — formula: {Actual Revenue} - {Final Estimated Price}",
    "Profit Variance — formula: {Actual Profit} - {Estimated Profit}",
    "Profit Variance Percent — formula: IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK()) [format as percent]",
  ];
}

// ─── Invoice Line Items fields ────────────────────────────────────────────────

function invoiceLineItemsApiFields() {
  return [
    { name: "Description", type: "multilineText" },
    { name: "Amount", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Quantity", type: "number", options: { precision: 2 } },
    { name: "Sort Order", type: "number", options: { precision: 0 } },
    {
      name: "Line Item Type", type: "singleSelect", options: {
        choices: [
          { name: "Scope Item" }, { name: "Change Order" }, { name: "Deposit" },
          { name: "Materials Reimbursement" }, { name: "Labor" }, { name: "Other" },
        ],
      },
    },
    { name: "Invoice Group", type: "singleSelect", options: { choices: [{ name: "Deposit Invoice" }, { name: "Final Invoice" }] } },
    { name: "Include on Invoice", type: "checkbox", options: { icon: "check", color: "greenBright" } },
  ];
}

function invoiceLineItemsManualFields() {
  return [
    "Job — linked record to Jobs table",
    "Scope Library Reference — linked record to Scope Library table",
    "Line Item ID — autonumber",
  ];
}

// ─── Scope Library fields ─────────────────────────────────────────────────────

function scopeLibraryApiFields() {
  return [
    { name: "Default Description", type: "multilineText" },
    { name: "Default Labor Hours", type: "number", options: { precision: 2 } },
    { name: "Default Materials Cost", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Default Dump Count", type: "number", options: { precision: 0 } },
    {
      name: "Job Type Applicability", type: "multipleSelects", options: {
        choices: [{ name: "Residential" }, { name: "Commercial" }],
      },
    },
    { name: "Active", type: "checkbox", options: { icon: "check", color: "greenBright" } },
  ];
}

function scopeLibraryManualFields() {
  return ["Jobs — linked record to Jobs table"];
}

// ─── Seed Scope Library ───────────────────────────────────────────────────────

async function seedScopeLibrary(tableId) {
  console.log("\nSeeding Scope Library...");

  const existing = await api("GET", `/v0/${BASE_ID}/${tableId}?maxRecords=100`);
  const existingNames = (existing.records || []).map((r) => r.fields["Scope Name"]);

  const seeds = [
    { "Scope Name": "Kitchen Demo", "Default Description": "Remove and haul off all kitchen cabinets, countertops, and backsplash. Ensure proper floor and wall protection throughout. Haul off all debris and dump.", "Default Labor Hours": 8, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Bathroom Demo", "Default Description": "Full bathroom demolition including tile, fixtures, vanity, and drywall as designated. Ensure proper protection of adjacent areas. Haul off all debris and dump.", "Default Labor Hours": 6, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Full House Gut", "Default Description": "Complete interior demolition down to studs including flooring, walls, ceilings, trim, and fixtures as designated. Provide dust control and floor protection throughout. Haul off all debris and dump.", "Default Labor Hours": 40, "Default Dump Count": 4, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Flooring Removal", "Default Description": "Remove existing flooring throughout designated areas. Ensure proper preparation of substrate. Provide dust control and protection of adjacent areas. Haul off all debris and dump.", "Default Labor Hours": 6, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Concrete Demo", "Default Description": "Break up and remove designated concrete. Haul off all concrete and dump at approved facility.", "Default Labor Hours": 8, "Default Dump Count": 2, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Drywall-Wall Demo", "Default Description": "Remove drywall and framing in designated areas per plans. Ensure proper dust control and protection of adjacent surfaces. Haul off all debris and dump.", "Default Labor Hours": 6, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Ceiling Demo", "Default Description": "Remove ceiling material in designated areas. Provide dust control and floor protection throughout. Haul off all debris and dump.", "Default Labor Hours": 5, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Exterior Demo", "Default Description": "Remove designated exterior materials including siding, stucco, soffit, and fascia as specified. Haul off all debris and dump.", "Default Labor Hours": 16, "Default Dump Count": 2, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Fireplace Demo", "Default Description": "Demolish designated fireplace and surround. Provide dust control, floor protection, and plastic barriers. Haul off all debris and dump.", "Default Labor Hours": 6, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Stair-Trim Demo", "Default Description": "Remove stair finishes and trim throughout designated areas. Haul off all debris and dump.", "Default Labor Hours": 4, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Window-Door Removal", "Default Description": "Remove designated windows and doors. Protect surrounding surfaces. Haul off all debris and dump.", "Default Labor Hours": 4, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Cabinet Removal", "Default Description": "Remove and save or dispose of cabinets as designated. Ensure proper protection of adjacent surfaces. Haul off all debris and dump.", "Default Labor Hours": 4, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Shed-Structure Removal", "Default Description": "Demolish and remove designated structure. Haul off all debris and dump.", "Default Labor Hours": 6, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Deck-Patio Removal", "Default Description": "Remove designated deck or patio structure. Haul off all debris and dump.", "Default Labor Hours": 8, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Pool-Water Feature Demo", "Default Description": "Demolish and remove designated water feature or pool structure. Haul off all debris and dump at approved facility.", "Default Labor Hours": 16, "Default Dump Count": 2, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Carport Removal", "Default Description": "Remove designated carport structure. Haul off all debris and dump.", "Default Labor Hours": 6, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Junk Removal-Cleanout", "Default Description": "Remove all designated junk and debris from property. Haul off and dump at approved facility.", "Default Labor Hours": 4, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Construction Debris Hauling", "Default Description": "Load and haul off all construction debris from designated areas. Dump at approved facility.", "Default Labor Hours": 4, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
    { "Scope Name": "Jobsite Cleanup", "Default Description": "Final broom-clean of all designated interior and exterior areas. Remove remaining debris and haul off. Leave jobsite in clean condition.", "Default Labor Hours": 3, "Default Dump Count": 1, "Job Type Applicability": ["Residential", "Commercial"], Active: true },
  ];

  for (const seed of seeds) {
    if (existingNames.includes(seed["Scope Name"])) {
      console.log(`  SKIP   record already exists: ${seed["Scope Name"]}`);
      continue;
    }
    const res = await api("POST", `/v0/${BASE_ID}/${tableId}`, { fields: seed });
    if (res.error) {
      console.warn(`  WARN   could not seed ${seed["Scope Name"]}: ${JSON.stringify(res.error)}`);
    } else {
      console.log(`  CREATE record: ${seed["Scope Name"]}`);
    }
  }
}

// ─── Build a table ────────────────────────────────────────────────────────────

async function buildTable(tables, tableName, primaryField, apiFields, manualFields) {
  console.log(`\n--- ${tableName} ---`);

  let table = await createTableIfMissing(tables, tableName, primaryField);
  if (!table) return;

  // Refresh to get current field list
  const fresh = await getTables();
  table = fresh.find((t) => t.name === tableName);

  for (const field of apiFields) {
    await createFieldIfMissing(table.id, table.fields, field);
    // Refresh fields after each add
    const refreshed = await getTables();
    table = refreshed.find((t) => t.name === tableName);
  }

  if (manualFields.length) {
    console.log(`\n  Manual setup required for ${tableName}:`);
    manualFields.forEach((f) => logManual(f));
  }

  return table;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Lost Boys Demolition — Airtable Setup v2 ===\n");

  let tables = await getTables();
  console.log(`Found ${tables.length} existing tables: ${tables.map((t) => t.name).join(", ") || "(none)"}`);

  await buildTable(tables, "Jobs", "Job Name", jobsApiFields(), jobsManualFields());

  tables = await getTables();
  await buildTable(tables, "Invoice Line Items", "Line Item Name", invoiceLineItemsApiFields(), invoiceLineItemsManualFields());

  tables = await getTables();
  const scopeTable = await buildTable(tables, "Scope Library", "Scope Name", scopeLibraryApiFields(), scopeLibraryManualFields());

  if (scopeTable) {
    tables = await getTables();
    const freshScope = tables.find((t) => t.name === "Scope Library");
    await seedScopeLibrary(freshScope.id);
  }

  // ── Final checklist ──────────────────────────────────────────────────────

  console.log("\n\n══════════════════════════════════════════════════════");
  console.log("POST-RUN MANUAL SETUP CHECKLIST");
  console.log("══════════════════════════════════════════════════════");

  console.log("\nJOBS TABLE:");
  jobsManualFields().forEach((f) => console.log(`  [ ] ${f}`));

  console.log("\nINVOICE LINE ITEMS TABLE:");
  invoiceLineItemsManualFields().forEach((f) => console.log(`  [ ] ${f}`));

  console.log("\nSCOPE LIBRARY TABLE:");
  scopeLibraryManualFields().forEach((f) => console.log(`  [ ] ${f}`));

  console.log("\nDEFAULT VALUES (set manually in Jobs field settings):");
  console.log("  [ ] Labor Rate:              $26");
  console.log("  [ ] Overhead Rate:           $23");
  console.log("  [ ] Disposal Charge Revenue: $300");
  console.log("  [ ] Target Margin Percent:   25%");
  console.log("  [ ] Credit Card Fee Percent: 3%");

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
