# Job Cockpit — design brainstorm (DRAFT)

**Date:** 2026-08-18
**Status:** 🟡 **DRAFT — design direction only. Nothing built, nothing approved.**
**Author:** brainstorming session with Matt
**Awaiting:** Matt's review + the remaining Fillout screenshots (foreman checklists especially)

> This is a design conversation captured for later review, in the same spirit as
> `2026-08-18-bl6-echo-guard-design-DRAFT.md`. It is **not** a build brief and must not be
> executed from. Turning it into a build brief is a separate step, after Matt's review and after
> the open questions in §9 are answered.

---

## 1. Context — what Matt asked for

Matt wants **one job record** that carries a job from bid through completion:

- **prefilled from GHL**, so repeat contractors aren't retyped every time
- **updatable** when scope changes (change orders) or when anything else moves (schedule date, crew)
- showing **estimate vs actual profitability while the job is still running**, refreshed on a
  regular cadence — ideally nightly — so anyone can open a job and see how it's trending

He supplied five screenshots of the legacy Fillout bid form as reference (Job Information, Client
Information, Financial Information, the estimate/actual column pairs, and Job Scope line items).
More screenshots are coming.

### Where the system actually stands today

- The web app at https://lostboysdemolition.vercel.app is **estimates-only**. Routes are
  `/estimates`, `/estimates/new`, `/estimates/[id]`, `/estimates/[id]/revise`, plus a `/` redirect.
  Bottom nav has two items.
- **There is no jobs UI at all.** No `/jobs` route, no dashboard, and nothing in `web/src` ever
  selects from the `jobs` table.
- The `jobs` table is live and healthy (Phase A keystone), holding 2 cancelled test rows.
- **Every actuals table is at 0 rows** — `time_entries`, `labor_actuals`, `expense_actuals`. In the
  Airtable era every variance field read **−100%**, and the two most important variance formulas
  were additionally broken outright (referencing deleted fields).
- `repo.updateJobNumber()` — the promote-to-job primitive — is exported and **called by nothing**.
- `jobs.bill_job_code` exists and has **never been written**.

### The lesson from the Fillout form

The reference form puts **Estimate** and **Actual** side by side as *typed input fields*: Direct
Labor Costs Actual, Dump Fees Actual, Credit Card Fee Actual, Profit Margin Actual, Total Actual.

That is exactly why every actuals table is empty. Nobody types actuals. So the governing rule for
the rebuild:

> ### ⭐ Actuals must never be a form field.
> They arrive from systems — **BILL** for expenses and dump loads, **timekeeping** for labor,
> **Stripe** for revenue. The only human input is the *exception*.

---

## 2. Decisions Matt made in this session

| # | Question | Decision |
|---|---|---|
| 1 | Labor capture | **Replace the Gusto app for field time.** Either adopt a purpose-built timekeeping app or build something simple ourselves. **Buy-vs-build still open** — see §6. |
| 2 | Change orders | Deferred to recommendation → **separate `change_orders` table** (§5) |
| 3 | Cockpit home | **Both** — full page in the web app **and** headline numbers + a deep link on the GHL opportunity |
| 4 | Client prefill | **Automatic link between GHL contacts and Supabase** — mirror contacts locally, search locally |

Decision 1 supersedes the four options in `BUILD_PLAN.md`'s Phase D and closes open decision #3 in
principle, though the buy-vs-build sub-question remains. It also finally resolves the
**ClockShark-vs-in-house conflict carried over from `OPS_ROADMAP.md` that CLAUDE.md records as
never explicitly settled.**

---

## 3. The reframe — the job is the spine, the estimate is an artifact of it

Today an estimate is the destination. Matt is asking for the **job** to be the destination, with
the estimate as the thing that starts it and becomes its baseline.

**Recommended: one page, two phases, visually continuous.**

- **Before acceptance** → `/estimates/[id]` (exists today). The estimate *is* the record.
- **After acceptance** → `/jobs/[jobNumber]` (new). The job adopts the accepted estimate as its
  baseline; the estimate page gains a `→ JOB-1234` link forward.

**Do not mint job records at estimate time.** Phase A mints `JOB-XXXX` at Quote Accepted in GHL and
is live, verified and working; `promoteEstimateForJob()` already writes `estimates.job_number` and
is live-proven. Disturbing that keystone to satisfy a URL is not worth it.

Bottom nav becomes **Jobs | Estimates | New**.

### Two audiences, and a hard rule

| | Office (Dane, Jackson, Matt) | Crew (foremen) |
|---|---|---|
| Money | Everything | **Never** |
| Scope, schedule, address, contact | Yes | Yes |
| Hours logged | All crews | Their own crew |

**No pricing may reach a crew-facing surface.** That rule already holds on crew Slack (BL-4) and
crew calendar events (BL-5). A job page a foreman opens on his phone is the **third** surface and it
must hold there too. `jobs.scope_summary` already carries a `MUST NOT contain pricing` column
comment — extend the same discipline, and assert it in tests.

---

## 4. ⭐ The three-column money model — the most important idea in this document

This is what makes or breaks the feature, and it is where a naive build goes badly wrong.

> **The estimate produces a PRICE, built from charge rates. Variance needs a COST baseline.
> They are not the same numbers.**

| Line | Quoted (client pays) | **Cost budget** (what we expect to spend) | Actual |
|---|---|---|---|
| Labor | hours × **$26** | hours × **true wage** (~$23.13 all-in, or real `users.hourly_rate`) | logged hours × real wage |
| Dump | loads × **$300** | loads × **~$65 expected** | BILL transactions |
| Materials / direct | `job_specific_costs` | same | BILL transactions |
| Overhead | hours × $23 | hours × $23 | allocation, not an actual |

### 🚨 The trap this avoids

If the cockpit compares **actual dump cost ($65 median)** against the estimate's **dump fee ($300)**,
every job shows a fake **~78% favorable** dump variance.

Per `DISCOVERY_2026-07-31.md` §7, the dump pad is worth **+$221k/yr** and has been almost exactly
**financing a −$246k/yr labor-hours shortfall** (~14,300 hours bid vs ~26,800 actual). A cockpit
built on the estimate's *dollar outputs* would tell Dane every job is a triumph while hiding the one
gap the tool exists to find.

**Therefore: derive the cost budget from the estimate's *quantities* (hours, loads, materials),
priced at *cost* rates. Never from the estimate's dollar outputs.**

### Two variances, never blended

- **Quantity variance** — hours and loads. Operational. Feeds scope calibration (Phase G).
  **Never touches price.**
- **Cost variance** — dollars. Financial. Feeds margin reporting.

DISCOVERY §4 calls this out specifically for dumps: load-count variance and dump-cost variance are
two different numbers for two different audiences.

### The headline number

**Gross profit = Quoted (incl. approved change orders) − Actual cost.**

That is what Dane actually wants, and it stays honest regardless of how wrong any individual rate is.

### Governing constraint (non-negotiable)

DISCOVERY's ruling stands: **no quoted price may move.** This cockpit is a **reporting surface**.
Nothing it computes may feed back into a price until all four pads are corrected together, as one
decision, on real data. This belongs as a comment in the code, not just in this doc.

---

## 5. Change orders — recommendation: a separate table

Matt asked for a recommendation. **Build a `change_orders` table.**

### Why

1. **It answers a different question.** An estimate version answers *"what did we quote?"* A change
   order answers *"what did the client additionally approve, when, and who asked for it?"*
   Collapsing them into a version loses the second question entirely.
2. **The invoice needs it itemized.** Today Dane has to *remember* to add it (per
   `WORKFLOW_OVERVIEW_2026-07-31.md`). **83% of invoices already have exactly one line item** —
   that's the disease, not the cure.
3. **The field workflow is different.** The **foreman** originates it ("client wants the deck too").
   He can't and shouldn't re-version an estimate. He should raise a request from his phone; Dane
   prices and approves it. That's a small record with a status, not an estimate rebuild.
4. **Variance is meaningless without it.** An untracked $3k change order makes a job look like a 37%
   cost overrun when it was scope growth. Per BUILD_PLAN Phase F this is about **attribution, not
   revenue recovery** — leakage is already <10%, measured at ~$26,750 across 18 instances on ~35% of
   jobs.
5. **Immutability is preserved.** Each change order is append-only and priced through the same
   golden-tested `computeEstimate()`. The audit story is identical.

### The crisp rule to teach Dane and Jackson

> **Revise** = *we got the estimate wrong.* (before acceptance)
> **Change order** = *the job got bigger.* (after acceptance)

**Contract value = accepted estimate `quoted_price` + Σ approved change orders.** Variance measures
against **that**, never the original estimate alone.

### ⚠️ This deviates from BUILD_PLAN

`BUILD_PLAN.md` design decision 1 says *"a change order writes a new version."* That decision
predates both the estimate builder and the finding that invoices are 83% single-line. If this
recommendation is accepted, **amend `BUILD_PLAN.md` explicitly** rather than diverge quietly.

---

## 6. Labor capture — the decision that actually unblocks profitability

Matt's call: **replace the Gusto app for field time.** Gusto keeps running payroll; job attribution
becomes ours. CLAUDE.md already records that **manual payroll entry is acceptable**, so we are not
forced to solve the Gusto push in order to ship this.

### The insight that makes it work

Gusto project tracking failed **not because of crew compliance** — crews clock in reliably every
day. It failed because *someone had to manually create the project first*, and manually delete it
after, and that didn't happen consistently.

**We no longer have that problem.** `JOB-XXXX` is minted automatically at Quote Accepted, and crews
are assigned no later than 4pm the day before. So the app can open straight to **"Crew 1 — today"**
with one or two big buttons: the jobs actually scheduled for that crew, that day. Nothing to create,
nothing to search, nothing to delete.

### Build vs buy

**Leaning build.** The schema already exists and is real: `time_entries` (with a live
`calculate_duration_and_cost` trigger), `users` (with `hourly_rate`), `crews`. The mobile PWA exists.
The no-login model exists. The "jobs scheduled for your crew today" query is three lines. A
third-party tool would still require syncing jobs into it — which is most of the work anyway.

**The honest case for buying** (ClockShark / Busybusy / Workyard): overtime-rule compliance, offline
capture on bad job-site signal, GPS/geofence verification, and a defensible audit trail for a wage
dispute. Those are real, and the compliance one is a **liability** question, not a features
question. At ~25 crew it runs roughly $200–300/month.

**Decide on:** do you need offline capture, GPS verification, and automated overtime rules?
If yes → buy. If no → build, and it's a small build.

### ⚠️ Blocker to clear first — BL-7

`time_entries`, `users` and `crews` carry **7 live RLS policies** that currently **raise**
(`permission denied for function get_my_role`) because EXECUTE was revoked in the 2026-08-17
security pass. Separately, `handle_new_auth_user()` has always been a silent no-op — which is why
`public.users` has 0 rows while `auth.users` has 1. **Clock-in cannot ship until BL-7 is settled.**

---

## 7. Expenses and dump counts — BILL (Phase C)

Unchanged from BUILD_PLAN, and the cheapest big win available:

- A `CUSTOM_SELECTOR` custom field with `allowCustomValues: true` lets crews tag `JOB-XXXX` at
  purchase time in the BILL mobile app.
- **One transaction = one dump load**, so this single integration delivers dump **cost** *and* dump
  **count** together — no foreman form change needed.
- `jobs.bill_job_code` **already exists and has never been written.**
- Rules from `INTEGRATION_DESIGN.md`, non-negotiable: ingest `CLEAR` only (skip `AUTHORIZATION`),
  skip split parents and ingest children via `parentTransactionUuid`, refunds as negative rows,
  **strict** exact job-code match (no lenient normalization), untagged → a needs-review queue.

**Only blocker: `BILL_API_TOKEN` does not exist in any environment.** Matt has to obtain it.

---

## 8. Prefill, data model, and architecture notes

### 8.1 Prefill — mirror GHL contacts into Supabase

Matt's decision. It's the right call: a local table is instant and can't be rate-limited, and **GHL
has no fuzzy contact search today** — `searchContactByEmail` is exact-match on email only, and there
is no client-picker UI or server action anywhere in `web/`.

**Recommended:** a proper `clients` mirror table, **GHL-authoritative**, kept fresh by the existing
`ghl-contact-sync` webhook plus a one-time backfill of all ~1,045 contacts.

`client_sync_state` (409 rows) is *almost* this but insufficient — it has `email`, `ghl_contact_id`,
`client_name`, `client_type` but **no phone, no company name, no address**. Leave it as sync
bookkeeping; add `clients` alongside.

Three entry points, all cheap once the mirror exists:

1. **Deep link from GHL** — `/estimates/new?opportunityId=X` prefills from opportunity + contact.
2. **In-app picker** — type three letters, pick, done.
3. **"Same as their last job"** — for a repeat contractor, copy job type, typical scope items and
   markup, not just contact info. **Biggest time-saver for the contractors who give Lost Boys work
   over and over**, and nearly free once the mirror exists.

Also worth adding: **`estimates.ghl_contact_id`**, so the push can skip its create-or-reuse round
trip and the job knows its client directly.

> ⚠️ **Flag:** GHL contact data may be **staler than Airtable's** because of the BL-6 defect —
> Airtable edits never propagated to existing GHL contacts. If GHL becomes the prefill source of
> truth, that needs a one-time reconciliation first, or the app will confidently prefill stale
> phone numbers.

### 8.2 New tables (sketch — to be designed properly before any build)

| Table | Purpose |
|---|---|
| `clients` | GHL contact mirror for prefill/search |
| `change_orders` | Priced, approvable scope additions, FK to `jobs` |
| `job_labor_days` *or* repointed `time_entries` | Daily labor attribution per job |
| `job_expenses` | BILL transactions, job-coded |
| `job_daily_snapshot` | One row per job per day — the trend line |

### 8.3 On the 0-row legacy scaffolding

- **Abandon `labor_actuals` and `expense_actuals`.** Untyped `job_id text`, **no foreign keys**, and
  shaped for Gusto/Divvy *reads* we are explicitly not doing (`expense_actuals` even has a
  `divvy_transaction_id` column). Building on them inherits the key-format problem the audit already
  flagged. They exist **only in the live DB** — no repo migration defines them.
- **Keep `time_entries` / `users` / `crews`.** Real schema, real cost trigger, real `hourly_rate`.
  `time_entries.job_id` already FKs to `jobs.id`.

### 8.4 Reproducible cost budget

Add cost rates to `pricing_variables` (e.g. `labor_cost_rate_per_hour`,
`dump_cost_per_load_expected`) and **snapshot them onto the job when the estimate is accepted** —
exactly as `estimates` already snapshots its four charge rates. Otherwise changing a cost rate next
year silently rewrites the variance on every historical job.

### 8.5 ⚠️ Hard constraint — estimates immutability

`estimates` is **blacklist-immutable**: only `status`, `quoted_price`, `quote_override_reason`,
`job_number` may change after insert; DELETE is blocked; `estimate_line_items` is fully immutable.

**No actuals or variance number may live on an estimate row.** It must live in a new table or a view.

> **Trap for whoever builds this:** the trigger is a *watched-column blacklist*, not a whitelist.
> A new column added to `estimates` and not added to the watched list becomes **silently mutable**.

### 8.6 Computed vs stored

**Compute variance on read** (a Postgres view or server-side function) so current state is never
stale. Run the nightly job **only** to (a) write the `job_daily_snapshot` row that gives the trend
line its history, and (b) raise alerts. **Do not materialize current state** — that's how you get a
cockpit that quietly lies between refreshes.

Copy the `crew-night-before` cron pattern wholesale: two UTC schedules (22:30 + 23:30) with an
America/Denver local-hour self-gate so exactly one fires year-round regardless of DST; a date-stamp
column for idempotency; deps-injected handlers for unit testing; per-group try/catch. It is proven
and live. Note `sync_log.direction` is a **closed CHECK list** — a new direction value needs a
migration.

### 8.7 Two definitional questions to settle

- **Which estimate version is the baseline?** Versions can be revised *after* promotion, so
  `where job_number = X` can return several rows over time. Proposal: **the version that was
  `accepted`** — findable via `estimate_mutations_audit`, which records when.
- **Jobs with no estimate.** Path A jobs created straight in GHL have no baseline at all. The
  cockpit needs a defined, non-broken "no baseline" state — show actuals and revenue only, no
  variance.

---

## 9. Open questions for Matt

1. **Timekeeping: buy or build?** Do you need offline capture, GPS verification, and automated
   overtime rules? Those are the real reasons to buy.
2. **Expected dump cost per load** — is the $65 median the right budget rate, or does it vary enough
   by hauler (Blue Collar, Chew It Up, Local Dumpster, Intermountain) to need a per-hauler rate?
3. **Per-scope actuals, or job-level only?** Job-level is much cheaper and probably enough now;
   per-scope is what Phase G calibration eventually wants.
4. **Overhead in the actuals column** — applied to *actual* hours, or held at budget? This decides
   whether an over-hours job gets penalized twice.
5. **Change-order approval** — does the client sign anything, or is Dane's approval sufficient?
6. **Callbacks/rework** — `BUILD_PLAN.md` says `callbacks` "must be in the initial schema — cheap
   now, expensive to retrofit." Include in wave 1?

---

## 10. Phasing (indicative, not a commitment)

| Wave | What | Depends on |
|---|---|---|
| **1 — now, zero external deps** | `clients` mirror + prefill + picker; `/jobs` list and `/jobs/[jobNumber]` shell with estimate baseline, schedule, contact, scope; change orders end to end; GHL headline push + deep link | nothing |
| **2 — needs a token** | BILL expenses + dump counts + needs-review queue | `BILL_API_TOKEN` from Matt |
| **3 — needs a decision** | Labor capture, daily hours, real labor cost | buy-vs-build + **BL-7** |
| **4 — falls out** | Nightly snapshot, trend line, over-budget alerts | waves 2–3 |

Wave 1 is substantial on its own and delivers the two things Matt named first (prefill, change
orders). The cockpit's actuals panels can ship as explicit **"not captured yet"** states and light
up as waves 2 and 3 land — better than waiting for everything.

---

## 11. How we'd verify this (when it becomes a build)

- **Prefill:** pick a real repeat contractor, confirm every field lands correctly, and reconcile
  against Airtable to confirm BL-6 staleness didn't poison it.
- **Cost budget:** hand-compute the budget for one real accepted estimate and match to the cent.
  Assert explicitly that the dump line uses the **cost** rate, not $300 — a regression test on
  exactly the trap in §4.
- **Golden gate:** `deno task test` must stay at **317 passing** with the golden-321 fixture
  untouched. The pricing engine is read by the cockpit, never modified by it.
- **Crew surface:** an automated assertion that no job view reachable by a foreman renders a
  currency value — the same invariant BL-4 and BL-5 established.
- **Change orders:** create → approve → confirm contract value and variance both move, and confirm
  the estimate row was **not** mutated (the immutability trigger should make that impossible).
- **Nightly:** live-probe with `{force: true}`, confirm the date-stamp makes a re-fire a no-op, and
  **re-cancel any test job afterward** — a test re-drag revives job rows (2026-08-20 hazard).

> **Environment note:** Deno is not installed in the Claude-web container and `deno.land`/`jsr.io`
> are blocked by network policy. The suite was run this session via the **npm-registry Deno build**
> (`npm i deno`) plus a local `std/assert` shim mapped with `--import-map` — 317 passing confirmed.
> Edge-function work is verifiable here, but needs that workaround.
