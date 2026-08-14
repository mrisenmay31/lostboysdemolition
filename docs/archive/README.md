# docs/archive — superseded documents

Everything in this directory was **once authoritative and no longer is**. It is kept for
provenance: to explain how a decision was reached, or what a number used to be, when a current
doc contradicts an older one.

**Do not plan from anything in here.** The current, authoritative set lives at the repo root:

| Read this instead | For |
|---|---|
| `DISCOVERY_2026-07-31.md` | Business ground truth — real pricing formulas, financial analysis |
| `SYSTEM_AUDIT_2026-07-30.md` | Systems ground truth — live Airtable/Supabase/repo state |
| `BUILD_PLAN.md` | The official plan (A–G + Track B) |
| `BUILD_LOG.md` | Deploy + session history |
| `CLAUDE.md` | Entry point and repo map |

Filenames are unchanged from when these lived at the repo root, so older BUILD_LOG entries and
session transcripts that cite them by name still resolve — the path is now
`docs/archive/<name>` rather than `<name>`.

Archived 2026-08-14.

---

## Contents

| File | What it was | Superseded by | Why it was archived |
|---|---|---|---|
| `OPS_ROADMAP.md` | 2026-07-15 prospect→payment roadmap with its own 0–10 phase numbering | `BUILD_PLAN.md` | Carried its own "⚠️ SUPERSEDED — DO NOT PLAN FROM THIS DOCUMENT" banner. Its unique decisions (QuickBooks Online via Synder, the GHL number port + A2P registration, client sign-off, callback tracking, Stripe native invoice reminders, and the unresolved ClockShark-vs-in-house clock-in conflict) were migrated verbatim into `BUILD_PLAN.md` → "Carried over from OPS_ROADMAP.md" before archiving. Nothing unique is lost here. |
| `SCHEMA_AUDIT_REPORT.md` | 2026-04-29 Airtable schema audit | `SYSTEM_AUDIT_2026-07-30.md` | Predates significant base drift and contains a documented backwards recommendation about `Clients.Jobs`. |
| `schema_audit.json` | Raw 2026-04-29 Airtable schema dump (base `apptzp0IclCaAtOk2`, 9 tables) | same | The live base has drifted since. Generated output of the root `audit_schema.js`. |
| `schema_overview.md` | **Misnamed.** Supabase integration notes plus the retired 15-function `stageN-*` build sequence | `SYSTEM_AUDIT_2026-07-30.md` + `BUILD_PLAN.md` | Cited across several docs as "the Airtable schema reference." It never contained an Airtable schema. That false citation is the single most misleading thing in the old doc set — archiving it is the fix. |
| `LostBoys_PricingEngine_ProjectBrief.md` | 2026-04-29 comprehensive project brief — company, personnel, pricing model | `DISCOVERY_2026-07-31.md` | Its pricing description predates the 2026-07-31 correction (cost-plus **markup**, not a margin divisor) and it propagates the `schema_overview.md` misattribution above. |
| `jobs_schema_prompt.txt` | Chat fragment: the Scope Library schema addition plus a paste-into-Claude-Code prompt | — | April-era build scaffolding. Referenced only by `LostBoys_PricingEngine_ProjectBrief.md`, itself archived here. |
| `lostboys_demolition_airtable_prompt.txt` | The original "build the Airtable backend" mega-prompt | — | The prompt that started the Airtable build. Zero references anywhere in the repo. |
| `prompt.md` | One-off May-2026 session prompt: populate all GHL opportunity custom fields at job creation | — | That work shipped as `airtable-job-created` v21 (commit `0dd5103`). The prompt also instructs the reader to treat `schema_overview.md` as the schema reference, which is wrong (see above). |

---

## Not archived, despite looking archivable

Recorded here because each was considered and deliberately left at the repo root:

- **`field_mapping.md`, `ghl_field_mapping.md`** — load-bearing. Live code in
  `web/src/lib/ghl/estimateFields.ts`, `supabase/functions/ghl-job-webhook/handlers.ts`, and
  `supabase/functions/airtable-job-created/index.ts` cites them **by filename** as the sole
  authority for every hard-coded GHL custom field ID. Moving them breaks that documented
  provenance chain.
- **`WORKFLOW_OVERVIEW_2026-07-31.md`** — not stale. It is Matt's raw source prose, and
  `DISCOVERY_2026-07-31.md` was built from it. It looked orphaned only because `CLAUDE.md`'s
  repo-structure tree omitted it; that omission is now fixed rather than the file archived.
- **`INTEGRATION_DESIGN.md`** — April-era and still marked "Draft — awaiting Matt's
  verification," but its edge-case rules are cited by `supabase/functions/ghl-job-webhook/index.ts`.
  Archiving it requires editing that comment, so it is deferred to a session that can touch code.
- **The root Airtable admin scripts** (`setup_airtable.js`, `setup_airtable_v2.js`,
  `audit_schema.js`) and the root `package.json`/`package-lock.json` that exist to give them
  `dotenv` — orphaned one-shots for a platform being retired, but out of scope for a docs-only
  pass. ⚠️ Re-running either `setup_airtable*.js` against the drifted live base would be actively
  harmful. `create-ghl-fields.js` is the exception and should stay regardless: it targets GHL (a
  retained system), is idempotent, and regenerates `ghl_field_mapping.md`.
