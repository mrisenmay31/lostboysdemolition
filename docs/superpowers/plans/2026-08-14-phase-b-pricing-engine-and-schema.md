# Phase B (Slice 1): Pricing Engine + Estimates Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit-tested TypeScript pricing engine that reproduces every live Fillout-calculated estimate to the cent, plus the canonical Postgres schema (`estimates`, `estimate_line_items`, `scope_library`, `pricing_variables`) that Phase B's UI and GHL-push slices will build on.

**Architecture:** A pure, dependency-free pricing module in `supabase/functions/_shared/` (the repo's established tested-code home), validated by a golden-master test against a committed fixture of all 321 real Airtable estimates. Schema ships as SQL migrations applied via the Supabase MCP and committed to `supabase/migrations/` (Phase A pattern). Estimates are immutable versioned snapshots — computed columns are frozen by trigger; corrections create a new version.

**Tech Stack:** Deno 2.x TypeScript (tests colocated as `X_test.ts`, run with `deno test`), Postgres 15 (Supabase project `eiqqqwajmcpcwhvxxnhx`).

**Spec:** `BUILD_PLAN.md` → "Phase B — Estimate builder" (lines 204–213) and "Three design decisions" (line 66); `DISCOVERY_2026-07-31.md` §1 (the formula chain); `docs/superpowers/plans/2026-08-14-phase-b-estimates-research.md` (live-base ground truth: schemas, all 19 scopes, formula verification of all 321 estimates). The golden-master fixture is already committed at `supabase/functions/_shared/fixtures/estimates-golden-321.json`.

## Global Constraints

- **No quoted price may move.** The engine must reproduce today's Fillout math exactly; every discrepancy is a bug in the port, never a "correction" to pricing (`BUILD_PLAN.md` amendment banner, DISCOVERY §7).
- **Cost-plus MARKUP, not margin divisor.** `Profit = (TotalDirect + Overhead) × pct/100` — never `base / (1 − pct)`. Name the field `markup_pct` everywhere; report `true_margin_pct` alongside (Key Rules, corrected 2026-07-31).
- Rates: labor **$26/hr**, overhead **$23/hr**, dump **$300/load**, CC fee **3.5%** (`0.035` — the 3% Airtable row is dead data, confirmed against all 321 records). Default markup **25**, floor **15** (floor is advisory in this slice — stored, not enforced).
- **Dump counts can be fractional** (0.5 observed live). Both labor methods must work: `total_hours` and `days_employees` (= days × employees × 8).
- All intermediate figures round to the cent (half-up) — this is what the research verified against stored values.
- `deno check` clean on every new file; tests colocated (`pricing.ts` / `pricing_test.ts`) per `_shared/` convention.
- Anything applied to Supabase must be committed to this repo in the same session; migration SQL saved under `supabase/migrations/` with the same content that was applied.
- RLS enabled with **no policies by design** on all new tables (house posture — `service_role` bypasses, anon denied).
- Frequent commits: every task ends in a commit; never batch tasks into one commit.

---

### Task 1: Pricing engine (`computeEstimate`)

**Files:**
- Create: `supabase/functions/_shared/pricing.ts`
- Create: `supabase/functions/_shared/pricing_test.ts`

**Interfaces:**
- Consumes: nothing (pure module, zero imports).
- Produces: `computeEstimate(inputs: EstimateInputs, rates?: Rates): EstimateOutputs`, `DEFAULT_RATES: Rates`, `roundToCent(n: number): number`, and the exported types `Rates`, `LaborMethod`, `EstimateInputs`, `EstimateOutputs` — exactly as defined below. Tasks 2–4 rely on these names verbatim.

- [ ] **Step 1: Write the failing tests**

Test values are hand-verified against live Airtable records (see research doc §2 table). Write `supabase/functions/_shared/pricing_test.ts`:

```ts
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEstimate, DEFAULT_RATES, roundToCent } from "./pricing.ts";

Deno.test("roundToCent rounds half-up to 2 decimals", () => {
  assertEquals(roundToCent(1.005), 1.01);
  assertEquals(roundToCent(2.674999), 2.67);
  assertEquals(roundToCent(0), 0);
});

// Jorge's Interior (estimate 1321, live Fillout output 2026-08-12):
// 34 hrs, 1 dump, $0 JSC, 25% markup → total bid $2,543.51
Deno.test("total_hours method matches live record Jorge's Interior", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 34,
    dumpCount: 1, jobSpecificCosts: 0, markupPct: 25,
  });
  assertEquals(out.effectiveHours, 34);
  assertEquals(out.laborCost, 884.00);      // 26 × 34
  assertEquals(out.dumpFees, 300.00);
  assertEquals(out.totalDirect, 1184.00);
  assertEquals(out.overhead, 782.00);       // 23 × 34
  assertEquals(out.profit, 491.50);         // (1184+782) × 0.25
  assertEquals(out.ccFee, 86.01);           // (1184+782+491.50) × 0.035
  assertEquals(out.totalBid, 2543.51);
});

// Blake's Commerical [sic] Demo (estimate 1320, live 2026-08-12): FRACTIONAL dump count 0.5
// 22 hrs, 0.5 dumps, $0 JSC, 25% → $1,588.73
Deno.test("fractional dump count (0.5) matches live record Blake's", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 22,
    dumpCount: 0.5, jobSpecificCosts: 0, markupPct: 25,
  });
  assertEquals(out.dumpFees, 150.00);
  assertEquals(out.totalBid, 1588.73);
});

// Big Horn Construction (bulk import but formula-clean): days_employees method
// 4 days × 4 employees × 8 = 128 hrs, 4 dumps, $500 JSC, 20% → $9,901.22
Deno.test("days_employees method matches live record Big Horn", () => {
  const out = computeEstimate({
    laborMethod: "days_employees", daysAtJob: 4, numEmployees: 4,
    dumpCount: 4, jobSpecificCosts: 500, markupPct: 20,
  });
  assertEquals(out.effectiveHours, 128);
  assertEquals(out.totalBid, 9901.22);
});

// Sean Michaelis (estimate 1108, live): highest markup in dataset (42%), 427 hrs, 13 dumps, $3,100 JSC → $41,038.43
Deno.test("high markup 42% matches live record Sean Michaelis", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 427,
    dumpCount: 13, jobSpecificCosts: 3100, markupPct: 42,
  });
  assertEquals(out.totalBid, 41038.43);
});

// Dr. Russell's Office Space (live): zero dumps, JSC-heavy
// 170 hrs, 0 dumps, $1,500 JSC, 25% → $12,717.56
Deno.test("zero dumps matches live record Dr. Russell's", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 170,
    dumpCount: 0, jobSpecificCosts: 1500, markupPct: 25,
  });
  assertEquals(out.totalBid, 12717.56);
});

Deno.test("true margin: entered 25 markup realises ~19.3% of revenue (DISCOVERY §1)", () => {
  const out = computeEstimate({
    laborMethod: "total_hours", totalJobHours: 100,
    dumpCount: 0, jobSpecificCosts: 0, markupPct: 25,
  });
  // labor 2600 + overhead 2300 = 4900; profit 1225; cc 214.38; totalBid 6339.38
  // trueMargin = 1225 / 6339.38 × 100 = 19.32%
  assertEquals(out.trueMarginPct, 19.32);
});

Deno.test("custom rates override DEFAULT_RATES", () => {
  const out = computeEstimate(
    { laborMethod: "total_hours", totalJobHours: 10, dumpCount: 1, jobSpecificCosts: 0, markupPct: 25 },
    { ...DEFAULT_RATES, ccFeeRate: 0.03 },
  );
  // (260+300+230) × 1.25 = 987.50; cc = 29.63 (@3%); total = 1017.13
  assertEquals(out.ccFee, 29.63);
  assertEquals(out.totalBid, 1017.13);
});

Deno.test("validation: rejects bad inputs", () => {
  const base = { laborMethod: "total_hours" as const, totalJobHours: 10, dumpCount: 1, jobSpecificCosts: 0, markupPct: 25 };
  assertThrows(() => computeEstimate({ ...base, totalJobHours: undefined }));
  assertThrows(() => computeEstimate({ ...base, totalJobHours: -1 }));
  assertThrows(() => computeEstimate({ ...base, dumpCount: -0.5 }));
  assertThrows(() => computeEstimate({ ...base, markupPct: NaN }));
  assertThrows(() => computeEstimate({ ...base, jobSpecificCosts: -100 }));
  assertThrows(() => computeEstimate({ laborMethod: "days_employees", dumpCount: 1, jobSpecificCosts: 0, markupPct: 25 })); // missing days/employees
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/_shared/pricing_test.ts`
Expected: FAIL — `Module not found ... pricing.ts`

- [ ] **Step 3: Write the implementation**

Write `supabase/functions/_shared/pricing.ts`:

```ts
// ============================================================
// Lost Boys Demolition — pricing engine
// Ports the live Fillout calculator chain EXACTLY (DISCOVERY_2026-07-31.md §1).
// Cost-plus MARKUP, never a margin divisor. Verified to the cent against all
// 321 live Airtable estimates (see pricing_golden_test.ts).
// ============================================================

export interface Rates {
  laborRatePerHour: number;
  overheadRatePerHour: number;
  dumpRatePerLoad: number;
  ccFeeRate: number; // e.g. 0.035
}

export const DEFAULT_RATES: Rates = {
  laborRatePerHour: 26,
  overheadRatePerHour: 23,
  dumpRatePerLoad: 300,
  ccFeeRate: 0.035,
};

export type LaborMethod = "total_hours" | "days_employees";

export interface EstimateInputs {
  laborMethod: LaborMethod;
  totalJobHours?: number;   // required when laborMethod === "total_hours"
  daysAtJob?: number;       // required when laborMethod === "days_employees"
  numEmployees?: number;    // required when laborMethod === "days_employees"
  dumpCount: number;        // fractional allowed (0.5 observed live)
  jobSpecificCosts: number; // "Direct Costs" / rentals etc.
  markupPct: number;        // whole number, e.g. 25 — a MARKUP on cost, not a margin
}

export interface EstimateOutputs {
  effectiveHours: number;
  laborCost: number;
  dumpFees: number;
  totalDirect: number;
  overhead: number;
  profit: number;
  ccFee: number;
  totalBid: number;
  trueMarginPct: number; // profit / totalBid × 100 — reported alongside the markup
}

export function roundToCent(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function requireFinite(name: string, v: number | undefined, { min = 0 } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`pricing: ${name} must be a finite number, got ${v}`);
  }
  if (v < min) throw new Error(`pricing: ${name} must be >= ${min}, got ${v}`);
  return v;
}

export function computeEstimate(
  inputs: EstimateInputs,
  rates: Rates = DEFAULT_RATES,
): EstimateOutputs {
  const dumpCount = requireFinite("dumpCount", inputs.dumpCount);
  const jobSpecificCosts = requireFinite("jobSpecificCosts", inputs.jobSpecificCosts);
  const markupPct = requireFinite("markupPct", inputs.markupPct);

  let effectiveHours: number;
  if (inputs.laborMethod === "total_hours") {
    effectiveHours = requireFinite("totalJobHours", inputs.totalJobHours);
  } else if (inputs.laborMethod === "days_employees") {
    const days = requireFinite("daysAtJob", inputs.daysAtJob);
    const emps = requireFinite("numEmployees", inputs.numEmployees);
    effectiveHours = days * emps * 8;
  } else {
    throw new Error(`pricing: unknown laborMethod ${(inputs as { laborMethod: string }).laborMethod}`);
  }

  const laborCost = roundToCent(rates.laborRatePerHour * effectiveHours);
  const dumpFees = roundToCent(rates.dumpRatePerLoad * dumpCount);
  const totalDirect = roundToCent(laborCost + dumpFees + jobSpecificCosts);
  const overhead = roundToCent(rates.overheadRatePerHour * effectiveHours);
  const profit = roundToCent((totalDirect + overhead) * markupPct / 100);
  const ccFee = roundToCent((totalDirect + overhead + profit) * rates.ccFeeRate);
  const totalBid = roundToCent(totalDirect + overhead + profit + ccFee);
  const trueMarginPct = totalBid === 0 ? 0 : roundToCent((profit / totalBid) * 100);

  return { effectiveHours, laborCost, dumpFees, totalDirect, overhead, profit, ccFee, totalBid, trueMarginPct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/pricing_test.ts`
Expected: PASS (9 tests). If Jorge's/Sean's totals are off by a cent, the rounding point differs from the reference — every intermediate (labor, dump, totalDirect, overhead, profit, ccFee, totalBid) must round to cent exactly where shown; do not add or remove a rounding step.

- [ ] **Step 5: Type-check and commit**

Run: `deno check supabase/functions/_shared/pricing.ts supabase/functions/_shared/pricing_test.ts`
Expected: clean.

```bash
git add supabase/functions/_shared/pricing.ts supabase/functions/_shared/pricing_test.ts
git commit -m "feat: pricing engine — exact TypeScript port of the live Fillout chain"
```

---

### Task 2: Golden-master test — all 321 real estimates

**Files:**
- Create: `supabase/functions/_shared/pricing_golden_test.ts`
- Read-only: `supabase/functions/_shared/fixtures/estimates-golden-321.json` (already committed — do not modify)

**Interfaces:**
- Consumes: `computeEstimate`, `DEFAULT_RATES` from Task 1 (exact signatures above).
- Produces: nothing — a regression gate. This test IS Phase B's acceptance criterion ("reproduce today's prices to the cent").

Fixture record shape (each of 321 entries):

```json
{
  "estimate_id": 1226, "job_name": "…", "created": "2026-06-22T17:21:01.000Z",
  "estimate_date": "2026-06-22", "method": "Total Job Hours",
  "hours": 105, "days": null, "emps": null, "dumps": 3, "jsc": 0, "profit_pct_in": 30,
  "stored": { "labor": 2730, "dump": 900, "supplies": 0, "total_direct": 3630,
              "overhead": 2415, "profit": 1813.5, "cc": 275.05, "revenue": 8133.55 }
}
```

`method` is the Airtable string: `"Total Job Hours"` or `"Days at job/Number of Employees"`.

- [ ] **Step 1: Write the failing golden-master test**

Write `supabase/functions/_shared/pricing_golden_test.ts`:

```ts
import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEstimate, type EstimateInputs } from "./pricing.ts";

interface FixtureRecord {
  estimate_id: number;
  job_name: string | null;
  method: string;
  hours: number | null;
  days: number | null;
  emps: number | null;
  dumps: number | null;
  jsc: number | null;
  profit_pct_in: number | null;
  stored: {
    labor: number | null; dump: number | null; supplies: number | null;
    total_direct: number | null; overhead: number | null; profit: number | null;
    cc: number | null; revenue: number;
  };
}
// Note: estimate 1057 ("Test Job") has a NULL stored total_direct — the only
// null output field in the dataset. Null stored fields are skipped, not asserted.

// The 2026-03-19T17:21:17Z bulk-import batch: hand-keyed historical backfill,
// never produced by the live calculator. Diffs (stored − computed revenue) are
// locked so silent drift in either direction fails loudly.
// See research doc §2 for the per-record causes ($150/$250/$375 dump rates, off-rate labor).
const KNOWN_LEGACY_DIFFS: Record<number, number> = {
  1007: -30.43, 1019: -30.42, 1025: -186.30, 1031: -186.30, 1039: -186.30,
  1040: -186.30, 1041: -186.30, 1046: 93.15, 1048: -30.42, 1049: 93.15, 1056: -186.30,
};
// Zao Remodel (HVAC), live record with a single $0.01 rounding artifact in Fillout's output.
const PENNY_TOLERANCE_IDS = new Set([1075]);

function toInputs(r: FixtureRecord): EstimateInputs {
  const base = {
    dumpCount: r.dumps ?? 0,
    jobSpecificCosts: r.jsc ?? 0,
    markupPct: r.profit_pct_in ?? 0,
  };
  if (r.method === "Days at job/Number of Employees") {
    return { ...base, laborMethod: "days_employees", daysAtJob: r.days ?? 0, numEmployees: r.emps ?? 0 };
  }
  return { ...base, laborMethod: "total_hours", totalJobHours: r.hours ?? 0 };
}

const fixturePath = new URL("./fixtures/estimates-golden-321.json", import.meta.url);
const records: FixtureRecord[] = JSON.parse(Deno.readTextFileSync(fixturePath));

Deno.test("fixture contains all 321 estimates", () => {
  assertEquals(records.length, 321);
});

Deno.test("golden master: every live-calculator estimate reproduces to the cent", () => {
  let exact = 0;
  for (const r of records) {
    const out = computeEstimate(toInputs(r));
    const label = `estimate ${r.estimate_id} (${r.job_name ?? "no name"})`;

    if (r.estimate_id in KNOWN_LEGACY_DIFFS) {
      assertAlmostEquals(
        r.stored.revenue - out.totalBid, KNOWN_LEGACY_DIFFS[r.estimate_id], 0.005,
        `${label}: legacy diff drifted — engine or fixture changed`,
      );
      continue;
    }
    if (PENNY_TOLERANCE_IDS.has(r.estimate_id)) {
      assertAlmostEquals(out.totalBid, r.stored.revenue, 0.011, `${label}: beyond penny tolerance`);
      continue;
    }
    // Null stored fields (rare data gaps in Airtable) are skipped; revenue is always asserted.
    if (r.stored.labor !== null) assertEquals(out.laborCost, r.stored.labor, `${label}: labor`);
    if (r.stored.dump !== null) assertEquals(out.dumpFees, r.stored.dump, `${label}: dump`);
    if (r.stored.total_direct !== null) assertEquals(out.totalDirect, r.stored.total_direct, `${label}: totalDirect`);
    if (r.stored.overhead !== null) assertEquals(out.overhead, r.stored.overhead, `${label}: overhead`);
    if (r.stored.profit !== null) assertEquals(out.profit, r.stored.profit, `${label}: profit`);
    if (r.stored.cc !== null) assertEquals(out.ccFee, r.stored.cc, `${label}: ccFee`);
    assertEquals(out.totalBid, r.stored.revenue, `${label}: totalBid`);
    exact++;
  }
  assertEquals(exact, 309, "expected exactly 309 cent-exact records (321 − 11 legacy − 1 penny)");
});
```

- [ ] **Step 2: Run and iterate to green**

Run: `deno test supabase/functions/_shared/pricing_golden_test.ts`
Expected: PASS — 309 exact, 11 locked legacy diffs, 1 penny-tolerance. If any *live* record (not in the two allowlists) fails, that is a defect in the engine's rounding or chain — fix `pricing.ts`, never the fixture, never the allowlists. If a per-field assertion fails on `stored.supplies` semantics: `supplies` mirrors `jsc` and is not an engine output — it is deliberately not asserted.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/pricing_golden_test.ts
git commit -m "test: golden master — engine reproduces all 321 live estimates to the cent"
```

---

### Task 3: Estimates schema migration

**Files:**
- Create: `supabase/migrations/20260814_phase_b_estimates_schema.sql`

**Interfaces:**
- Consumes: existing `jobs.job_number` (text PK on the Phase A `jobs` table) for the optional estimate→job link.
- Produces: tables `scope_library`, `pricing_variables`, `estimates`, `estimate_line_items`; enum `estimate_status`; sequence `estimate_number_seq` (starts 1400; 1001–1321 reserved for a future Airtable backfill); trigger `enforce_estimate_immutability`. Task 4 seeds `scope_library` and `pricing_variables`.

- [ ] **Step 1: Write the migration**

Write `supabase/migrations/20260814_phase_b_estimates_schema.sql`:

```sql
-- Phase B slice 1: canonical estimating schema.
-- Estimates are immutable versioned snapshots (BUILD_PLAN.md design decision 1):
-- computed + input columns are frozen by trigger; a correction is a NEW version row.

create table scope_library (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_description text not null default '',
  default_labor_hours numeric(6,2) not null,
  default_dump_count numeric(5,1) not null,
  default_materials_cost numeric(10,2),  -- NULL until Phase G seeds it from actuals
  job_type_applicability text[] not null default '{Residential,Commercial}',
  active boolean not null default true,
  airtable_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pricing_variables (
  key text primary key,
  value numeric(10,4) not null,
  description text not null default '',
  effective_from date not null default current_date,
  updated_at timestamptz not null default now()
);

create sequence estimate_number_seq start 1400;  -- 1001–1321 reserved for Airtable history

create type estimate_status as enum
  ('draft','sent','accepted','declined','superseded','historical');

create table estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number int not null default nextval('estimate_number_seq'),
  version int not null default 1,
  supersedes_estimate_id uuid references estimates(id),
  status estimate_status not null default 'draft',
  -- context (free text mirrors today's reality; job link set at promotion)
  job_number text references jobs(job_number),
  job_name text,
  client_name text,
  client_type text check (client_type in ('Contractor','Homeowner')),
  client_email text,
  client_phone text,
  job_address text,
  city text,
  job_type text check (job_type in ('Residential','Commercial')),
  estimate_date date not null default current_date,
  job_details text,
  -- inputs (what the estimator chose)
  labor_method text not null check (labor_method in ('total_hours','days_employees')),
  total_job_hours numeric(7,2),
  days_at_job numeric(5,2),
  num_employees numeric(5,2),
  dump_count numeric(5,1) not null default 0,       -- fractional allowed (0.5 live)
  job_specific_costs numeric(10,2) not null default 0,
  markup_pct numeric(5,2) not null,                 -- cost-plus MARKUP, not margin
  -- rate snapshot (so historical estimates stay reproducible if rates change)
  labor_rate numeric(6,2) not null,
  overhead_rate numeric(6,2) not null,
  dump_rate numeric(6,2) not null,
  cc_fee_rate numeric(6,4) not null,
  -- engine outputs (written by computeEstimate, never hand-edited)
  labor_cost numeric(12,2) not null,
  dump_fees numeric(12,2) not null,
  total_direct numeric(12,2) not null,
  overhead numeric(12,2) not null,
  profit numeric(12,2) not null,
  cc_fee numeric(12,2) not null,
  total_bid numeric(12,2) not null,
  true_margin_pct numeric(5,2) not null,
  -- what was ACTUALLY quoted, when it differs from the calculation
  -- (live finding: Dane discounted a $41,038.43 calc to $39,000 with no field to record it)
  quoted_price numeric(12,2),
  quote_override_reason text,
  source text not null default 'app' check (source in ('app','airtable_backfill')),
  airtable_estimate_id int,
  created_at timestamptz not null default now(),
  unique (estimate_number, version),
  constraint labor_method_fields check (
    (labor_method = 'total_hours' and total_job_hours is not null)
    or
    (labor_method = 'days_employees' and days_at_job is not null and num_employees is not null)
  )
);

create table estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  scope_library_id uuid references scope_library(id),
  name text not null,                    -- snapshot of the Scope Library name (controlled vocabulary)
  description text not null default '',
  labor_hours numeric(7,2) not null default 0,
  dump_count numeric(5,1) not null default 0,
  materials_cost numeric(10,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Immutability: after insert, only status / quoted_price / quote_override_reason /
-- job_number may change. Anything else must be a new version row.
create function enforce_estimate_immutability() returns trigger
language plpgsql as $$
begin
  if new.id                    is distinct from old.id
    or new.estimate_number     is distinct from old.estimate_number
    or new.version             is distinct from old.version
    or new.supersedes_estimate_id is distinct from old.supersedes_estimate_id
    or new.job_name            is distinct from old.job_name
    or new.client_name         is distinct from old.client_name
    or new.client_type         is distinct from old.client_type
    or new.client_email        is distinct from old.client_email
    or new.client_phone        is distinct from old.client_phone
    or new.job_address         is distinct from old.job_address
    or new.city                is distinct from old.city
    or new.job_type            is distinct from old.job_type
    or new.estimate_date       is distinct from old.estimate_date
    or new.job_details         is distinct from old.job_details
    or new.labor_method        is distinct from old.labor_method
    or new.total_job_hours     is distinct from old.total_job_hours
    or new.days_at_job         is distinct from old.days_at_job
    or new.num_employees       is distinct from old.num_employees
    or new.dump_count          is distinct from old.dump_count
    or new.job_specific_costs  is distinct from old.job_specific_costs
    or new.markup_pct          is distinct from old.markup_pct
    or new.labor_rate          is distinct from old.labor_rate
    or new.overhead_rate       is distinct from old.overhead_rate
    or new.dump_rate           is distinct from old.dump_rate
    or new.cc_fee_rate         is distinct from old.cc_fee_rate
    or new.labor_cost          is distinct from old.labor_cost
    or new.dump_fees           is distinct from old.dump_fees
    or new.total_direct        is distinct from old.total_direct
    or new.overhead            is distinct from old.overhead
    or new.profit              is distinct from old.profit
    or new.cc_fee              is distinct from old.cc_fee
    or new.total_bid           is distinct from old.total_bid
    or new.true_margin_pct     is distinct from old.true_margin_pct
    or new.source              is distinct from old.source
    or new.airtable_estimate_id is distinct from old.airtable_estimate_id
    or new.created_at          is distinct from old.created_at
  then
    raise exception 'estimates are immutable — write a new version row instead (estimate %)', old.estimate_number;
  end if;
  return new;
end $$;

create trigger estimates_immutable
  before update on estimates
  for each row execute function enforce_estimate_immutability();

-- RLS posture: enabled, no policies (service_role bypasses; anon denied).
alter table scope_library enable row level security;
alter table pricing_variables enable row level security;
alter table estimates enable row level security;
alter table estimate_line_items enable row level security;

create index estimates_job_number_idx on estimates (job_number);
create index estimates_status_idx on estimates (status);
create index estimate_line_items_estimate_idx on estimate_line_items (estimate_id);
```

- [ ] **Step 2: Apply to the live project**

Apply via `mcp__claude_ai_Supabase__apply_migration` (project `eiqqqwajmcpcwhvxxnhx`, name `phase_b_estimates_schema`) with EXACTLY the file's SQL.

- [ ] **Step 3: Verify live**

Via `mcp__claude_ai_Supabase__execute_sql`:

```sql
-- expect 4 rows, all rowsecurity = true, 0 policies
select c.relname, c.relrowsecurity,
  (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c
where c.relname in ('scope_library','pricing_variables','estimates','estimate_line_items');
```

Then a live trigger check (insert → forbidden update → allowed update → clean up):

```sql
begin;
insert into estimates (job_name, labor_method, total_job_hours, dump_count, job_specific_costs,
  markup_pct, labor_rate, overhead_rate, dump_rate, cc_fee_rate,
  labor_cost, dump_fees, total_direct, overhead, profit, cc_fee, total_bid, true_margin_pct)
values ('TRIGGER TEST', 'total_hours', 10, 1, 0, 25, 26, 23, 300, 0.035,
  260.00, 300.00, 560.00, 230.00, 197.50, 34.56, 1022.06, 19.32);
update estimates set total_bid = 999 where job_name = 'TRIGGER TEST'; -- expect: raises
rollback;
```

Expected: the UPDATE errors with `estimates are immutable`; the transaction rolls back leaving nothing. Then confirm `update estimates set status = …` on a fresh test row inside another rolled-back transaction succeeds (allowed column).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260814_phase_b_estimates_schema.sql
git commit -m "feat: Phase B estimates schema — immutable versioned estimates, scope library, pricing variables"
```

---

### Task 4: Seed scope library + pricing variables

**Files:**
- Create: `supabase/migrations/20260814_phase_b_seeds.sql`

**Interfaces:**
- Consumes: Task 3's tables.
- Produces: 19 `scope_library` rows (verbatim from the live Airtable base — research doc §3) and 6 `pricing_variables` rows carrying the CORRECT live-verified values.

- [ ] **Step 1: Write the seed migration**

Write `supabase/migrations/20260814_phase_b_seeds.sql` exactly as follows (descriptions are the
full live Airtable text, pulled 2026-08-14; `airtable_record_id` is the source row's ID for
provenance; `default_materials_cost` stays NULL on every row by design — it is a Phase G output):

```sql
insert into pricing_variables (key, value, description) values
  ('labor_rate_per_hour',   26,     'Standard estimating labor rate. True all-in cost ~ $23.13/hr (DISCOVERY §5) — do NOT correct in isolation; see the four-pads rule.'),
  ('overhead_rate_per_hour',23,     'Overhead allocation per productive hour.'),
  ('dump_rate_per_load',    300,    'PRICING RATE per dump load, not a cost. Median actual cost $65 — the spread is deliberate risk pricing (DISCOVERY §4).'),
  ('cc_fee_rate',           0.035,  'Credit card fee charged on every estimate. Live-verified against all 321 estimates; the Airtable 3% row was never live.'),
  ('default_markup_pct',    25,     'Default cost-plus MARKUP (an entered 25 realises ~19.3% true margin).'),
  ('markup_floor_pct',      15,     'Advisory floor for per-job markup override (realises ~12.6% true margin).');

insert into scope_library (name, default_description, default_labor_hours, default_dump_count, airtable_record_id) values
  ('Flooring Removal', 'Remove existing flooring throughout designated areas. Ensure proper preparation of substrate. Provide dust control and protection of adjacent areas. Haul off all debris and dump.', 6, 1, 'rec0BGZ3OQ32F2FuI'),
  ('Exterior Demo', 'Remove designated exterior materials including siding, stucco, soffit, and fascia as specified. Haul off all debris and dump.', 16, 2, 'rec2SsAO3X5dwvxIg'),
  ('Jobsite Cleanup', 'Final broom-clean of all designated interior and exterior areas. Remove remaining debris and haul off. Leave jobsite in clean condition.', 3, 1, 'rec4SKUFezO7vsCK9'),
  ('Cabinet Removal', 'Remove and save or dispose of cabinets as designated. Ensure proper protection of adjacent surfaces. Haul off all debris and dump.', 4, 1, 'rec7Kgs56UoirhuuD'),
  ('Bathroom Demo', 'Full bathroom demolition including tile, fixtures, vanity, and drywall as designated. Ensure proper protection of adjacent areas. Haul off all debris and dump.', 6, 1, 'rec7PVHoI8KJD98ZC'),
  ('Concrete Demo', 'Break up and remove designated concrete. Haul off all concrete and dump at approved facility.', 8, 2, 'recDFf1ObCR4G0bfy'),
  ('Shed-Structure Removal', 'Demolish and remove designated structure. Haul off all debris and dump.', 6, 1, 'recFaqaGzB5FreUFm'),
  ('Ceiling Demo', 'Remove ceiling material in designated areas. Provide dust control and floor protection throughout. Haul off all debris and dump.', 5, 1, 'recM0XYNnNElcOg0N'),
  ('Stair-Trim Demo', 'Remove stair finishes and trim throughout designated areas. Haul off all debris and dump.', 4, 1, 'recMKBe5wuqdv97Os'),
  ('Pool-Water Feature Demo', 'Demolish and remove designated water feature or pool structure. Haul off all debris and dump at approved facility.', 16, 2, 'recOAeUEmPJfY87rJ'),
  ('Kitchen Demo', 'Remove and haul off all kitchen cabinets, countertops, and backsplash. Ensure proper floor and wall protection throughout. Haul off all debris and dump.', 8, 1, 'recROUVpC6Yhw5tWq'),
  ('Fireplace Demo', 'Demolish designated fireplace and surround. Provide dust control, floor protection, and plastic barriers. Haul off all debris and dump.', 6, 1, 'recSKWDgqmR6FFJc2'),
  ('Junk Removal-Cleanout', 'Remove all designated junk and debris from property. Haul off and dump at approved facility.', 4, 1, 'recYj88oPbfgj7ZQ0'),
  ('Window-Door Removal', 'Remove designated windows and doors. Protect surrounding surfaces. Haul off all debris and dump.', 4, 1, 'receEdjYpgB15PFPs'),
  ('Deck-Patio Removal', 'Remove designated deck or patio structure. Haul off all debris and dump.', 8, 1, 'recnyGG4gTGbV6nTX'),
  ('Carport Removal', 'Remove designated carport structure. Haul off all debris and dump.', 6, 1, 'recra0JwRStTFMIBP'),
  ('Construction Debris Hauling', 'Load and haul off all construction debris from designated areas. Dump at approved facility.', 4, 1, 'recsE1PBOYqAKsTxB'),
  ('Drywall-Wall Demo', 'Remove drywall and framing in designated areas per plans. Ensure proper dust control and protection of adjacent surfaces. Haul off all debris and dump.', 6, 1, 'recv1hBnDrjL1u92v'),
  ('Full House Gut', 'Complete interior demolition down to studs including flooring, walls, ceilings, trim, and fixtures as designated. Provide dust control and floor protection throughout. Haul off all debris and dump.', 40, 4, 'recvnRdWHLQCCJCoL');
```

- [ ] **Step 2: Apply + verify**

Apply via `mcp__claude_ai_Supabase__apply_migration` (name `phase_b_seeds`), then:

```sql
select count(*) from scope_library;                          -- expect 19
select count(*) from pricing_variables;                      -- expect 6
select value from pricing_variables where key = 'cc_fee_rate'; -- expect 0.0350
select name from scope_library where default_materials_cost is not null; -- expect 0 rows
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260814_phase_b_seeds.sql
git commit -m "feat: seed scope library (19 live scopes) + corrected pricing variables (CC 3.5%)"
```

---

### Task 5: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Supabase Tables section: add the four new tables; Edge Functions section: note `_shared/pricing.ts`)
- Modify: `BUILD_LOG.md` (entry appended at session close per standing rule)

- [ ] **Step 1: Run the entire test suite**

Run: `deno test supabase/functions/_shared/`
Expected: all pass — the new pricing tests plus the existing `job_test.ts` suite, no regressions.

- [ ] **Step 2: Security/performance advisors**

Run `mcp__claude_ai_Supabase__get_advisors` (project `eiqqqwajmcpcwhvxxnhx`, both types). Expected: no new criticals attributable to the four new tables (RLS-enabled-no-policy notices are the accepted house posture; `enforce_estimate_immutability` may warn on mutable search_path — fix with `set search_path = ''` qualification only if flagged).

- [ ] **Step 3: Update CLAUDE.md tables section**

Add rows for `estimates`, `estimate_line_items`, `scope_library`, `pricing_variables` to the Supabase Tables table, with one-line purposes and the estimate-immutability rule.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: register Phase B slice-1 tables in CLAUDE.md"
```

---

## Verification (end-to-end)

1. `deno test supabase/functions/_shared/` — everything green, including the golden master's `exact = 309` count assertion.
2. `deno check` on `pricing.ts`, both test files — clean.
3. Live DB: 4 new tables, RLS on / 0 policies; trigger blocks a computed-column update and allows a status update; seeds count 19 + 6; `cc_fee_rate = 0.035`.
4. `mcp__claude_ai_Supabase__list_migrations` shows `phase_b_estimates_schema` and `phase_b_seeds`; both SQL files committed in the same session (parity rule).
5. The acceptance gate for this slice — **"reproduce today's prices to the cent"** — is machine-checked by `pricing_golden_test.ts` and will keep running on every future engine change.

## Explicitly deferred (recorded so they aren't lost)

- **Historical import** of the 321 Airtable estimates into `estimates` (as `status='historical'`, `source='airtable_backfill'`, numbers 1001–1321): needs a fuller Airtable pull (client fields aren't in the golden fixture). Next slice.
- **Estimate builder UI** (first Next.js/Vercel app code) and **GHL push** (line items + headline numbers): the next two Phase B plans.
- **Rates read from `pricing_variables` at runtime**: engine currently snapshots `DEFAULT_RATES`; DB-driven rates arrive with the UI slice.
- The Airtable `Pricing Variables` 3% row correction: leave Airtable untouched (read by nothing; parallel-running rule).
