# BL-6 — Echo guard design for bidirectional client sync

> ## ⚠️ DRAFT — AWAITING MATT'S REVIEW
>
> **This is a design for discussion, not an approved plan.** No code, migration, deploy,
> Airtable change, or Supabase write has been made. Nothing in this document has been
> implemented. Per the Build Planning Rule in `CLAUDE.md`, this needs Matt's explicit
> approval before any code is written.
>
> Author: research/design pass, 2026-08-18. Read-only against the live database
> (`eiqqqwajmcpcwhvxxnhx`) and the live Airtable base (`apptzp0IclCaAtOk2`).

---

## 0. TL;DR

**Recommendation:** a **field-wise last-synced snapshot** stored as one new `jsonb` column on
`client_sync_state`, compared **only against the fields present in the incoming payload**, with a
**120-second suppression window** as a bounded safety valve and a **hop-rate circuit breaker** as an
independent backstop. Suppression writes a `sync_log` row with `action_taken='skipped'`.

**The single most important structural finding:** the loop-breaking guard belongs in
**`ghl-contact-sync` (GHL → Airtable)**, not primarily in `airtable-client-sync`. If `ghl-contact-sync`
declines to write Airtable, no `recordUpdated` fires and the chain ends there. That means **the guard
can be built, deployed, and proven against today's live traffic before the `recordUpdated` trigger is
ever created** — the risky change is verified before the risky change is made.

**The single most important data finding:** `tags` arrives **empty in 620 of 624** logged
`ghl_to_airtable` payloads, so `clientType` is effectively **never** recoverable from the GHL side. A
naive whole-payload hash comparison would therefore mismatch *forever* on any client that has a
`clientType` set — producing exactly the infinite loop this guard exists to prevent. This is why the
recommended design compares **present fields only** rather than hashing the whole tuple.

---

## 1. Ground truth established by reading + live probing

### 1.1 What each function reads and writes

| | `airtable-client-sync` (A→G) | `ghl-contact-sync` (G→A) |
|---|---|---|
| Invoked by | Airtable automation `wflSSK2Twr9Tqwgpq`, **`recordCreated` only**, table `tblSJkwDdupKzsst7` | GHL workflow webhook |
| Auth | `x-webhook-secret` = `AIRTABLE_WEBHOOK_SECRET` | `x-webhook-secret` = `GHL_WEBHOOK_SECRET` |
| **Reads from payload** | 8 field IDs: firstName, lastName, email, phone, companyName, clientType, ghlContactId, ghlCompanyId | contact_id, email, first_name, last_name, phone, company_name, company_id, tags, location.{address,city,state,postalCode}, full_address, state, postal_code |
| **Writes to the other system** | `PUT /contacts/{id}` with `firstName, lastName, email, phone, companyName, tags` (all `undefined`-guarded so blanks don't erase) | `PATCH` Airtable record with `ghlContactId` **always**, plus (when non-empty) firstName, lastName, email, phone, companyName, ghlCompanyId, clientType, address, city, state, zip |
| **Writes to its own system** | `PATCH` Airtable `fldC4zAieX10BVacc` (GHL Contact ID) on the match/create paths | — |
| `client_sync_state` | `upsert` on `email`: airtable_record_id, ghl_contact_id, client_name, client_type, last_synced_at, last_direction | `upsert` on `email`: same + ghl_company_id |
| `sync_log` | `direction='airtable_to_ghl'`, `trigger_event` **hardcoded** `'client_created'` | `direction='ghl_to_airtable'`, `trigger_event = payload.type ?? 'contact_updated'` |
| Error handling on the outbound write | `updateGhlContact` **throws on `!res.ok`** ✅ | `updateAirtableClient` / `createAirtableClient` **never check `res.ok`** ❌ (see §6.3) |

### 1.2 The loop, proven live — not assumed

`BUILD_PLAN.md` states the loop as a hypothesis. It is a **measured fact**. Correlating
`airtable_to_ghl` rows with a subsequent `ghl_to_airtable` row for the same email inside 120s:

| Month | A→G syncs | Followed by a G→A sync ≤120s | Echo rate |
|---|---|---|---|
| 2026-05 | 143 | 37 | 26% |
| 2026-06 | 54 | 54 | **100%** |
| 2026-07 | 69 | 68 | **99%** |
| 2026-08 | 54 | 49 | **91%** |

Latency of that echo: **min 0.50s, p50 1.68s, p95 5.34s, max 376s** (n=209).

A single real chain from 2026-08-17 shows all three hops:

```
19:08:55  ghl_to_airtable   created   none            domestic.viking@gmail.com   ← GHL contact created, Airtable record created
19:09:05  airtable_to_ghl   updated   ghl_contact_id  domestic.viking@gmail.com   ← recordCreated fired, PUT back to GHL
19:09:07  ghl_to_airtable   updated   ghl_contact_id  domestic.viking@gmail.com   ← OUR PUT fired the GHL workflow  ★ THE ECHO
```

**Hop 3 is the echo, and it exists today.** It dead-ends only because there is no `recordUpdated`
trigger to make a hop 4. Note also that hop 2's PUT wrote GHL's *own* values straight back to GHL and
still produced hop 3 — **GHL does not suppress no-op writes.** This directly answers the question in
the brief's §6: yes, `airtable-client-sync`'s PUT reliably fires the GHL workflow that invokes
`ghl-contact-sync`. It is not an open question.

The May figure (26%) is almost certainly the period before the GHL workflow was wired; treat
**~100%** as the operating assumption.

### 1.3 The tags/clientType asymmetry — the design-defining finding

```
sync_log rows with direction='ghl_to_airtable' and a payload:   624
  payload.tags is NULL:                                           0
  payload.tags is "" (empty string):                            620
  payload.tags carries anything:                                  4
  payload.type present at all:                                    0
```

Consequences:

1. **`clientType` is one-way in practice.** Airtable `clientType` → GHL `tags` works; GHL `tags` →
   Airtable `clientType` almost never has anything to work with. `resolveClientType("")` returns
   `null`, and the `if (clientType)` guard then omits the field from the Airtable PATCH — so
   `ghl-contact-sync` has, in practice, never overwritten a `clientType`. Good news for safety, but
   it means the field cannot participate in a symmetric value comparison.
2. **A whole-tuple hash guard is unsafe here.** A→G would store `hash(…, clientType='Contractor')`;
   the echo would compute `hash(…, clientType=null)`; they differ *permanently*; every echo
   propagates; the loop never terminates. A whole-tuple hash is the obvious design and it is the
   wrong one.
3. `CLAUDE.md` currently records that "all 590 logged payloads carried string tags" from the
   2026-08-14 tags fix. **That is contradicted by the live data** (620/624 empty). The fix's code is
   correct; the data flowing through it is empty. Worth correcting in `CLAUDE.md` when BL-6 lands.
4. `payload.type` is never sent, so `ghl-contact-sync`'s `trigger_event` is a constant
   `'contact_updated'` and carries no information.

### 1.4 Live schema of `client_sync_state`

```
id                 bigint      NOT NULL  nextval(...)
email              text        NOT NULL            -- UNIQUE (client_sync_state_email_key)
airtable_record_id text        NULL                -- indexed, NOT unique
ghl_contact_id     text        NULL                -- indexed, NOT unique
ghl_company_id     text        NULL
client_name        text        NULL
client_type        text        NULL
last_synced_at     timestamptz NOT NULL  now()
last_direction     text        NULL                -- CHECK IN ('ghl_to_airtable','airtable_to_ghl')
sync_count         integer     NOT NULL  1         -- ⚠️ never incremented by either function; always 1
created_at         timestamptz NOT NULL  now()
```

**409 rows** against **1045 Airtable Clients rows** — so **~61% of clients have no guard state at
all.** Any design must be correct when the state is missing. `last_direction` split: 316
`ghl_to_airtable` / 93 `airtable_to_ghl`.

### 1.5 Airtable field IDs (live-confirmed from `get_table_schema`)

| Purpose | Field ID | Type | In `watchFields`? |
|---|---|---|---|
| First Name | `fld6jXXgXUEWEvW0H` | singleLineText | ✅ |
| Last Name | `fldng2X0AGhTnxrex` | singleLineText | ✅ |
| Email | `fldMVOoOV9TRdUAyC` | email | ✅ |
| Phone | `fldzROwSsF7IoYYqN` | phoneNumber | ✅ |
| Company Name | `fldxc5LB2eKwEuSTX` | singleLineText | ✅ |
| Client Type | `fldJoDlrTMUu99YQw` | singleSelect — **only 2 choices: Contractor, Homeowner** | ✅ |
| GHL Contact ID | `fldC4zAieX10BVacc` | singleLineText | ❌ **must not be watched** |
| GHL Company ID | `fldd3U0I423OVOJER` | — | ❌ **must not be watched** |
| Address / City / State / Zip | `flduZxnUCTtHJA7rX` / `fldzZjHtd0GjGva2L` / `fldtQwUkBuMYQU2Eq` / `fldtTY6m3aAvi2CX6` | — | ❌ **must not be watched** |
| Contact Name | `fldI5frhZxRY16DgS` | — | ❌ declared in both functions, written by neither |
| Client Name | `fldyIBidorXegZFHf` | formula | ❌ formula — cannot be watched meaningfully |

The exclusions are **load-bearing, not cosmetic**: `ghl-contact-sync` writes GHL Contact ID, GHL
Company ID, address, city, state and zip on *every* G→A sync, and `airtable-client-sync` writes GHL
Contact ID on its match/create paths. Watching any of them makes every inbound sync self-trigger,
guard or no guard.

That `clientType` has exactly the two choices `clientTypeToTag()` maps means there is no
"unmappable third value" hazard on the A→G leg.

### 1.6 `recordUpdated` with `watchFields` is already proven in this base

Two live automations on the Jobs table use it — `wflBkFQUsbO2inACO` (2 watch fields) and
`wflqUwoKPt7wUF8ms` (12 watch fields). The mechanism is not novel here.

---

## 2. The loop, drawn

```
        ┌──────────────────────── Airtable Clients (tblSJkwDdupKzsst7) ───────────────────────┐
        │                                                                                     │
   [human edit]                                                                        [PATCH by G→A]
        │                                                                                     │
        ▼                                                                                     │
  recordCreated ✅ live        recordUpdated ❌ does not exist  ◄────────── THE MISSING EDGE ──┘
        │                              │  (BL-6 adds this)
        └──────────────┬───────────────┘
                       ▼
            airtable-client-sync  ──PUT /contacts/{id}──►  GHL
                                                            │
                                             GHL workflow fires (~100%, p50 1.68s)
                                                            ▼
                                                    ghl-contact-sync
                                                            │
                                                  PATCH Airtable record
                                                            │
                                                            └──► back to the top
```

Today the cycle is broken at the `recordUpdated` edge. BL-6 adds that edge, so the cycle must be
broken somewhere else first.

**Where to break it.** Breaking at `ghl-contact-sync` (declining the Airtable PATCH) is strictly
stronger than breaking at `airtable-client-sync` (declining the GHL PUT), because:

- Declining the Airtable PATCH means **no `recordUpdated` fires at all** — the chain ends
  immediately, one hop earlier.
- Declining the GHL PUT only saves a hop; if it fails, the G→A guard still terminates the cycle two
  hops later.
- **It can be verified on today's traffic.** Hop 3 in the §1.2 trace is a real, daily, observable
  echo. A correct guard turns that row from `updated` into `skipped` — visible *before* the trigger
  exists.

So: **G→A guard = the loop-breaker (mandatory). A→G guard = defense in depth (recommended, not
load-bearing).** Both are in the recommended design; they ship in that order.

---

## 3. Candidate mechanisms evaluated

### (a) Compare incoming values against `client_sync_state`

*Store what we last synced; skip when the incoming payload already matches it.*

- **Correctness under concurrent human edits (both sides at once):** converges. A→G stores V1 and
  PUTs V1; G→A arrives with V2, V2≠V1 → propagates, stores V2. The echo of the V1 PUT then arrives
  with V1 ≠ stored V2 → propagates once more → stores V1 → its echo matches → suppressed. Settles on
  last-writer-wins in ≤2 extra hops. No divergence, no oscillation.
- **Stale/missing state:** 61% of clients have no row. No row → nothing to compare → **propagate**
  (fail-open). This is the correct default and it is what makes the design safe on day one.
- **False suppression = the disease:** happens only if the stored values *lie* — i.e. we recorded
  "synced V1" but the target actually holds something else. Two causes: (i) the outbound write
  failed after the snapshot was written; (ii) the target was changed out-of-band without firing its
  webhook. Mitigated by writing the snapshot **only after a confirmed 2xx**, and bounded by (b).
- **Observability:** natural — one `sync_log` row per suppression, `action_taken='skipped'`,
  `status='success'` (both legal under the live CHECKs).
- **Verdict:** sound core. But see the §1.3 trap — it must compare **present fields only**, not a
  whole-tuple hash.

### (b) Skip when the payload matches what was last synced within N seconds

This is (a) plus a TTL, **not** an alternative to it.

- On its own, *without* the value comparison ("suppress anything inbound within N seconds of an
  outbound sync"), it is **unsafe and must be rejected**: a genuine human edit landing inside the
  window is silently dropped. That is exactly the silent data loss BL-6 exists to cure.
- Combined with (a), the window is a **pure safety valve**: after N seconds we propagate regardless,
  so a lying snapshot can suppress for at most N seconds instead of forever.
- **Does the window reopen the loop?** No. Echoes arrive at p50 1.68s / p95 5.34s — far inside any
  sane N. And the 376s outlier is self-damping: a late echo propagates once, which *refreshes* the
  snapshot timestamp, and its own echo (~2s later) is then inside the window and suppressed. One
  extra hop, then termination.
- **Cost of the window:** at ~10–20 syncs/day, an occasional redundant write. Negligible.
- **Verdict:** adopt as a modifier on (a), with **N = 120s** (≈22× p95; short enough that a wrong
  snapshot cannot hide a human's edit for more than two minutes).

### (c) Content hash of the synced field set, stored on `client_sync_state`

- Compact and tamper-evident, but **fails on §1.3**: `clientType` is present on the A→G side and
  absent on the G→A side, so the two directions can never compute the same hash for a client that has
  a client type. Permanent mismatch → permanent propagation → the loop. Same problem, weaker form,
  for `companyName` (present in only some GHL payloads) and for any phone reformatting GHL applies.
- A hash restricted to the always-present intersection would work, but the intersection is not
  stable — it depends on what GHL chooses to send per contact, which varies row to row in the live
  data.
- **Verdict: reject.** Field-wise comparison is the same idea with per-field granularity, and the
  granularity is exactly what this integration needs. It also debugs far better: you can `SELECT` the
  snapshot and read it.

### (d) Echo-suppression window keyed by record ID + direction (no content check)

Identical to bare (b). **Reject** for the same reason: it suppresses real edits.

### (e) Sentinel field in Airtable ("Last Sync Source")

- Would work on the Airtable side: `ghl-contact-sync` stamps the sentinel in the same PATCH; the
  automation script reads it and declines to invoke. Sentinel is unwatched, so it does not self-fire.
- But: (i) there is **no equivalent on the GHL side**, so it cannot break the loop at the stronger
  point; (ii) it needs a timestamp anyway to distinguish "written 3 hours ago" from "written just
  now", which reintroduces (b); (iii) it adds a schema field to a table slated for retirement;
  (iv) it is invisible to `sync_log`.
- **Verdict: reject as primary.** Not needed if the guard lives in the function.

### (f) Hop-rate circuit breaker (new — recommended as an additional layer)

Independent of any value comparison: before acting, count recent `sync_log` rows for this
`ghl_contact_id`; if the count exceeds a threshold, hard-skip and log. This is the layer that means an
unforeseen design bug costs a log line rather than an API-quota incident, and it is the only layer
whose correctness does not depend on the field semantics being right. `sync_log` already has
`idx_sync_log_ghl_contact_id` and `idx_sync_log_created_at`, so the query is cheap at 1,012 rows.

**Verdict: adopt, as layer 3.** Never as layer 1 — it is a backstop, not a guard.

---

## 4. Recommended design

Three layers, defence in depth. Layer 1 does the work; layers 2 and 3 bound the damage when layer 1
is wrong.

### 4.1 Schema change

One migration, additive, no backfill, no constraint changes:

```sql
-- 2026081XXXXXXX_bl6_echo_guard_snapshot.sql
ALTER TABLE public.client_sync_state
  ADD COLUMN IF NOT EXISTS last_synced_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_suppressed_at timestamptz NULL;

COMMENT ON COLUMN public.client_sync_state.last_synced_values IS
  'BL-6 echo guard. Canonical values last successfully written to the OTHER system, merged '
  'per-field. Suppression input only — never a source of truth, never written back to '
  'Airtable or GHL.';
```

Rationale for `jsonb` over six text columns: the merge semantics (§4.3) are natural, the watched
field set can change without a migration, and it is directly readable in the SQL editor when
debugging a suppression. `last_suppressed_at` is diagnostic only.

`sync_count` is currently dead (always 1). Optionally fix it in the same migration by having both
functions increment it — useful for spotting a runaway record at a glance. Not required.

### 4.2 Canonical form (must be identical in both functions — put it in `_shared/`)

```
canonicalize(raw) -> { field: value } for the 6 watched fields, where:
  - a field is OMITTED entirely if the source did not supply it
      (undefined, null, or empty string after trim)
  - firstName, lastName, companyName : trim()
  - email                            : trim().toLowerCase()
  - phone                            : keep digits only; drop a leading US '1' if 11 digits
                                       (GHL returns E.164 '+18013695388'; Airtable stores a
                                        phoneNumber cell — see OQ-3)
  - clientType                       : A→G: the Airtable singleSelect value verbatim
                                       G→A: resolveClientType(tags), OMITTED when null
```

Omission — not null — is the load-bearing rule. **"Absent" means "no information", never "cleared".**
That is what makes the guard survive §1.3.

This belongs in `supabase/functions/_shared/clientSync.ts` (new), imported by both functions, per the
`_shared/slack.ts` precedent. Two hand-copied implementations of a canonicalizer that must agree
exactly is precisely the kind of divergence that has already bitten this repo once (the U+2500 vs
U+2014 divider).

### 4.3 The guard algorithm (pseudocode — identical shape in both functions)

```
SUPPRESSION_WINDOW_SECONDS = 120
BREAKER_MAX_SYNCS          = 6         // per contact, per window
BREAKER_WINDOW_SECONDS     = 300

incoming = canonicalize(payload)          // present fields only
key      = ghl_contact_id ?? email        // §4.4

// ---- LAYER 3: circuit breaker (runs first; cheapest correctness guarantee) ----
if ghl_contact_id is not null:
    n = SELECT count(*) FROM sync_log
          WHERE ghl_contact_id = :ghl_contact_id
            AND created_at > now() - BREAKER_WINDOW_SECONDS
    if n >= BREAKER_MAX_SYNCS:
        log sync_log(action_taken='error', status='error',
                     error_message='BL-6 circuit breaker: N syncs in M s — possible echo loop')
        console.error('[echo-guard] CIRCUIT BREAKER TRIPPED for ' + ghl_contact_id)
        return 200 { suppressed: true, reason: 'circuit_breaker' }
        // 200, not 500 — a 500 makes Airtable/GHL retry, which feeds the loop we just stopped.

// ---- LAYER 1 + 2: value snapshot inside a time window ----
state = SELECT last_synced_values, last_synced_at
          FROM client_sync_state
         WHERE ghl_contact_id = :ghl_contact_id      -- fall back to email
         ORDER BY last_synced_at DESC LIMIT 1

if state exists
   AND state.last_synced_values is non-empty
   AND now() - state.last_synced_at <= SUPPRESSION_WINDOW_SECONDS      // LAYER 2
   AND every key k present in `incoming` satisfies
         state.last_synced_values[k] is present AND equals incoming[k]  // LAYER 1
   AND `incoming` has at least one key:                                 // never suppress an empty payload
        UPDATE client_sync_state SET last_suppressed_at = now() WHERE id = state.id
        INSERT sync_log(direction=<this direction>,
                        trigger_event=<from payload>,
                        match_method='ghl_contact_id' | 'email' | 'none',
                        action_taken='skipped',        // legal under the live CHECK
                        status='success',              // legal under the live CHECK
                        error_message='BL-6 echo guard: payload matches last synced values',
                        payload_in=payload)
        console.log('[echo-guard] SUPPRESSED echo for ' + key)
        return 200 { suppressed: true, reason: 'echo_guard' }

// ---- otherwise: existing behaviour, unchanged ----
... perform the existing match/create/update path ...

// ---- snapshot write: ONLY after a confirmed successful write to the other system ----
if the outbound write returned 2xx:
    UPSERT client_sync_state (... existing columns ...,
        last_synced_values = coalesce(existing.last_synced_values,'{}') || incoming,   // MERGE
        last_synced_at     = now())
// On the error path, do NOT touch last_synced_values. A snapshot that outruns the
// write is the only way this guard can cause data loss.
```

Four non-obvious properties worth calling out to a reviewer:

1. **Merge, do not replace.** `||` on `jsonb` merges right-over-left. A G→A sync that omits
   `clientType` must not erase the `clientType` the A→G leg recorded — otherwise the next A→G sees a
   mismatch on a field GHL never echoes, and the loop returns by the back door.
2. **On suppression, do not touch the snapshot** (only `last_suppressed_at`). Nothing changed, so the
   window must not be extended by the echo it just absorbed — otherwise a stream of echoes could hold
   the window open indefinitely.
3. **Return 200 on suppression.** A 500 makes the caller retry, feeding the loop.
4. **Never suppress an empty `incoming`.** A payload that supplies nothing comparable is not evidence
   of an echo.

### 4.4 The lookup key

`client_sync_state` is `UNIQUE (email)`, but email is the one watched field that can *change*, which
would strand the guard exactly when a client's email is edited. So: **look up by `ghl_contact_id`
first** (present on both sides — A→G reads `fldC4zAieX10BVacc`; G→A has `payload.contact_id`; indexed;
stable across email changes), falling back to `email`. `ghl_contact_id` is **not** unique, so the
lookup must `ORDER BY last_synced_at DESC LIMIT 1`.

Leave the `upsert` conflict target as `email` — unchanged. Changing it is a live-data migration risk
for no benefit here.

Email changes then behave correctly by fail-open: the new email has no row → propagate → a new row is
created → the subsequent echo matches it → suppressed. Cost: an orphaned old row. Acceptable.

### 4.5 The `recordUpdated` automation

```
Automation:   new, on base apptzp0IclCaAtOk2, table tblSJkwDdupKzsst7 (Clients)
Name:         "Airtable/GHL Sync — on update"
Trigger:      recordUpdated
watchFields:  fld6jXXgXUEWEvW0H   (First Name)
              fldng2X0AGhTnxrex   (Last Name)
              fldMVOoOV9TRdUAyC   (Email)
              fldzROwSsF7IoYYqN   (Phone)
              fldxc5LB2eKwEuSTX   (Company Name)
              fldJoDlrTMUu99YQw   (Client Type)
Action:       customScript — a copy of wflSSK2Twr9Tqwgpq's script with ONE change:
                payload.trigger_event = "client_updated"
```

**A separate automation, not a modified `wflSSK2Twr9Tqwgpq`.** Two reasons, both about rollback:
the create path keeps working untouched if the update path is disabled, and disabling one automation
in the Airtable UI is then a *complete* rollback of BL-6's behavioural change (§7).

**Deliberately NOT watched:** GHL Contact ID, GHL Company ID, Address, City, State, Zip, Contact Name,
and the Client Name formula. Adding any of them makes every inbound G→A write self-trigger. This list
is load-bearing — annotate it in the script header so nobody "helpfully" adds address later.

**The script does not guard.** It just fires. All guarding is server-side, where the service-role key
already lives and where every decision lands in `sync_log`. Putting the guard in the Airtable script
would require embedding a Supabase key in an Airtable script (a materially larger exposure than the
per-function webhook secret already there) and would make suppressions invisible to `sync_log`.

**One required code change to `airtable-client-sync`:** its `sync_log` insert currently **hardcodes**
`trigger_event: 'client_created'`. It must read `payload.trigger_event ?? 'client_created'`, or every
update will be mislabelled as a create and the verification in §6 becomes unreadable.

---

## 5. Failure-mode analysis

| # | Scenario | Behaviour | Assessment |
|---|---|---|---|
| F1 | No `client_sync_state` row (61% of clients today) | Fail-open → propagate | ✅ Correct. The guard is opt-in per record and self-populates. |
| F2 | Snapshot is stale (>120s old) | Window expired → propagate | ✅ Correct. Bounded blast radius. |
| F3 | GHL PUT fails after we wrote the snapshot | Cannot happen — snapshot is written only on 2xx | ✅ Designed out. |
| F4 | Airtable PATCH fails silently | **Can happen today** — `updateAirtableClient` never checks `res.ok`. Must be fixed in the same change (§6.3), or the snapshot lies. | 🔴 Must fix |
| F5 | Someone edits GHL through a path that fires no workflow, then edits Airtable back to the value we last synced | Suppressed within 120s; propagates after | 🟡 Bounded. Also a genuine no-op *if* the target really holds that value. |
| F6 | Simultaneous human edits on both sides | Converges to last-writer-at-the-store, ≤2 extra hops, no oscillation | ✅ Acceptable; the integration has no better semantic available. |
| F7 | Echo arrives later than the window (observed max 376s) | Propagates once, refreshes the snapshot, its own echo lands ~2s later and is suppressed | ✅ Self-damping |
| F8 | GHL reformats phone (E.164) so the echo differs textually | Canonicalizer normalizes digits → no mismatch. Without the canonicalizer: one extra hop, then settles. | ✅ Handled |
| F9 | Airtable holds mixed-case email; G→A writes it lowercase | Canonicalizer lowercases both sides → no mismatch. Note this write happens *today* and will now start firing `recordUpdated` on the email field for any mixed-case client — one settling hop each. | 🟡 One-time churn |
| F10 | `clientType` absent from the G→A payload (620/624 payloads) | Omitted from `incoming` → not compared → suppression still works; merge preserves the stored value | ✅ **This is the case the design is built around** |
| F11 | Bulk edit / paste / import touching a watched field on many rows | Guard does **not** help. N rows → N automation runs → N GHL PUTs → N echoes. | 🔴 **See §5.1** |
| F12 | Two concurrent syncs for the same contact race on read-then-merge | A merge can be lost | 🟢 Low. Consequence is one extra propagation, self-healing. Optional fix: a `SECURITY DEFINER` merge RPC granted to `service_role` only (consistent with the 2026-08-17 posture). |
| F13 | The guard itself has a bug and suppresses everything | `sync_log` shows `skipped` climbing and `updated` going to zero. Detectable in one query (§6.4). Rollback = disable the trigger; the G→A guard would need a redeploy. | 🟡 Why §6 stages it |

### 5.1 F11 — the bulk-edit stampede is the risk the guard does NOT cover

`CLAUDE.md` already warns: *"no retry/backoff exists, so treat bulk imports with care."* On
2026-08-11 a bulk load produced 145 `ghl_to_airtable` + 25 `airtable_to_ghl` rows in a day and 14
Airtable-create failures.

With `recordUpdated` live, a paste over 1,000 Clients rows becomes 1,000 automation runs → 1,000 GHL
PUTs → ~1,000 echoes. The echo guard prevents *unbounded* looping but does nothing about the initial
fan-out. Airtable serializes automation runs per base, which caps the rate but converts the spike into
a long backlog that also delays every other automation in the base (Jobs, invoice line items).

**Mitigations to decide with Matt:**
- **Operational (recommended, zero build):** written rule — turn the update automation off before any
  bulk edit or import to Clients, back on after. Rollback is already a single UI toggle, so this costs
  nothing.
- **Technical (optional):** raise the circuit breaker to also count per-*minute* global
  `airtable_to_ghl` volume and shed load above a threshold. Adds complexity; probably not warranted at
  3 users.

---

## 6. Rollout and verification

The staging exists so that **the dangerous change is made last, after the thing that makes it safe has
already been proven on live traffic.**

### Stage 0 — migration only
Apply §4.1. Purely additive; nothing reads the columns yet. Zero behaviour change.

### Stage 1 — shadow mode (both functions), trigger still create-only
Deploy both functions computing the guard and **logging what they would do**, but suppressing nothing:

```
console.log('[echo-guard][SHADOW] WOULD SUPPRESS ' + key + ' matched=' + JSON.stringify(incoming))
```

Snapshots are written for real (on 2xx only). `sync_log` behaviour is unchanged.

**Bake 2–3 days.** Success criterion: `[SHADOW] WOULD SUPPRESS` appears on hop-3 echoes and **does
not** appear on hops driven by a human edit. Because ~100% of A→G syncs already produce an echo, a
handful of days of ordinary traffic is a real sample.

**Read this from the edge-function console logs, not from `sync_log`** — same standing lesson as the
repaired search leg in BL-6's existing notes. Shadow mode writes no `sync_log` marker by design.

### Stage 2 — enable suppression, trigger STILL create-only
Flip shadow off. The observable, already-happening hop-3 echo should now come back as
`action_taken='skipped'`:

```sql
-- expect: rows appear here, all with error_message like 'BL-6 echo guard%'
SELECT created_at, direction, action_taken, email, error_message
FROM sync_log
WHERE action_taken = 'skipped' AND created_at > now() - interval '2 days'
ORDER BY created_at DESC;
```

**This is the key property of the plan: the loop-breaker is proven in production before the loop
can exist.** If Stage 2 misbehaves, no infinite loop is possible, because there is still no
`recordUpdated` trigger.

Also confirm the A→G leg still creates and updates normally: `action_taken IN ('created','updated')`
must keep appearing for genuinely new records.

### Stage 3 — add the `recordUpdated` automation (the one risky step)

Live probe, in order, on **one deliberately-created throwaway test client** (never on a real one):

1. **Real edit propagates (A→G).** Edit the test client's phone in the Airtable UI. Expect:
   `sync_log` gains `airtable_to_ghl / updated / trigger_event='client_updated'`, **and the new phone
   is visible on the GHL contact in the GHL UI** — check GHL, not just the log row. This is the
   BL-6 acceptance test: it is the thing that has never worked.
2. **Echo is suppressed.** Within seconds of (1), the GHL workflow fires `ghl-contact-sync`. Expect
   exactly **one** `ghl_to_airtable / skipped` row with `error_message like 'BL-6 echo guard%'`, and
   **no** subsequent `airtable_to_ghl` row. Count rows for that email over the next 5 minutes:
   expect the sequence to terminate.
3. **Real edit propagates (G→A).** Edit the test contact's phone in the **GHL** UI to a third value.
   Expect `ghl_to_airtable / updated`, the value visible in the Airtable UI, then `airtable_to_ghl`
   (the recordUpdated echo), then a `ghl_to_airtable / skipped`. **Three hops, then silence.**
4. **Ping-pong check.** Leave it 15 minutes. Re-run the per-email count. Must be flat.
5. **Non-watched field check.** Edit the test client's **Address** in Airtable. Expect **zero** new
   `airtable_to_ghl` rows — proves the `watchFields` list is doing its job.
6. **Blank-name check.** Clear the test client's Last Name in Airtable. Expect the v29 guard to hold:
   the GHL contact's last name must **not** be erased.
7. **Circuit breaker check.** Temporarily lower `BREAKER_MAX_SYNCS` to 2 in a preview deploy (or drive
   it with a scripted burst) and confirm the breaker trips, logs, and returns 200. Do not ship
   without having seen it fire once — an untested backstop is not a backstop.
8. **Delete the test client from Airtable and GHL, and its `client_sync_state` row.** Deleting a
   record Matt did not create is within the intent of the standing no-delete rule, but flag it in
   the BUILD_LOG entry rather than doing it silently.

### 6.3 Required code fixes bundled with this work

- `ghl-contact-sync`: `updateAirtableClient` and `createAirtableClient` **must check `res.ok`** and
  throw, matching `updateGhlContact`. Without this, F4 makes the snapshot lie and the guard becomes a
  data-loss mechanism. **This is not optional.**
- `airtable-client-sync`: read `trigger_event` from the payload instead of hardcoding
  `'client_created'`.
- Consider `_shared/clientSync.ts` for the canonicalizer + guard so the two functions cannot diverge
  (§4.2).
- Unit tests: canonicalizer (omission vs null vs empty string; phone/email normalization), the
  compare (present-fields-only; the `clientType`-absent case from §1.3 explicitly), the merge
  (non-erasure), and the window boundary. But per the standing lesson — **mocks cannot see the
  database.** The tests do not replace §6's live probe; the CHECK-constraint legality of
  `action_taken='skipped'` / `status='success'` was confirmed against the live schema for this
  document, and must be re-confirmed by an actual insert during Stage 2.

### 6.4 Standing health query (worth keeping after rollout)

```sql
SELECT date_trunc('day', created_at)::date AS d,
       direction,
       count(*) FILTER (WHERE action_taken IN ('created','updated')) AS propagated,
       count(*) FILTER (WHERE action_taken = 'skipped')             AS suppressed,
       count(*) FILTER (WHERE status = 'error')                     AS errors
FROM sync_log
WHERE created_at > now() - interval '14 days'
GROUP BY 1, 2 ORDER BY 1 DESC, 2;
```

Healthy shape: roughly one `suppressed` per `propagated` in the opposite direction. `suppressed`
climbing while `propagated` collapses = the guard is over-firing → disable the trigger and
investigate.

---

## 7. Rollback

**Designed so that disabling the Airtable automation is a complete rollback of the behavioural
change.**

| Layer | Rollback | Time |
|---|---|---|
| Stage 3 — `recordUpdated` automation | Toggle the automation **off** in the Airtable UI | seconds, no deploy |
| Stage 2 — suppression enabled | Redeploy the previous function version, or flip an `ECHO_GUARD_ENABLED` secret to `false` | minutes |
| Stage 1 — snapshot writes | Harmless if left; the columns are inert without the guard reading them | — |
| Stage 0 — migration | Additive with defaults; safe to leave in place permanently | — |

Because Stages 0–2 change **no** externally-visible behaviour except turning today's already-existing
hop-3 echo from a redundant write into a `skipped` row, the only step with real blast radius is Stage
3 — and that one is a UI toggle.

**Recommendation: gate suppression behind a `BL6_ECHO_GUARD` Supabase secret** (`shadow` | `on` |
`off`). It makes Stage 1→2→rollback a secret change rather than three deploys, and it removes the
temptation to hand-edit a deployed function.

---

## 8. Open questions

**Needing live verification (do not guess):**

- **OQ-1 — Does Airtable's `recordUpdated` fire when an API PATCH writes a value *identical* to the
  current one?** If **no**, the loop largely self-terminates and the guard is defence in depth. If
  **yes**, the guard is load-bearing. **The design assumes yes** and does not depend on the answer,
  but the answer changes how much risk Stage 3 carries. Testable in ~5 minutes with a throwaway
  record. (Note the contrast: **GHL demonstrably does fire on identical PUTs** — §1.2 hop 2→3.)
- **OQ-2 — Which GHL workflow invokes `ghl-contact-sync`, and on what trigger?** The webhook is
  live and fires at ~100%, but its configuration was not inspected for this document (no GHL MCP
  read available). Two things to confirm in the GHL UI: whether it fires on *any* contact write or
  only on specific field changes, and whether GHL offers a "skip if updated by API/workflow"
  condition — if it does, that is a **free, zero-code loop breaker at the source** and would change
  the recommendation materially.
- **OQ-3 — Phone canonicalization.** GHL returns E.164 (`+18013695388`); Airtable's `phoneNumber` cell
  may store a formatted string. Confirm what `getCellValueAsString` actually returns for a few live
  records before finalizing the phone rule in §4.2. Getting this wrong costs one extra hop per sync,
  not a loop — but it makes the `sync_log` noisy.
- **OQ-4 — Why do 620 of 624 GHL payloads carry `tags: ""`?** Is the GHL workflow simply not mapping
  the tags field, or do these contacts genuinely have no tags? If it is a mapping gap, fixing it in
  the GHL workflow would restore `clientType` as a real bidirectional field — worth knowing, though
  the design is correct either way. **`CLAUDE.md`'s claim that "all 590 logged payloads carried
  string tags" needs correcting regardless.**
- **OQ-5** — Confirm the Supabase `GHL_API_KEY` is the same token/scopes the web app's repaired
  search was proven against (carried over from the existing BL-6 notes; still unconfirmed).

**Needing Matt's decision:**

- **OQ-6 — Suppression window length.** Proposed **120s**. Shorter (30s) = tighter data-loss bound,
  more redundant writes. Longer (600s) = fewer writes, longer worst-case suppression. 120s is ~22×
  the observed p95 echo latency.
- **OQ-7 — Circuit breaker thresholds.** Proposed **6 syncs per contact per 300s**. Legitimate
  traffic today peaks at 3 hops per contact per event, so 6 leaves headroom without being decorative.
- **OQ-8 — Bulk-edit policy (§5.1).** Operational rule ("turn the automation off before bulk edits"),
  or build load-shedding? Recommend the operational rule.
- **OQ-9 — Symmetric or one-sided?** Recommendation is both, G→A first. Matt may prefer to ship the
  G→A guard alone and defer the A→G half — that is a *safe* subset (the loop still terminates), just
  one extra GHL PUT per edit.
- **OQ-10 — Do the 1045 Airtable Clients rows need a `client_sync_state` backfill?** Not required
  (fail-open handles it), and a backfill would need a source of truth for "what did we last sync",
  which does not exist. **Recommend: no backfill**; let the table populate naturally.
- **OQ-11 — `sync_count` is dead** (always 1, incremented by nobody). Fix it as part of this change,
  or leave it? Low stakes.

---

## 9. Summary of the recommendation

1. **Migration:** add `last_synced_values jsonb` + `last_suppressed_at timestamptz` to
   `client_sync_state`. Additive, no backfill.
2. **Guard:** field-wise comparison of **present fields only** against the snapshot, inside a
   **120-second window**, **fail-open** on missing state, snapshot written **only after a confirmed
   2xx**, **merged** rather than replaced. Suppression = one `sync_log` row,
   `action_taken='skipped'`, `status='success'`.
3. **Backstop:** hop-rate circuit breaker on `sync_log` per `ghl_contact_id`.
4. **Placement:** `ghl-contact-sync` is the load-bearing loop-breaker; `airtable-client-sync` gets
   the same guard as defence in depth. Shared canonicalizer in `_shared/`.
5. **Required bundled fixes:** `res.ok` checks on the Airtable writes; `trigger_event` read from the
   payload.
6. **Rollout:** migration → shadow mode → enable suppression (**both while the trigger is still
   create-only, so the guard is proven on live echoes before the loop can exist**) → then add the
   `recordUpdated` automation as a *separate* automation with the six watched field IDs.
7. **Rollback:** disabling that one automation in the Airtable UI is a complete rollback; a
   `BL6_ECHO_GUARD` secret covers the function-side stages without redeploys.

**The one risk that this design does not eliminate** is the bulk-edit stampede (§5.1) — the guard
stops the loop, not the fan-out. That needs an operational rule, not code.
