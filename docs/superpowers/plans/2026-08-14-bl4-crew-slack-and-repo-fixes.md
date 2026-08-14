# BL-4 crew Slack message + repo-level fixes

> **Status: APPROVED by Matt 2026-08-14, NOT YET BUILT.** Planned and approved in a
> planning-only session; no code was written, no function deployed, no migration applied.
> **The next session starts here** — this is the build brief, ready to execute as written.
>
> Answers Matt gave during planning, already folded into the plan below:
> scope source = **hybrid** (linked estimate, falling back to the GHL Job Scope field);
> message target = **both** the schedule-leg post and the night-before digest;
> GHL "Job Start Time" is **not reliably populated** today.

## Context

Two work items Matt selected for this session (2026-08-14), after declining the historical
Airtable estimate import.

**1. BL-4 — crew Slack notification format.** Captured in `BUILD_PLAN.md` → Backlog and explicitly
scheduled by Matt for "the end of Phase B (after this slice)". Phase B slice 2 shipped and merged
the same day, so that point is now. Crews today get a four-line message that omits the client's
phone, the business name, the start time, and the scope — the things a foreman actually needs to
show up and work. Matt's target format:

```
Client Name
Business Name (if applicable)
Client Phone Number

Job Start Date
Job Start Time
Job Address

Job Scope description
```

The gap is **data, not formatting**. Verified live: `jobs` has no `client_phone`, no business name,
no time-of-day (`start_date` is a `date`), and no scope column. This is also a restoration, not an
invention — the retired Airtable function built exactly this block
(`airtable-job-scheduled/index.ts:241-271`: client, revenue, crew, address, start time, phone,
client type, then a JOB SCOPE section). Phase A's rebuild dropped it because the fields didn't
exist yet.

**2. Repo-level fixes** — three items carried in the BUILD_LOG "night" entry.

**Intended outcome:** crews get a message they can work from; the estimate→job link the schema was
designed for finally exists; three papercuts stop being carried forward.

## What exploration established

**Three of the four missing fields are already fetched and thrown away.** The Quote Accepted leg
already does `GET /contacts/{id}` and holds `phone` and `companyName` (the latter collapsed into a
single `client_name` label by `_shared/job.ts:51`). The schedule leg already does
`GET /opportunities/{id}` and holds every custom field, reading only three of them. **Net new GHL
API calls for this feature: zero.**

**The scope line needs a link that has never existed.** `estimates.job_number` carries the inline
comment *"job link set at promotion"*; `update_estimate_job_number` exists with a docstring saying
it's for "a **future** estimate-to-job promotion"; `grep updateJobNumber web/src` returns only its
own definition. No edge function queries `estimates` at all. Matt chose the hybrid source, so this
plan builds that promotion. The only latent join key is
`jobs.ghl_opportunity_id` ↔ `ghl_push_state.ghl_opportunity_id`.

**The two crew messages are duplicates, not variants.** `crew-night-before/handlers.ts:99-105` and
`ghl-job-webhook/handlers.ts:685-700` are the same template with a different first line,
separately implemented, plus a third copy of `postSlackMessage` and a second copy of the
crew→channel map. Matt chose to change both, which makes consolidation the only sane route — and
that **forces the `crew-night-before` redeploy already owed** for the
`_shared/package.json {"type":"module"}` question, closing it for free.

**A structural problem in the digest.** `buildCrewDigest` joins job blocks with `\n\n`, but Matt's
format uses blank lines *inside* a block. Without a change, multi-job digests become unreadable —
so each block keeps a headline line carrying the job number, and the digest gets an explicit
divider between jobs. This is a deliberate deviation from the literal spec; see Format below.

**Start time is not reliably populated** (Matt, this session). GHL field
`qJOGxmXtwExCNpoBrp1h` exists and is referenced nowhere in the repo. It gets wired so it lights up
if they adopt it, and the line is omitted when blank — matching the existing omit-empty style. It
does **not** get shipped as a permanently-empty line.

**Live security facts (repo cannot answer these — the functions predate the migrations dir):** there
are **5** `SECURITY DEFINER` functions, not 6 — `SYSTEM_AUDIT_2026-07-30.md` was right and
`BUILD_LOG.md`/`NEXT_SESSION_PROMPT.md` are wrong. All 5 lack a pinned `search_path` and are
`EXECUTE`-able by `anon`. Three are triggers (`calculate_duration_and_cost` on `time_entries`,
`handle_new_auth_user` on auth users, `notify_airtable_on_archive` on `jobs`); only `get_my_role`
and `get_my_crew_id` are genuinely callable RPCs, and both read a `users` table with 0 rows keyed
by `auth.uid()`, which is NULL for anon. **Real data exposure today: none.** Separately,
`next_job_number()` is `anon`-executable with no revoke — an anon caller could burn job numbers.

⚠️ `notify_airtable_on_archive` is a **live enabled trigger on `jobs`** that POSTs to the dormant,
latently-buggy `push-to-airtable`. It fires only on `status → 'archived'` (verified via
`pg_get_functiondef`). None of this plan's writes touch that legacy column, so it stays inert —
but no future work on `jobs` should assume the table is trigger-free.

## Format

Schedule-leg post:

```
🏗️ New job scheduled — JOB-1104
Ann Morrison
Morrison Construction
(801) 555-0142

Thu Aug 20
8:00 AM
4285 S 300 W, Murray

Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and
backsplash. Ensure proper floor and wall protection throughout.
Jobsite Cleanup — Full cleanup and haul-off of remaining debris.
```

Night-before digest: identical blocks, headline `⏰ Tomorrow — JOB-1104`, blocks separated by a
`———` divider.

Rules: every line omitted when its value is null/empty (existing convention). **No money on any
line** — Matt's spec has none, and the GHL `Scope Notes` field must never be forwarded raw because
it carries total bid, quoted price, markup % and true margin %. Scope renders as `name — description`
per line item; no hours, dumps, or dollars.

Two deviations from the literal spec, both for the digest problem above: a headline line carrying
the job number, and a divider between jobs. Strike either if you disagree.

## Approach

Each leg uses only data it already has in hand. No new GHL calls anywhere.

**Quote Accepted leg** (`ghl-job-webhook/handlers.ts` ~319-384) — persist `client_phone` and
`business_name` from the contact record already fetched, then **promote**: find the estimate via
`ghl_push_state.ghl_opportunity_id = opportunityId` (joined to `estimates`, excluding superseded,
newest first), back-write `estimates.job_number` via the existing `update_estimate_job_number` RPC,
and flip the estimate to `accepted` via `update_estimate_status`. Both non-fatal — a job with no
estimate is normal and must not break minting.

> The status flip is the one piece beyond the minimum. It costs one RPC call, is idempotent, and
> gives Phase F the "accepted estimate version" baseline it needs for variance. Easy to strike.

**Job Scheduled leg** (`handlers.ts` ~588-595, 675-700, 1036-1071) — read the Job Start Time custom
field off the opportunity already fetched; build `scope_summary` from the linked estimate's line
items, falling back to the GHL `Job Scope` multi-select names when no estimate is linked; persist
both to `jobs`; post via the shared formatter.

**`crew-night-before`** — select the new columns, render with the same shared formatter, divider
between blocks.

### Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_bl4_job_crew_fields.sql` | **new** — `jobs`: `client_phone`, `business_name`, `start_time` (text, matching GHL's TEXT field — no over-modelling), `scope_summary`. All nullable. |
| `supabase/migrations/<ts>_security_revoke_legacy_definers.sql` | **new** — pin `search_path` on the 5 definers; `revoke all … from public, anon, authenticated` on those 5 plus `next_job_number()`. No drops. |
| `supabase/functions/_shared/slack.ts` | **new** — `postSlackMessage`, crew→channel resolution, `buildCrewJobBlock({headline, …})`. Consolidates three copies. |
| `supabase/functions/_shared/slack_test.ts` | **new** — format + omit-empty + crew-mapping unit tests. |
| `supabase/functions/ghl-job-webhook/handlers.ts` | Quote Accepted: persist phone/business, promote estimate. Schedule: start time, scope, shared formatter. |
| `supabase/functions/ghl-job-webhook/handlers_test.ts` | Update the locked message assertions at `:819-860`; add promotion + fallback cases. |
| `supabase/functions/crew-night-before/{index.ts,handlers.ts,handlers_test.ts}` | New columns in the select; shared formatter; digest divider. Lift the `_shared`-is-off-limits note at `handlers.ts:10` (a prior-session constraint, not a standing rule). |
| `supabase/functions/airtable-client-sync/index.ts` | Repo fix 1 — see below. |

### Repo fix 1 — `airtable-client-sync` (worse than the log records)

`searchGhlByEmail` (`:33-40`) uses the `GET /contacts/?email=` shape the live API now 422s, and never
checks `res.ok`, so it returns `null` indistinguishably from "no such contact". **Consequence not
previously recorded: the update-in-place branch (`:132-136`) is unreachable, so every existing
contact is matched via the duplicate-400 fallback and its field changes are silently dropped — GHL
contacts have never been updated from Airtable.** Three changes:

1. Repair the search to `POST /contacts/search` with an `eq` filter, mirroring the live-verified
   `web/src/lib/ghl/client.ts:242-254`.
2. On the duplicate-400 fallback path (`:143-147`), call `updateGhlContact(meta.contactId, …)` —
   this is the actual data-loss fix and holds even if the search regresses again.
3. Add `res.ok` checks and logging to `searchGhlByEmail` and `createGhlContact` (the only GHL
   helpers without either).

⚠️ This is a **live behavior change on a function with daily traffic** — existing contacts start
getting PUT-updated for the first time. Deploy, then watch `sync_log` `match_method` shift from
`email_duplicate` toward `email`.

### Repo fixes 2 and 3

Fix 2 (`crew-night-before` redeploy) falls out of BL-4 — no separate work. Fix 3 is the security
migration above: revokes and `search_path` pins only, **no drops**, per the standing delete rule.

## Execution

Per the repo's build model: subagent-driven, Sonnet implements, Opus reviews every task plus a
final whole-branch review. Branch off `main`; independent tasks (the `airtable-client-sync` fix and
the security migration touch nothing BL-4 touches) run concurrently in isolated worktrees and merge
as each review passes.

## Verification

1. `deno task test` — must stay green including the golden-321 gate; the `handlers_test.ts` message
   assertions are updated deliberately, not loosened.
2. Live E2E, which doubles as the estimate-tool test Matt wants next: create a TEST estimate in the
   live builder, push it to GHL, then drag that opportunity Quote Accepted → Job Scheduled. Confirms
   minting, promotion (`estimates.job_number` populated, status `accepted`), phone/business/start
   time/scope persisted, and the Slack message rendering — the full Phase B → Phase A chain, which
   has never once been run end to end.
3. Fallback path: a job whose opportunity has no linked estimate must fall back to the GHL Job Scope
   names and still post.
4. `airtable-client-sync`: edit a Client in Airtable that already exists in GHL; confirm the GHL
   contact actually updates and `sync_log` shows `match_method='email'`.
5. Security: re-run the `has_function_privilege` query; anon EXECUTE false on all six. Confirm the
   `on_auth_user_created` and `time_entries` triggers still fire (revoking EXECUTE does not affect
   trigger invocation — triggers run as table owner).

**Open question for execution:** the E2E will post to a real crew Slack channel. Phase A handled
this with a clearly-labelled synthetic job. I'll ask before the first live post whether to use a
real crew channel and delete after, or point at a scratch channel.

## Close-out

Same-session commit for anything deployed (parity rule), `BUILD_LOG.md` entry, regenerate
`NEXT_SESSION_PROMPT.md`, and correct the 6-vs-5 security-definer count in `BUILD_LOG.md` and
`NEXT_SESSION_PROMPT.md`.
