# No-Login Estimate Tool (Phase B scope change) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Supabase Auth login layer from the `web/` estimate tool entirely and replace user-identity attribution with a no-password "Who's estimating?" picker (Dane / Jackson / Matt), plus close a discovered plan gap: persist the Path B (record-only) flag that Tasks 11/12 assume but no column provides.

**Architecture:** The login stack (middleware, `/login`, `auth.ts`, `safe-next.ts`, the SSR session client) is deleted outright — it has zero non-auth consumers. Identity becomes a client-side picker persisted in `localStorage`, passed as an `estimatorName` argument into each server action, validated server-side against a 3-name allowlist, and carried through the existing repo/RPC plumbing as `{ id: null, name }` (the DB columns and RPC args are already nullable by design). Path B gets a real `is_path_b` column on `estimates` so the builder toggle persists and the GHL push can gate the doc target on it.

**Tech Stack:** Next 16 App Router, Tailwind 4, vitest, Supabase (service-role writes via `admin.ts` only — `@supabase/ssr` removed)

**Spec:** Matt's directive this session: "I don't want there to be any kind of login to the estimate tool," clarified via Q&A — attribution = name picker chip (Dane/Jackson/Matt, device-remembered); deployment ships open for now, network-layer protection revisited at T13. Parent plan: `docs/superpowers/plans/2026-08-14-phase-b-slice-2-estimate-builder-ghl-push.md` (its Task 6 login gate is superseded by this change; its Tasks 11/12 consume this plan's outputs).

## Context

Phase B slice 2 is mid-build on branch `phase-b-slice-2` with two lanes running (T11 builder page, T12 GHL push lib — both currently holding). The tool was built with a full Supabase Auth gate (Task 6, three reviewed fix rounds). Matt has now decided the 3-user internal tool should have **no login at all** — zero friction on phones outweighs the gate. Separately, the T12 implementer surfaced two real defects in the parent plan: (1) the "Path B toggle" and `skipped_path_b` push outcome have **no persisted field anywhere** — schema, types, and validators all lack it; (2) the opportunity search-before-create idempotency carry has **no spare GHL field** to match on. This plan resolves all three. Attribution matters because `estimate_mutations_audit` is the future "discounts by estimator" dataset — the picker preserves it without a password.

## Global Constraints

- Estimates are immutable-by-trigger: after insert only `status`, `quoted_price`, `quote_override_reason`, `job_number` may change; there is no DELETE path. New columns are immutable automatically (the guard whitelists mutable columns).
- Allowed estimator names, exact strings: `"Dane"`, `"Jackson"`, `"Matt"`. Server actions MUST reject any other value.
- `created_by` (uuid → auth.users) stays NULL on all new rows; `created_by_name` carries the picked name. RPCs receive `p_actor: null`, `p_actor_name: <picked name>`.
- The service-role admin client (`web/src/lib/supabase/admin.ts`) and its `server-only` guard are untouched — it is the entire data path.
- Full web suite must be green after every task: `cd web && npx vitest run` (139/139 at base; count will change as auth tests are deleted and new tests added). `npm run build` must pass.
- Any migration applied to Supabase project `eiqqqwajmcpcwhvxxnhx` must be committed in the same session.
- Do not touch `supabase/functions/_shared/pricing.ts` (golden-tested engine).

## Execution integration (for the SDD controller, not a task)

These tasks are addendum tasks to the running slice-2 SDD session. Sequence: implement A1 → A2 → B1 on a fresh worktree lane off `phase-b-slice-2` HEAD (serial — they share files), review + merge each per the session's standard loop. Then: lane-t11 rebases onto the updated branch and (as part of its existing task) wires the picker (`useEstimator`), the `estimatorName` argument, and the now-persistable Path B toggle into the builder; lane-t12 resumes with its planned lib implementation plus the rulings below. Manual Setup #2 (provision 3 auth users) is cancelled.

**Rulings folded in from T12's open questions:**
1. **Path B** → resolved by Task B1 (real column). `pushEstimateToGhl(estimateId)` keeps its single-arg signature and reads `is_path_b` off the estimate row.
2. **Opportunity dedup key** → exact opportunity-name match scoped to the contact (`findExistingOpportunityByName`), upserting `ghl_push_state` immediately after create to shrink the crash window. Do NOT repurpose the `Airtable Job ID` field — it stays `job_number`-only.
3. **Service-role key** → present in `web/.env.local` (verified by Matt's shell output after the second copy; T12's check predated it). T12 re-verifies on resume; if absent, unit-tests-only branch per its brief.

---

### Task A1: Identity plumbing — `EstimateActor` replaces `AuthedUser`

**Files:**
- Modify: `web/src/lib/estimates/types.ts` (add `EstimateActor`)
- Modify: `web/src/lib/estimates/repo.ts:6` (import), signatures at lines ~141, 189, 209, 242, 268, 318
- Modify: `web/src/lib/estimates/map.ts:23` (import), signature ~line 46
- Modify: `web/src/app/(app)/estimates/actions.ts` (all 4 actions)
- Create: `web/src/lib/estimator.ts`
- Test: `web/src/lib/estimates/__tests__/map.test.ts`, `web/src/lib/__tests__/estimator.test.ts`

**Interfaces:**
- Consumes: existing repo/map/RPC plumbing (`p_actor` uuid is nullable; `estimates.created_by` is nullable).
- Produces: `EstimateActor { id: string | null; name: string }` (types.ts); `ESTIMATORS`, `EstimatorName`, `isEstimatorName`, `ESTIMATOR_STORAGE_KEY` (estimator.ts); server actions each taking a trailing `estimatorName: string` — the exact signatures Task 11/11b/12 call.

- [ ] **Step 1: Create `web/src/lib/estimator.ts`** (pure, client-safe — no `server-only`):

```ts
/** The three people allowed to create/mutate estimates. No auth — identity
 *  is self-declared via the header picker and re-validated server-side. */
export const ESTIMATORS = ["Dane", "Jackson", "Matt"] as const;
export type EstimatorName = (typeof ESTIMATORS)[number];

export function isEstimatorName(v: unknown): v is EstimatorName {
  return typeof v === "string" && (ESTIMATORS as readonly string[]).includes(v);
}

/** localStorage key the picker persists under (device-remembered). */
export const ESTIMATOR_STORAGE_KEY = "lbd-estimator";
```

- [ ] **Step 2: Write failing tests** `web/src/lib/__tests__/estimator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ESTIMATORS, isEstimatorName } from "@/lib/estimator";

describe("isEstimatorName", () => {
  it("accepts exactly the three estimators", () => {
    for (const name of ESTIMATORS) expect(isEstimatorName(name)).toBe(true);
  });
  it.each(["dane", "MATT", "", " Jackson", null, undefined, 3, ["Dane"]])(
    "rejects %j",
    (v) => expect(isEstimatorName(v)).toBe(false),
  );
});
```

Run: `cd web && npx vitest run src/lib/__tests__/estimator.test.ts` → PASS (pure function written first is fine here; the meaningful red is Step 3's type break).

- [ ] **Step 3: Add `EstimateActor` to `web/src/lib/estimates/types.ts`** (near `EstimateRow`):

```ts
/** Who performed a write. With no login, `id` is always null and `name` is
 *  the picker-declared estimator (allowlist-validated in actions.ts).
 *  `id` stays in the shape because estimates.created_by / audit actor_id
 *  remain in the schema for a possible future re-auth. */
export interface EstimateActor {
  id: string | null;
  name: string;
}
```

- [ ] **Step 4: Switch repo.ts and map.ts to `EstimateActor`.** In both files replace `import type { AuthedUser } from "@/lib/auth";` with `import type { EstimateActor } from "./types";` (in map.ts: `"./types"`; repo.ts already imports other names from `./types` — extend that import). Rename every `AuthedUser` type annotation to `EstimateActor` (6 signatures in repo.ts, 1 in map.ts). No logic changes — `map.ts:91-92` (`created_by: user.id, created_by_name: user.name`) and the three `p_actor: user.id, p_actor_name: user.name` RPC blocks in repo.ts stay byte-identical; `user.id` is simply null-capable now, which the columns/RPC args already accept.

- [ ] **Step 5: Rewrite `web/src/app/(app)/estimates/actions.ts`.** Remove `import { requireUser } from "@/lib/auth";` and every `await requireUser()` line. Add:

```ts
import { isEstimatorName } from "@/lib/estimator";
import type { EstimateActor } from "@/lib/estimates/types";

function resolveActor(estimatorName: string): EstimateActor | null {
  return isEstimatorName(estimatorName)
    ? { id: null, name: estimatorName }
    : null;
}
```

New signatures (each action's body otherwise unchanged — same repo call, same `revalidatePath`s, same `toActionResult`):

```ts
export async function createEstimateAction(draft: unknown, estimatorName: string): Promise<ActionResult>
export async function newVersionAction(parentId: string, draft: unknown, estimatorName: string): Promise<ActionResult>
export async function updateStatusAction(id: string, status: string, estimatorName: string): Promise<ActionResult>
export async function updateQuoteAction(id: string, quotedPrice: number | null, reason: string | null, estimatorName: string): Promise<ActionResult>
```

Each action starts with:

```ts
const actor = resolveActor(estimatorName);
if (!actor) return { ok: false, error: "Pick who's estimating first." };
```

and passes `actor` where `user` went. Update the file's header comment: the HARD RULE paragraph about `requireUser()` is replaced by two sentences — there is no login by Matt's decision; identity is self-declared and allowlist-checked here because these actions are the trust boundary in front of the service-role client.

- [ ] **Step 6: Fix `map.test.ts`.** Replace `import type { AuthedUser } from "@/lib/auth";` with `import type { EstimateActor } from "@/lib/estimates/types";`, change `const user: AuthedUser = { id: "2222…", name: "Dane" }` to `const user: EstimateActor = { id: null, name: "Dane" };`, and update the line-104 assertion to `expect(estimate.created_by).toBeNull()` while keeping `created_by_name === "Dane"`.

- [ ] **Step 7: Full suite + build.** `cd web && npx vitest run` → all green. `npm run build` → green (actions.ts no longer imports auth.ts; layout still does — that's Task A2's job, and the build stays green because auth.ts still exists in this task).

- [ ] **Step 8: Commit** — `git commit -m "feat: estimator picker identity — EstimateActor replaces AuthedUser in the data path"`

### Task A2: Delete the login stack; header becomes the estimator chip

**Files:**
- Delete: `web/src/middleware.ts`, `web/src/lib/auth.ts`, `web/src/lib/safe-next.ts`, `web/src/lib/__tests__/safe-next.test.ts`, `web/src/lib/supabase/server.ts`, `web/src/app/login/` (page.tsx, LoginForm.tsx, actions.ts), `web/src/app/(app)/debug/page.tsx` (public with no gate; its removal was already tracked for slice cleanup)
- Modify: `web/src/app/(app)/layout.tsx`, `web/package.json` (drop `@supabase/ssr`)
- Create: `web/src/app/(app)/EstimatorChip.tsx`

**Interfaces:**
- Consumes: `ESTIMATORS` / `EstimatorName` / `ESTIMATOR_STORAGE_KEY` from Task A1.
- Produces: `useEstimator()` hook exported from `EstimatorChip.tsx` — `{ estimator: EstimatorName | null, setEstimator(name: EstimatorName): void }` — Task 11's builder imports this to require a pick before save and to pass `estimatorName` into actions.

- [ ] **Step 1: Delete the seven auth files + debug page** listed above (`git rm`). Nothing else imports them (verified by exploration: `@supabase/ssr` is imported only by middleware + supabase/server.ts; `safe-next` only by login; `signOut` only by the layout; debug page imports only `@/lib/pricing`).

- [ ] **Step 2: Create `web/src/app/(app)/EstimatorChip.tsx`:**

```tsx
"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  ESTIMATOR_STORAGE_KEY,
  ESTIMATORS,
  isEstimatorName,
  type EstimatorName,
} from "@/lib/estimator";

/** Cross-component subscription so the header chip and the builder stay in
 *  sync when the pick changes (storage events also cover other tabs). */
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}
function getSnapshot(): EstimatorName | null {
  const v = localStorage.getItem(ESTIMATOR_STORAGE_KEY);
  return isEstimatorName(v) ? v : null;
}

export function useEstimator() {
  const estimator = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const setEstimator = useCallback((name: EstimatorName) => {
    localStorage.setItem(ESTIMATOR_STORAGE_KEY, name);
    emit();
  }, []);
  return { estimator, setEstimator };
}

export default function EstimatorChip() {
  const { estimator, setEstimator } = useEstimator();
  return (
    <div className="flex items-center gap-1">
      {ESTIMATORS.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => setEstimator(name)}
          className={
            name === estimator
              ? "rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-full px-3 py-1 text-sm font-medium text-zinc-500 dark:text-zinc-400"
          }
        >
          {name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: De-auth `web/src/app/(app)/layout.tsx`.** Remove the `requireUser`/`signOut` imports, the `const user = await requireUser();` line, the `{user.name}` span, and the sign-out form; the component becomes non-async. Header content becomes `<EstimatorChip />` (left-aligned where the name was); bottom nav unchanged. Update the doc comment: this is an open internal tool (Matt's decision); the chip declares who's estimating and is re-validated server-side.

- [ ] **Step 4: Drop `@supabase/ssr`** from `web/package.json` dependencies and run `cd web && npm install` to update the lockfile. (`@supabase/supabase-js` and `server-only` stay — admin.ts/repo.ts/rates.ts need them.)

- [ ] **Step 5: Full suite + build.** `cd web && npx vitest run` → green (safe-next tests gone with their code; count drops accordingly, no other failures). `npm run build` → green; confirm the build output no longer lists middleware and `/login`, and `/`, `/estimates` routes build without a redirect gate.

- [ ] **Step 6: Commit** — `git commit -m "feat!: remove login — open internal tool with estimator chip attribution (Matt's directive)"`

### Task B1: Persist Path B — `is_path_b` column end-to-end

**Files:**
- Create: `supabase/migrations/20260814230000_phase_b2_path_b_flag.sql` (apply live via MCP `apply_migration` in the same task)
- Modify: `web/src/lib/estimates/types.ts` (`EstimateDraft` + `EstimateRow`), `web/src/lib/estimates/validate.ts` (draft schema), `web/src/lib/estimates/map.ts` (payload)
- Test: `web/src/lib/estimates/__tests__/validate.test.ts`, `web/src/lib/estimates/__tests__/map.test.ts`

**Interfaces:**
- Consumes: `create_estimate_with_items(p_estimate jsonb, p_line_items jsonb)` (migration `20260814210000_phase_b2_rpcs_audit.sql`, as amended by `20260814215000`).
- Produces: `EstimateDraft.isPathB: boolean` (validated, defaults false), `EstimateRow.is_path_b: boolean` — Task 11's toggle writes it; Task 12's `decideDocPreflight` reads it.

- [ ] **Step 1: Write the migration.** Read the current `create_estimate_with_items` body in `supabase/migrations/20260814210000_phase_b2_rpcs_audit.sql` (and its `20260814215000` fixups) first. The migration contains: (a) `alter table public.estimates add column is_path_b boolean not null default false;` (b) `create or replace` of `create_estimate_with_items` with the SAME body except `is_path_b` added to the insert column list, valued as `coalesce((p_estimate->>'is_path_b')::boolean, false)`. Include the standard header comment block and `set search_path = public` pin matching the sibling migrations. Note in the migration comment: the column is immutable-after-insert automatically — the estimates guard whitelists mutable columns and this is not one of them.

- [ ] **Step 2: Apply live** via MCP `apply_migration` (name `phase_b2_path_b_flag`), then verify: insert nothing — run a read-only `select column_name, column_default, is_nullable from information_schema.columns where table_name='estimates' and column_name='is_path_b';` and confirm the existing 1414-chain rows read `is_path_b = false`.

- [ ] **Step 3: Types.** `EstimateDraft` gains `isPathB: boolean;` (document: "Path B = internal record only, no proposal doc pushed"); `EstimateRow` gains `is_path_b: boolean;`.

- [ ] **Step 4: Validate.** In `validate.ts`'s `baseEstimateDraftSchema` add `isPathB: z.boolean().optional().default(false),`. Add a test to `validate.test.ts`:

```ts
it("defaults isPathB to false and passes an explicit true through", () => {
  const base = validDraft();               // existing helper/fixture in this file
  expect(validateEstimateDraft(base).data?.isPathB).toBe(false);
  expect(validateEstimateDraft({ ...base, isPathB: true }).data?.isPathB).toBe(true);
});
```

(Adapt the fixture accessor to whatever `validate.test.ts` already uses — do not invent a new fixture style; if `ValidationResult` exposes the parsed draft under a different property name, assert on that one.)

- [ ] **Step 5: Map.** In `map.ts`'s `mapDraftToEstimatePayload` add `is_path_b: draft.isPathB,` to the estimate payload. Extend the map test's payload assertions to include `is_path_b: false` for the default fixture.

- [ ] **Step 6: Full suite** `cd web && npx vitest run` → green. Also `deno task test` from repo root → 18/18 (nothing in `_shared` touched; this is a guard rail, not an expected failure).

- [ ] **Step 7: Commit** — `git commit -m "feat: is_path_b column + draft/row plumbing — Path B is now persisted (closes T12 gap)"`

---

## Verification (end-to-end)

1. `cd web && npx vitest run` — full suite green (new estimator/pathB tests in, safe-next tests gone).
2. `cd web && npm run build` — green; no middleware, no `/login` route in output.
3. `cd web && npm run dev` → open `/estimates/new` on a phone-sized viewport: no login screen anywhere; header shows the three-name chip; picking a name survives reload; save is blocked until a name is picked (wired by lane-t11 after merge).
4. First real estimate create (T11's live smoke, unchanged): row lands with `created_by IS NULL`, `created_by_name` = picked name, `estimate_mutations_audit` rows carry `actor_name` on later status flips, estimate number ≥ 1416, labeled `TEST — void, do not use`, flipped to declined.
5. T12 (on resume): `decideDocPreflight` reads `is_path_b` from the real row; Path B estimate pushes fields but skips the doc.

## Docs (folded into T13's existing doc pass — not separate tasks)

CLAUDE.md web-app notes and BUILD_LOG entry: auth removed by Matt's directive (T6 work superseded, preserved in git history), Manual Setup #2 cancelled, `NEXT_PUBLIC_SUPABASE_ANON_KEY` now unused by the app (harmless in env), deployment-protection decision deferred to T13.
