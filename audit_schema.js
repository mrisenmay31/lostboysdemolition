require("dotenv").config();
const https = require("https");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!API_KEY || !BASE_ID) {
  console.error("ERROR: AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set in .env");
  process.exit(1);
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.airtable.com",
      path: urlPath,
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
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
    req.end();
  });
}

// ─── Field type classification ────────────────────────────────────────────────

const MANUAL_TYPES = new Set([
  "formula",
  "rollup",
  "multipleLookupValues",
  "lookup",
  "multipleRecordLinks",
  "autoNumber",
  "createdTime",
  "lastModifiedTime",
  "count",
]);

function classifyField(field) {
  return MANUAL_TYPES.has(field.type) ? "manual" : "api";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Lost Boys Demolition — Airtable Schema Audit ===\n");
  console.log(`Base ID: ${BASE_ID}`);
  console.log(`Run at:  ${new Date().toISOString()}\n`);

  console.log("Fetching base schema via Airtable Metadata API...");
  const schema = await request("GET", `/v0/meta/bases/${BASE_ID}/tables`);

  if (schema.error) {
    console.error(`ERROR fetching schema: ${JSON.stringify(schema.error)}`);
    process.exit(1);
  }

  if (!schema.tables) {
    console.error(`ERROR: unexpected response shape: ${JSON.stringify(schema).slice(0, 500)}`);
    process.exit(1);
  }

  const outputPath = path.join(__dirname, "schema_audit.json");
  const enriched = {
    auditedAt: new Date().toISOString(),
    baseId: BASE_ID,
    tableCount: schema.tables.length,
    tables: schema.tables,
  };

  fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2));
  console.log(`\n✓ Full schema dumped to: ${outputPath}`);
  console.log(`  File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB\n`);

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("══════════════════════════════════════════════════════");
  console.log(`SUMMARY  ·  ${schema.tables.length} tables`);
  console.log("══════════════════════════════════════════════════════\n");

  const totals = { fields: 0, manual: 0, api: 0 };

  schema.tables.forEach((table) => {
    const fields = table.fields || [];
    const byType = {};
    let manualCount = 0;
    fields.forEach((f) => {
      byType[f.type] = (byType[f.type] || 0) + 1;
      if (classifyField(f) === "manual") manualCount++;
    });
    totals.fields += fields.length;
    totals.manual += manualCount;
    totals.api += fields.length - manualCount;

    console.log(`📋 ${table.name}  (id: ${table.id})`);
    console.log(`   Primary: ${(fields.find((f) => f.id === table.primaryFieldId) || {}).name || "?"}`);
    console.log(`   Fields:  ${fields.length} total  ·  ${manualCount} manual-only types  ·  ${fields.length - manualCount} API-creatable`);
    console.log(`   Views:   ${(table.views || []).length}`);
    const typeStr = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}:${n}`)
      .join("  ");
    console.log(`   Types:   ${typeStr}`);
    console.log("");
  });

  console.log("──────────────────────────────────────────────────────");
  console.log(`TOTALS:  ${totals.fields} fields  ·  ${totals.api} API  ·  ${totals.manual} manual`);
  console.log("──────────────────────────────────────────────────────\n");

  console.log("Manual-only types: formula, rollup, lookup, linked record, autonumber, count, createdTime, lastModifiedTime\n");

  // ── Next steps ────────────────────────────────────────────────────────────

  console.log("=== Next Steps ===");
  console.log("1. Review schema_audit.json (full live schema dump)");
  console.log("2. Commit to GitHub so the agent can analyze:");
  console.log("     git add schema_audit.json");
  console.log("     git commit -m \"Schema audit dump\"");
  console.log("     git push");
  console.log("");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
