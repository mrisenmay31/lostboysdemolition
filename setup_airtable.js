require("dotenv").config();
const https = require("https");

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!API_KEY || !BASE_ID) {
  console.error("ERROR: AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set in .env");
  process.exit(1);
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

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
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Airtable metadata API is rate-limited; add a small delay between writes
async function rateLimited(fn) {
  const result = await fn();
  await sleep(250);
  return result;
}

// ─── Table helpers ───────────────────────────────────────────────────────────

async function getTables() {
  const res = await request("GET", `/v0/meta/bases/${BASE_ID}/tables`);
  if (res.error) throw new Error(`getTables failed: ${JSON.stringify(res.error)}`);
  return res.tables || [];
}

async function createTableIfMissing(tables, name, fields) {
  const existing = tables.find((t) => t.name === name);
  if (existing) {
    console.log(`  SKIP  table already exists: ${name}`);
    return existing;
  }
  console.log(`  CREATE table: ${name}`);
  const res = await rateLimited(() =>
    request("POST", `/v0/meta/bases/${BASE_ID}/tables`, { name, fields })
  );
  if (res.error) {
    console.error(`  ERROR creating table ${name}: ${JSON.stringify(res.error)}`);
    return null;
  }
  return res;
}

async function createFieldIfMissing(tableId, tableName, existingFields, fieldDef) {
  const exists = existingFields.find(
    (f) => f.name.toLowerCase() === fieldDef.name.toLowerCase()
  );
  if (exists) {
    console.log(`    SKIP  field already exists: ${fieldDef.name}`);
    return exists;
  }
  console.log(`    CREATE field: ${fieldDef.name} (${fieldDef.type})`);
  const res = await rateLimited(() =>
    request("POST", `/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, fieldDef)
  );
  if (res.error) {
    console.warn(`    WARN  could not create field ${fieldDef.name}: ${JSON.stringify(res.error)}`);
    return null;
  }
  return res;
}

// ─── Field definitions ───────────────────────────────────────────────────────

// NOTE: The primary field is always created with the table. Extra fields are added after.

function clientsFields() {
  return [
    { name: "Client Type", type: "singleSelect", options: { choices: [{ name: "Contractor" }, { name: "Homeowner" }] } },
    { name: "Company Name", type: "singleLineText" },
    { name: "Contact Name", type: "singleLineText" },
    { name: "Email", type: "email" },
    { name: "Phone", type: "phoneNumber" },
    { name: "Notes", type: "multilineText" },
    { name: "Address", type: "singleLineText" },
    { name: "City", type: "singleLineText" },
    { name: "State", type: "singleLineText" },
    { name: "Zip", type: "singleLineText" },
    { name: "Billing Contact Name", type: "singleLineText" },
    { name: "Billing Email", type: "email" },
    { name: "Billing Phone", type: "phoneNumber" },
    { name: "Billing Notes", type: "multilineText" },
    { name: "GHL Contact ID", type: "singleLineText" },
    { name: "GHL Company ID", type: "singleLineText" },
    // Linked record to Jobs + rollups are added in a second pass after Jobs table exists
  ];
}

function jobsFields(clientsTableId) {
  return [
    // Job Number autonumber (Job ID formula uses this)
    { name: "Job Number", type: "autoNumber" },
    // Client link
    {
      name: "Client",
      type: "multipleRecordLinks",
      options: { linkedTableId: clientsTableId, prefersSingleRecordLink: true },
    },
    {
      name: "Engagement Type",
      type: "singleSelect",
      options: { choices: [{ name: "Contractor Job" }, { name: "Homeowner Direct" }, { name: "Subcontract Work" }] },
    },
    {
      name: "Job Type",
      type: "singleSelect",
      options: {
        choices: [
          { name: "Interior Demo" }, { name: "Full Gut" }, { name: "Selective Demo" },
          { name: "Concrete Demo" }, { name: "Exterior Demo" }, { name: "Hauling / Disposal" }, { name: "Other" },
        ],
      },
    },
    {
      name: "Estimator",
      type: "singleSelect",
      options: { choices: [{ name: "Dane" }, { name: "Jackson" }] },
    },
    {
      name: "Crew",
      type: "singleSelect",
      options: {
        choices: [
          { name: "Crew 1" }, { name: "Crew 2" }, { name: "Crew 3" }, { name: "Crew 4" }, { name: "Jackson" }, { name: "Other" },
        ],
      },
    },
    {
      name: "Status",
      type: "singleSelect",
      options: {
        choices: [
          { name: "Lead / Request" }, { name: "Scheduled" }, { name: "In Progress" },
          { name: "Completed" }, { name: "Ready for Invoice" }, { name: "Invoiced" }, { name: "Paid" }, { name: "Cancelled" },
        ],
      },
    },
    { name: "Start Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "End Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "Job Address", type: "singleLineText" },
    { name: "Scope Notes", type: "multilineText" },
    // Estimate inputs
    { name: "Estimated Labor Hours", type: "number", options: { precision: 2 } },
    { name: "Labor Rate", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Overhead Rate", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Estimated Materials", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Disposal Charge Revenue", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Disposal Estimated Cost", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Target Margin Percent", type: "percent", options: { precision: 2 } },
    { name: "Credit Card Fee Percent", type: "percent", options: { precision: 2 } },
    // Estimate formulas
    { name: "Disposal Buffer", type: "formula", options: { formula: "{Disposal Charge Revenue} - {Disposal Estimated Cost}" } },
    { name: "Estimated Labor Cost", type: "formula", options: { formula: "{Estimated Labor Hours} * {Labor Rate}" } },
    { name: "Estimated Overhead", type: "formula", options: { formula: "{Estimated Labor Hours} * {Overhead Rate}" } },
    { name: "Estimated Base Cost", type: "formula", options: { formula: "{Estimated Labor Cost} + {Estimated Overhead} + {Estimated Materials} + {Disposal Estimated Cost}" } },
    { name: "Price Before Fees", type: "formula", options: { formula: "IF({Target Margin Percent}, {Estimated Base Cost} / (1 - {Target Margin Percent}), BLANK())" } },
    { name: "Final Estimated Price", type: "formula", options: { formula: "IF({Credit Card Fee Percent}, {Price Before Fees} / (1 - {Credit Card Fee Percent}), {Price Before Fees})" } },
    { name: "Estimated Profit", type: "formula", options: { formula: "{Final Estimated Price} - {Estimated Base Cost}" } },
    { name: "Estimated Profit Margin", type: "formula", options: { formula: "IF({Final Estimated Price}, {Estimated Profit} / {Final Estimated Price}, BLANK())" } },
    // Actuals inputs
    { name: "Actual Labor Hours", type: "number", options: { precision: 2 } },
    { name: "Actual Materials", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Actual Disposal Cost", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Actual Revenue", type: "currency", options: { precision: 2, symbol: "$" } },
    // Actuals formulas
    { name: "Actual Labor Cost", type: "formula", options: { formula: "{Actual Labor Hours} * {Labor Rate}" } },
    { name: "Actual Overhead", type: "formula", options: { formula: "{Actual Labor Hours} * {Overhead Rate}" } },
    { name: "Actual Total Cost", type: "formula", options: { formula: "{Actual Labor Cost} + {Actual Overhead} + {Actual Materials} + {Actual Disposal Cost}" } },
    { name: "Actual Profit", type: "formula", options: { formula: "{Actual Revenue} - {Actual Total Cost}" } },
    { name: "Actual Profit Margin", type: "formula", options: { formula: "IF({Actual Revenue}, {Actual Profit} / {Actual Revenue}, BLANK())" } },
    // Variance formulas
    { name: "Labor Hour Variance", type: "formula", options: { formula: "{Actual Labor Hours} - {Estimated Labor Hours}" } },
    { name: "Labor Cost Variance", type: "formula", options: { formula: "{Actual Labor Cost} - {Estimated Labor Cost}" } },
    { name: "Material Variance", type: "formula", options: { formula: "{Actual Materials} - {Estimated Materials}" } },
    { name: "Disposal Variance", type: "formula", options: { formula: "{Actual Disposal Cost} - {Disposal Estimated Cost}" } },
    { name: "Revenue Variance", type: "formula", options: { formula: "{Actual Revenue} - {Final Estimated Price}" } },
    { name: "Profit Variance", type: "formula", options: { formula: "{Actual Profit} - {Estimated Profit}" } },
    { name: "Profit Variance Percent", type: "formula", options: { formula: "IF({Estimated Profit}, {Profit Variance} / {Estimated Profit}, BLANK())" } },
    // Integrations
    { name: "GHL Opportunity ID", type: "singleLineText" },
    { name: "GHL Invoice ID", type: "singleLineText" },
    { name: "Stripe Payment ID", type: "singleLineText" },
    { name: "Stripe Payment Link", type: "url" },
    { name: "Slack Channel ID", type: "singleLineText" },
    { name: "Slack Thread ID", type: "singleLineText" },
    { name: "Gusto Project ID", type: "singleLineText" },
    { name: "Bill / Divvy Job Tag", type: "singleLineText" },
    { name: "Google Calendar Event ID", type: "singleLineText" },
    // Admin
    { name: "Estimate Locked", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Ready for Invoice", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Invoice Sent Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "Payment Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "Internal Notes", type: "multilineText" },
    // Change Orders + Expenses linked fields added in second pass
  ];
}

function changeOrdersFields(jobsTableId) {
  return [
    {
      name: "Job",
      type: "multipleRecordLinks",
      options: { linkedTableId: jobsTableId, prefersSingleRecordLink: true },
    },
    { name: "Description", type: "multilineText" },
    {
      name: "Source",
      type: "singleSelect",
      options: { choices: [{ name: "Slack" }, { name: "Admin" }, { name: "Estimator" }, { name: "Client" }] },
    },
    { name: "Estimated Value", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Approved Value", type: "currency", options: { precision: 2, symbol: "$" } },
    {
      name: "Status",
      type: "singleSelect",
      options: { choices: [{ name: "Pending" }, { name: "Approved" }, { name: "Rejected" }, { name: "Invoiced" }] },
    },
    { name: "Created Date", type: "createdTime" },
    { name: "Approved Date", type: "date", options: { dateFormat: { name: "local" } } },
    { name: "Notes", type: "multilineText" },
  ];
}

function expensesFields(jobsTableId) {
  return [
    {
      name: "Job",
      type: "multipleRecordLinks",
      options: { linkedTableId: jobsTableId, prefersSingleRecordLink: true },
    },
    { name: "Amount", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Vendor", type: "singleLineText" },
    { name: "Date", type: "date", options: { dateFormat: { name: "local" } } },
    {
      name: "Category",
      type: "singleSelect",
      options: {
        choices: [
          { name: "Materials" }, { name: "Disposal" }, { name: "Fuel" },
          { name: "Equipment Rental" }, { name: "Subcontractor" }, { name: "Other" },
        ],
      },
    },
    {
      name: "Payment Source",
      type: "singleSelect",
      options: { choices: [{ name: "Bill" }, { name: "Divvy" }, { name: "Manual" }] },
    },
    { name: "Bill Transaction ID", type: "singleLineText" },
    { name: "Receipt URL", type: "url" },
    { name: "Notes", type: "multilineText" },
  ];
}

function pricingVariablesFields() {
  return [
    { name: "Value", type: "number", options: { precision: 4 } },
    { name: "Percent Value", type: "percent", options: { precision: 2 } },
    { name: "Currency Value", type: "currency", options: { precision: 2, symbol: "$" } },
    { name: "Description", type: "multilineText" },
    { name: "Active", type: "checkbox", options: { icon: "check", color: "greenBright" } },
  ];
}

// ─── Seed Pricing Variables ───────────────────────────────────────────────────

async function seedPricingVariables(tableId) {
  console.log("\nSeeding Pricing Variables...");

  // Fetch existing records first to stay idempotent
  const existing = await request("GET", `/v0/${BASE_ID}/${tableId}?maxRecords=100`);
  const existingNames = (existing.records || []).map((r) => r.fields["Variable Name"]);

  const seeds = [
    {
      "Variable Name": "Labor Rate",
      "Currency Value": 26,
      Description: "Blended hourly labor rate based on 2025 hourly payroll spend divided by productive hours. Includes overtime and payroll taxes.",
      Active: true,
    },
    {
      "Variable Name": "Overhead Rate",
      "Currency Value": 23,
      Description: "Overhead allocation rate based on 2025 overhead expenses divided by productive hours.",
      Active: true,
    },
    {
      "Variable Name": "Target Margin Percent",
      "Percent Value": 0.25,
      Description: "Target gross profit margin used for pricing.",
      Active: true,
    },
    {
      "Variable Name": "Credit Card Fee Percent",
      "Percent Value": 0.03,
      Description: "Estimated card processing fee adjustment.",
      Active: true,
    },
    {
      "Variable Name": "Default Disposal Charge",
      "Currency Value": 300,
      Description: "Standard estimated disposal charge per dump/disposal unit.",
      Active: true,
    },
  ];

  for (const seed of seeds) {
    if (existingNames.includes(seed["Variable Name"])) {
      console.log(`  SKIP  record already exists: ${seed["Variable Name"]}`);
      continue;
    }
    console.log(`  CREATE record: ${seed["Variable Name"]}`);
    const res = await rateLimited(() =>
      request("POST", `/v0/${BASE_ID}/${tableId}`, { fields: seed })
    );
    if (res.error) {
      console.warn(`  WARN  could not seed ${seed["Variable Name"]}: ${JSON.stringify(res.error)}`);
    }
  }
}

// ─── Second-pass linked fields (rollups / cross-table links) ─────────────────

async function addCrossTableLinks(tables) {
  const clientsTable = tables.find((t) => t.name === "Clients");
  const jobsTable = tables.find((t) => t.name === "Jobs");

  if (!clientsTable || !jobsTable) {
    console.warn("WARN: Could not find Clients or Jobs table for cross-table links.");
    return;
  }

  console.log("\nAdding cross-table linked fields...");

  // Clients → Jobs linked record
  await createFieldIfMissing(clientsTable.id, "Clients", clientsTable.fields, {
    name: "Jobs",
    type: "multipleRecordLinks",
    options: { linkedTableId: jobsTable.id },
  });

  // Rollup and lookup fields cannot be created via the Metadata API reliably.
  // Log manual setup instructions instead.
  console.log("\n  MANUAL SETUP REQUIRED — the following fields must be created in Airtable UI:");
  const manualFields = [
    "Clients > Invoice Email Final (formula: IF({Billing Email}, {Billing Email}, {Email}))",
    "Clients > Total Jobs (count of linked Jobs)",
    "Clients > Total Revenue (rollup from Jobs.Actual Revenue using SUM(values))",
    "Clients > Total Profit (rollup from Jobs.Actual Profit using SUM(values))",
    "Jobs > Client Type Lookup (lookup from Clients.Client Type)",
    "Jobs > Invoice Email Lookup (lookup from Clients.Invoice Email Final)",
    "Jobs > Job ID formula: 'JOB-' & ({Job Number} + 1000)  [set as primary field or add formula field]",
    "Jobs > Change Order Total (rollup from Change Orders.Approved Value using SUM(values))",
    "Jobs > Expense Total (rollup from Expenses.Amount using SUM(values))",
  ];
  manualFields.forEach((f) => console.log(`    - ${f}`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Lost Boys Demolition — Airtable Setup ===\n");

  let tables = await getTables();
  const tableNames = tables.map((t) => t.name);
  console.log(`Found ${tables.length} existing tables: ${tableNames.join(", ") || "(none)"}\n`);

  // ── Pass 1: Create tables that have no cross-table dependencies ──────────

  console.log("--- Clients ---");
  let clientsTable = await createTableIfMissing(tables, "Clients", [
    { name: "Client Name", type: "singleLineText" },
  ]);
  tables = await getTables(); // refresh
  clientsTable = tables.find((t) => t.name === "Clients");

  for (const field of clientsFields()) {
    await createFieldIfMissing(clientsTable.id, "Clients", clientsTable.fields, field);
    clientsTable = tables.find((t) => t.name === "Clients"); // keep fields fresh after refresh below if needed
  }

  console.log("\n--- Pricing Variables ---");
  let pvTable = await createTableIfMissing(tables, "Pricing Variables", [
    { name: "Variable Name", type: "singleLineText" },
  ]);
  tables = await getTables();
  pvTable = tables.find((t) => t.name === "Pricing Variables");
  for (const field of pricingVariablesFields()) {
    await createFieldIfMissing(pvTable.id, "Pricing Variables", pvTable.fields, field);
  }

  // ── Pass 2: Jobs (requires Clients ID) ──────────────────────────────────

  tables = await getTables();
  clientsTable = tables.find((t) => t.name === "Clients");

  console.log("\n--- Jobs ---");
  let jobsTable = await createTableIfMissing(tables, "Jobs", [
    { name: "Job ID", type: "singleLineText" },
  ]);
  tables = await getTables();
  jobsTable = tables.find((t) => t.name === "Jobs");

  for (const field of jobsFields(clientsTable.id)) {
    await createFieldIfMissing(jobsTable.id, "Jobs", jobsTable.fields, field);
    // Refresh fields after each add so existence checks are accurate
    tables = await getTables();
    jobsTable = tables.find((t) => t.name === "Jobs");
  }

  // ── Pass 3: Change Orders + Expenses (require Jobs ID) ──────────────────

  tables = await getTables();
  jobsTable = tables.find((t) => t.name === "Jobs");

  console.log("\n--- Change Orders ---");
  let coTable = await createTableIfMissing(tables, "Change Orders", [
    { name: "Change Order ID", type: "singleLineText" },
  ]);
  tables = await getTables();
  coTable = tables.find((t) => t.name === "Change Orders");

  for (const field of changeOrdersFields(jobsTable.id)) {
    await createFieldIfMissing(coTable.id, "Change Orders", coTable.fields, field);
    tables = await getTables();
    coTable = tables.find((t) => t.name === "Change Orders");
  }

  console.log("\n--- Expenses ---");
  let expTable = await createTableIfMissing(tables, "Expenses", [
    { name: "Expense ID", type: "singleLineText" },
  ]);
  tables = await getTables();
  expTable = tables.find((t) => t.name === "Expenses");

  for (const field of expensesFields(jobsTable.id)) {
    await createFieldIfMissing(expTable.id, "Expenses", expTable.fields, field);
    tables = await getTables();
    expTable = tables.find((t) => t.name === "Expenses");
  }

  // ── Pass 4: Cross-table links and rollups ────────────────────────────────

  tables = await getTables();
  await addCrossTableLinks(tables);

  // ── Pass 5: Seed Pricing Variables ───────────────────────────────────────

  tables = await getTables();
  pvTable = tables.find((t) => t.name === "Pricing Variables");
  await seedPricingVariables(pvTable.id);

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log("\n=== Setup complete ===");
  console.log("\nDefault values to set manually in Airtable (API does not support defaults):");
  console.log("  Jobs > Labor Rate:              $26");
  console.log("  Jobs > Overhead Rate:           $23");
  console.log("  Jobs > Disposal Charge Revenue: $300");
  console.log("  Jobs > Target Margin Percent:   25%");
  console.log("  Jobs > Credit Card Fee Percent: 3%");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
