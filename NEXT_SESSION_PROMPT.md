Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B). The **2026-08-14 (night)** entry
in BUILD_LOG.md describes exactly where things stand.

## Where the last session left off (2026-08-14, night) — Phase B slice 2 COMPLETE on branch, merge-to-main pending

**Phase B slice 2 (estimate builder UI + GHL push) is DONE on branch `phase-b-slice-2` (tip
`53e7d64`), NOT merged to main.** All 14 build tasks, a mid-session no-login scope change (3 more
tasks), and a final whole-branch review + fix wave are complete, reviewed, and merged onto the
branch. The final review's verdict was **APPROVED FOR MERGE**. Merging to main is Matt's decision —
nothing technical blocks it.

**READ FIRST if you need task-level history:** the SDD ledger at
`.superpowers/sdd/2026-08-14-phase-b-slice-2-estimate-builder-ghl-push/progress.md` (gitignored) —
full per-task history, every ruling, every deferred finding. Task briefs + reports for every task
are staged alongside it as `task-N-brief.md` / `task-N-report.md`.

### What's live and working:

- **The estimate builder** (`/estimates/new`): mobile-first, live client-side recalc against
  server-supplied rates, quick/itemized modes, 19-item scope picker, Path B toggle (now a real,
  persisted `is_path_b` column). First real estimate will be **≥ 1426** — 16 rows exist today, all
  labeled `TEST` and all ending `declined`/`superseded`.
- **List + detail + lifecycle** (`/estimates`, `/estimates/[id]`, `/estimates/[id]/revise`): status
  actions (sent/accepted/declined only), quote override with a DB-enforced required reason, version
  chains, full audit history via `estimate_mutations_audit` (27 rows).
- **GHL push** (`web/src/lib/ghl/push.ts` + the detail page's push panel): per-target idempotent via
  `ghl_push_state` (10 rows, genuinely written), opportunity custom fields + a draft estimate doc
  with line amounts that sum exactly to the quoted price. **`PUT /opportunities` merges
  `customFields`** — settled live this slice, matters to the Phase A functions too.
- **⚠️ THERE IS NO LOGIN.** Matt's explicit decision, mid-session. Identity is a device-remembered
  "Who's estimating?" picker (Dane/Jackson/Matt) validated server-side against a fixed allowlist;
  `created_by` is always NULL, `created_by_name` carries the picked name. The deployment ships
  network-layer **open**. Read CLAUDE.md's "No-login estimate tool" section before touching
  anything auth-shaped in this repo — earlier docs/session artifacts describing a Supabase-Auth
  gate are now wrong.
- `deno task test` → 18/18 (golden 321 gate intact, engine changed by one word all slice). Web
  suite `cd web && npx vitest run` → 261/261. `npm run build` → green.

### Vercel deploy state: [CONTROLLER TO FILL POST-DEPLOY]

The Vercel project creation and the production phone smoke (login-free flow: pick estimator → build
a real estimate alongside Fillout in parallel → push → Dane/Jackson see the draft in GHL) were
explicitly out of this docs session's scope — controller/Matt own that step. If this file still
says the placeholder above, the deploy has not happened yet; do that before anything else that
depends on a live URL.

### Two known limitations to carry forward (not bugs to silently "fix" without re-reading the
context — see BUILD_LOG for full reasoning):

1. Superseded-version protection is UI-only — the server actions don't re-check version status
   themselves. Low risk, self-healing, deferred.
2. No concurrency guard on the GHL push — a push race can create a duplicate GHL opportunity.
   Low likelihood, manual cleanup if it happens.

### Repo-level open items (not slice-2 scope, but discovered while building it):

- **`airtable-client-sync` v19 has a dead search leg** — same broken `GET /contacts/?email=` shape
  T9f fixed in the web app, live-422ing, silently absorbed by a fallback path. Needs its own small
  edge-function fix task.
- **`crew-night-before` redeploy still owed** — closes out the `_shared/package.json {"type":
  "module"}` deploy-safety question with an actual redeploy, not just static proof.
- **6 anon-callable `SECURITY DEFINER` clock-in-era functions** — re-weigh now that the estimate
  tool itself ships open; this is a repo-wide security posture question, not a slice-2 one.

### What's next (roughly in the order Matt is likely to want them; none blocked):

1. **Merge-to-main decision** for `phase-b-slice-2` — technically clear (final review approved),
   purely Matt's call on timing.
2. **Vercel deploy + phone smoke** (see above) — needed before Dane/Jackson can actually use this
   in parallel with Fillout.
3. **Historical import of the 321 Airtable estimates** — explicitly deferred from this slice.
   `estimate_number` 1001–1321 are reserved for it (`status='historical'`).
4. **BL-4 — crew Slack message format** — explicitly deferred to "end of Phase B (after this
   slice)" per Matt 2026-08-14. Now is that point.
5. **Retiring Fillout** — only after Dane/Jackson are actually live on the builder day-to-day, not
   automatically once the code exists.
6. **Phase C — Expenses + dump counts (BILL)** and **Track B — Lead intake** are the next
   not-started phases in `BUILD_PLAN.md`'s A–G sequence; Track B was flagged "start now" back in
   July and still hasn't.
7. The two repo-level open items above, whenever convenient — neither is urgent.

Standing rules unchanged: (a) plan + explicit approval before any new build (small fixes exempt);
(b) anything deployed/applied to Supabase committed same session; (c) BUILD_LOG.md entry at every
session close, including docs-only ones; (d) subagent-driven with per-task opus review for anything
build-sized; (e) Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets &
Credentials / People & IDs only, its old Build Log table is superseded.
