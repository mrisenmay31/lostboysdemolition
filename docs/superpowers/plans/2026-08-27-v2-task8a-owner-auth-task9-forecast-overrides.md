# v2 Task 8a (Owner Auth Slice) + Task 9 (Forecast Overrides) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship real Supabase Auth for owners (magic link), owner-gate every financial route under `/jobs`, flip `/` to land an authenticated active owner on the Job Dashboard, and deliver Task 9's append-only owner forecast overrides — without touching the no-login estimator picker flow.

**Architecture:** Session 14 executes the **8a slice** of ratified v2 Task 8 (Matt's split ruling, 2026-08-27): auth foundation (`@supabase/ssr` cookie-session clients + a `workforce_profiles` reader over the existing `workforce_self_read` RLS policy), magic-link sign-in, a Next proxy + layout defense-in-depth gate on `/jobs/*`, and the `/` flip. Task 9 rides the same session because Task 6 already pre-wired override consumption (`map.ts` picks latest override > latest checklist; `healthRepo` queries and watermarks `job_forecast_overrides`) — Task 9 is validation + write path + panel UI, and its server action is gated by the **authenticated owner**, not the picker. **Task 8b** (foreman mobile checklist area: offline queue, service worker, photo bucket, `submit_job_checklist` RPC, GHL lifecycle, migration `20260818160000`) is a follow-on session and carries the Phase 3 gate; the backlogged alert `action_path` RPC migration attaches to 8b's migration window.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5 strict, Tailwind 4, Zod 4, Vitest 4, `@supabase/ssr`, Supabase Auth (email magic link) + Postgres.

**Spec:** `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` → Phase 3 (Tasks 8, 9) + the 2026-08-25 BUILD_PLAN amendment (`/` flip semantics), as scoped by Matt's three Session-14 rulings: (1) split 8a/8b, (2) owner = Matt now / Dane later, (3) sign-in = email magic link.

## Global Constraints

- **Zero migrations this session.** `workforce_profiles` + its 2 policies + `is_workforce_owner()` are already live (Task 0B, 2026-08-18). `job_forecast_overrides` exists (Task 1). If any step appears to need SQL schema change, STOP — the plan is wrong; escalate to Matt.
- **No production data writes during the build.** Owner promotion is a Matt-gated runbook step at the end. Live smoke is read-only by default; any writing smoke needs Matt's per-item OK.
- **The no-login estimator picker flow is untouched.** `/estimates/*`, `EstimatorChip`, `web/src/lib/estimator.ts`, and every estimates server action keep their current behavior byte-for-byte. Do not add session reads to `(app)/layout.tsx` or any estimates route.
- **Never expose `SUPABASE_SERVICE_ROLE_KEY` or any secret to client components.** New session clients use ONLY `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already set in `web/.env.local` and Vercel; currently unused — this session makes them load-bearing).
- **Do not re-grant or call legacy `get_my_role()` / `get_my_crew_id()`** — they stay revoked. The owner check reads the user's own `workforce_profiles` row via `workforce_self_read` (`auth.uid()`-based) through the anon-key session client.
- **`z.number()` only in all new validation — never `z.coerce.number()`.** Empty string, numeric string, NaN, Infinity are all rejected (Task 6 final-review carry; house precedent: `web/src/lib/ledger/validate.ts` header + `CostEntryForm.tsx`'s `parseRequiredNumber`/`parseNullableNumber`).
- **Crew-days zero-divisor guard (Session 11/13 carry):** override validation requires `expectedCrewSize` positive integer and `0 < hoursPerDay <= 24`; `remainingWorkdays >= 0` is allowed (0 = "no days left" is a legitimate forecast).
- **`sortRank`/section orders are review-locked from Task 6** — the job detail page's locked section-order comment must be updated *deliberately* when the override panel is inserted, never silently.
- Money display via the house `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`; timestamps `America/Denver`, `dateStyle: "medium"`, `timeStyle: "short"`.
- Never `git add -A`. Delete nothing without Matt's per-item approval. Each task ends in a focused commit.
- Suites gate: `cd web && npx vitest run` (758 baseline) and repo-root `deno task test` (411 baseline, golden-321 intact — no Deno code changes expected, run at final integration as the invariant check) plus `npm run lint` and `npm run build`.
- Sonnet implements; the strongest available model adversarially reviews every task; a final whole-branch review gates the merge.

## Branch, worktree, and concurrency map

- Branch: `claude/v2-task8a-owner-auth` from `main`. Worktree: `git worktree add .claude/worktrees/task8a -b claude/v2-task8a-owner-auth main`.
- **Dependency structure (designed for maximum concurrency per Matt's standing directive):**
  - **Wave 0 (3 concurrent):** **Task 1** (auth foundation — produces `createSessionClient`, `getWorkforceSession`, `requireActiveOwner`, `isActiveOwner`, **and `signOutAction`**, the interfaces every later code task consumes) ∥ **Task 4** (runbook + canonical doc amendments — pure docs, zero code dependencies) ∥ **Task 5** (forecast override validation — PURE, consumes only the existing `@/lib/profitability/types`; no Task 1 dependency).
  - **Wave 1 (3 concurrent, after Tasks 1 + 5 land):** **Task 2** (sign-in page, confirm route, proxy) ∥ **Task 3** (`/jobs` layout gate + `/` flip) ∥ **Task 6** (override repo + owner-gated action — consumes Task 1's `requireActiveOwner` and Task 5's validation). Tasks 2 and 3 are file-disjoint and share only Task 1's exports; Task 3 references `/auth/sign-in` as a path string, not an import, so it does not wait on Task 2.
  - **Wave 2:** **Task 7** (panel + page wiring, after Task 6). Task 2/3/6 reviews run alongside it.
  - **Task 8** (final integration + whole-branch review) is last, after everything.
- File ownership (enforced in every agent prompt; everything not listed is off-limits to that task):
  - **Task 1:** `web/package.json`+lock, `web/src/lib/supabase/server.ts`, `web/src/lib/supabase/browser.ts`, `web/src/lib/workforce/**`, `web/src/app/auth/actions.ts`.
  - **Task 2:** `web/src/app/auth/sign-in/**`, `web/src/app/auth/confirm/**`, `web/src/proxy.ts`, `web/src/lib/supabase/proxyDecision.ts` + `web/src/lib/supabase/__tests__/**`.
  - **Task 3:** `web/src/app/(app)/jobs/layout.tsx`, `web/src/app/(app)/page.tsx`.
  - **Task 4:** `docs/runbooks/owner-promotion.md`, the v2-plan and BUILD_PLAN amendment blocks.
  - **Tasks 5–7 (Lane B):** `web/src/lib/forecasts/**`, `web/src/app/(app)/jobs/actions.ts`, `web/src/app/(app)/jobs/[jobNumber]/page.tsx`, `web/src/app/(app)/jobs/[jobNumber]/_components/ForecastOverridePanel.tsx` (+ its test).
- Scoped test runs while siblings are mid-flight: Task 1 `npx vitest run src/lib/workforce`; Task 2 `npx vitest run src/lib/supabase`; Lane B `npx vitest run src/lib/forecasts "src/app/(app)/jobs"`. The orchestrator runs the full suites once, at Task 8 (final integration).
- Adversarial review per task (reviewer told: do not run the full suite, do not report findings on files the task doesn't own). Final whole-branch review at Task 8.

---

### Task 1: Auth foundation — session clients, workforce profile reader, sign-out (Wave 0, runs ∥ Task 4)

**Files:**
- Modify: `web/package.json` (+ lockfile, via `npm install @supabase/ssr`)
- Create: `web/src/lib/supabase/server.ts`
- Create: `web/src/lib/supabase/browser.ts`
- Create: `web/src/lib/workforce/profile.ts`
- Create: `web/src/app/auth/actions.ts`
- Test: `web/src/lib/workforce/__tests__/profile.test.ts`

**Interfaces:**
- Consumes: live `workforce_profiles` (columns `auth_user_id uuid PK`, `display_name text`, `role text check in ('pending','owner','foreman')`, `crew_external_id text`, `active boolean`, `created_at`, `updated_at`; RLS policies `workforce_self_read` SELECT-own-row + `workforce_owner_all`), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Produces (Tasks 2, 3, 6 depend on these exact names):
  - `createSessionClient(): Promise<SupabaseClient>` (server-only, cookie-bound, anon key)
  - `createBrowserSupabaseClient(): SupabaseClient` (browser, anon key)
  - `type WorkforceRole = "pending" | "owner" | "foreman"`
  - `interface WorkforceProfile { authUserId: string; displayName: string; role: WorkforceRole; active: boolean }`
  - `type WorkforceSession = { status: "unauthenticated" } | { status: "no_profile"; authUserId: string } | { status: "authenticated"; profile: WorkforceProfile }`
  - `normalizeWorkforceProfileRow(raw: Record<string, unknown>): WorkforceProfile | null` (pure)
  - `isActiveOwner(profile: WorkforceProfile | null): boolean` (pure)
  - `getWorkforceSession(): Promise<WorkforceSession>`
  - `class OwnerAuthError extends Error { code: "unauthenticated" | "not_owner" }`
  - `requireActiveOwner(): Promise<WorkforceProfile>` (throws `OwnerAuthError`)
  - `signOutAction(): Promise<void>` (server action; Task 3's layout renders it — living here, not in Task 2, is what lets Tasks 2 and 3 run concurrently)

- [ ] **Step 1: Install the SSR helper**

```bash
cd web && npm install @supabase/ssr
```

Verify `package.json` gains `@supabase/ssr` and nothing else changed.

- [ ] **Step 2: Write the failing pure-helper tests**

Create `web/src/lib/workforce/__tests__/profile.test.ts` (house style: pure `.ts` tests, no I/O — mirror `src/lib/jobs/__tests__/map.test.ts`'s import style):

```ts
import { describe, expect, it } from "vitest";
import { isActiveOwner, normalizeWorkforceProfileRow } from "../profile";

const validRow = {
  auth_user_id: "3f2a1b4c-0000-4000-8000-000000000001",
  display_name: "Matt",
  role: "owner",
  active: true,
};

describe("normalizeWorkforceProfileRow", () => {
  it("normalizes a valid row", () => {
    expect(normalizeWorkforceProfileRow(validRow)).toEqual({
      authUserId: "3f2a1b4c-0000-4000-8000-000000000001",
      displayName: "Matt",
      role: "owner",
      active: true,
    });
  });

  it.each(["pending", "owner", "foreman"])("accepts role %s", (role) => {
    expect(normalizeWorkforceProfileRow({ ...validRow, role })?.role).toBe(role);
  });

  it("returns null for an unknown role string", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, role: "admin" })).toBeNull();
  });

  it("returns null when active is not a boolean", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, active: "true" })).toBeNull();
  });

  it("returns null when display_name is blank or missing", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, display_name: "  " })).toBeNull();
    expect(normalizeWorkforceProfileRow({ ...validRow, display_name: undefined })).toBeNull();
  });

  it("returns null when auth_user_id is missing", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, auth_user_id: null })).toBeNull();
  });
});

describe("isActiveOwner", () => {
  it("is true only for active owner", () => {
    expect(isActiveOwner({ authUserId: "x", displayName: "Matt", role: "owner", active: true })).toBe(true);
  });
  it("is false for inactive owner", () => {
    expect(isActiveOwner({ authUserId: "x", displayName: "Matt", role: "owner", active: false })).toBe(false);
  });
  it("is false for active foreman and pending", () => {
    expect(isActiveOwner({ authUserId: "x", displayName: "Nick", role: "foreman", active: true })).toBe(false);
    expect(isActiveOwner({ authUserId: "x", displayName: "Matt", role: "pending", active: false })).toBe(false);
  });
  it("is false for null", () => {
    expect(isActiveOwner(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd web && npx vitest run src/lib/workforce`
Expected: FAIL — `../profile` does not exist.

- [ ] **Step 4: Implement the three modules**

Create `web/src/lib/supabase/server.ts`:

```ts
import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Cookie-bound, anon-key Supabase client for Server Components, Server
 * Actions, and Route Handlers. This is the SESSION client — RLS applies
 * (contrast admin.ts's service-role client, which bypasses it). The only
 * table it reads in Task 8a is `workforce_profiles`, whose
 * `workforce_self_read` policy allows exactly the caller's own row.
 *
 * setAll is wrapped in try/catch because Server Components cannot write
 * cookies — the proxy (web/src/proxy.ts) owns session refresh, so a
 * failed write here is expected and harmless.
 */
export async function createSessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "createSessionClient: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component render — proxy handles refresh.
        }
      },
    },
  });
}
```

Create `web/src/lib/supabase/browser.ts`:

```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Anon-key browser client — used ONLY by the sign-in page (signInWithOtp,
 *  getUser, signOut). Never used for data reads; all data access stays in
 *  server code. */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "createBrowserSupabaseClient: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.",
    );
  }
  return createBrowserClient(url, anonKey);
}
```

Create `web/src/lib/workforce/profile.ts`:

```ts
import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

export type WorkforceRole = "pending" | "owner" | "foreman";

export interface WorkforceProfile {
  authUserId: string;
  displayName: string;
  role: WorkforceRole;
  active: boolean;
}

export type WorkforceSession =
  | { status: "unauthenticated" }
  | { status: "no_profile"; authUserId: string }
  | { status: "authenticated"; profile: WorkforceProfile };

const ROLES: readonly WorkforceRole[] = ["pending", "owner", "foreman"];

/** Pure, defensive row normalizer (house pattern: every wire row is
 *  normalized before use — see map.ts). Returns null rather than
 *  guessing when any field is off-contract. */
export function normalizeWorkforceProfileRow(raw: Record<string, unknown>): WorkforceProfile | null {
  const authUserId = typeof raw.auth_user_id === "string" && raw.auth_user_id !== "" ? raw.auth_user_id : null;
  const displayName =
    typeof raw.display_name === "string" && raw.display_name.trim() !== "" ? raw.display_name.trim() : null;
  const role = typeof raw.role === "string" && (ROLES as readonly string[]).includes(raw.role)
    ? (raw.role as WorkforceRole)
    : null;
  const active = typeof raw.active === "boolean" ? raw.active : null;
  if (authUserId === null || displayName === null || role === null || active === null) return null;
  return { authUserId, displayName, role, active };
}

export function isActiveOwner(profile: WorkforceProfile | null): boolean {
  return profile !== null && profile.role === "owner" && profile.active === true;
}

/** Resolves the current cookie session to a workforce profile. RLS
 *  (`workforce_self_read`) guarantees the query can only ever see the
 *  caller's own row, so `.eq()` here is belt-and-braces, not the
 *  security boundary. */
export async function getWorkforceSession(): Promise<WorkforceSession> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };
  const { data, error } = await supabase
    .from("workforce_profiles")
    .select("auth_user_id, display_name, role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error || !data) return { status: "no_profile", authUserId: user.id };
  const profile = normalizeWorkforceProfileRow(data);
  return profile ? { status: "authenticated", profile } : { status: "no_profile", authUserId: user.id };
}

export class OwnerAuthError extends Error {
  code: "unauthenticated" | "not_owner";
  constructor(code: "unauthenticated" | "not_owner") {
    super(code === "unauthenticated" ? "Not signed in." : "Signed in, but not an active owner.");
    this.name = "OwnerAuthError";
    this.code = code;
  }
}

/** Server-action gate: returns the active owner profile or throws
 *  OwnerAuthError. Actions ARE the trust boundary in front of the
 *  service-role client (same doctrine as jobs/actions.ts's module doc). */
export async function requireActiveOwner(): Promise<WorkforceProfile> {
  const session = await getWorkforceSession();
  if (session.status === "unauthenticated") throw new OwnerAuthError("unauthenticated");
  if (session.status !== "authenticated" || !isActiveOwner(session.profile)) {
    throw new OwnerAuthError("not_owner");
  }
  return session.profile;
}
```

Create `web/src/app/auth/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/");
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/workforce`
Expected: PASS (all normalizer + predicate tests).

- [ ] **Step 6: Typecheck the new modules compile in context**

Run: `cd web && npm run build`
Expected: build succeeds (nothing imports the new modules yet — this catches TS/`server-only` wiring mistakes early).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/supabase/server.ts \
  web/src/lib/supabase/browser.ts web/src/lib/workforce web/src/app/auth/actions.ts
git commit -m "feat: auth foundation — SSR session clients, workforce profile reader, sign-out"
```

---

### Task 2 (Wave 1, runs ∥ Tasks 3 and 5): Magic-link sign-in, confirm route, and the proxy

**Files:**
- Create: `web/src/lib/supabase/proxyDecision.ts`
- Test: `web/src/lib/supabase/__tests__/proxyDecision.test.ts`
- Create: `web/src/proxy.ts`
- Create: `web/src/app/auth/sign-in/page.tsx`
- Create: `web/src/app/auth/confirm/route.ts`

**Interfaces:**
- Consumes: Task 1's `createSessionClient`, `createBrowserSupabaseClient`.
- Produces: `decideProxyAction(pathname: string, hasUser: boolean): ProxyDecision`; `safeNextPath(value: string | null): string`; routes `/auth/sign-in` and `/auth/confirm`. (`signOutAction` already exists from Task 1 — do NOT create `web/src/app/auth/actions.ts` here.)

- [ ] **Step 1: Write the failing proxy-decision tests**

Create `web/src/lib/supabase/__tests__/proxyDecision.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideProxyAction, safeNextPath } from "../proxyDecision";

describe("decideProxyAction", () => {
  it("redirects unauthenticated /jobs and /jobs/* to sign-in with next", () => {
    expect(decideProxyAction("/jobs", false)).toEqual({ kind: "redirect_sign_in", next: "/jobs" });
    expect(decideProxyAction("/jobs/JOB-1108/costs", false)).toEqual({
      kind: "redirect_sign_in",
      next: "/jobs/JOB-1108/costs",
    });
  });
  it("passes authenticated /jobs through", () => {
    expect(decideProxyAction("/jobs", true)).toEqual({ kind: "next" });
  });
  it("passes / and /estimates and /auth through regardless of session", () => {
    expect(decideProxyAction("/", false)).toEqual({ kind: "next" });
    expect(decideProxyAction("/estimates", false)).toEqual({ kind: "next" });
    expect(decideProxyAction("/auth/sign-in", false)).toEqual({ kind: "next" });
  });
  it("does not treat /jobsish prefixes as gated", () => {
    expect(decideProxyAction("/jobsite", false)).toEqual({ kind: "next" });
  });
});

describe("safeNextPath", () => {
  it("accepts a same-origin path", () => {
    expect(safeNextPath("/jobs/JOB-1108")).toBe("/jobs/JOB-1108");
  });
  it.each([null, "", "https://evil.example", "//evil.example", "jobs", "/\\evil"])(
    "falls back to / for %s",
    (v) => {
      expect(safeNextPath(v)).toBe("/");
    },
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/lib/supabase`
Expected: FAIL — `../proxyDecision` does not exist.

- [ ] **Step 3: Implement the pure decision module**

Create `web/src/lib/supabase/proxyDecision.ts`:

```ts
// PURE — no I/O, no next/server import. Tested directly; web/src/proxy.ts
// is a thin shell around this so the gating logic itself is unit-testable.

export type ProxyDecision = { kind: "next" } | { kind: "redirect_sign_in"; next: string };

export function decideProxyAction(pathname: string, hasUser: boolean): ProxyDecision {
  const isJobsRoute = pathname === "/jobs" || pathname.startsWith("/jobs/");
  if (isJobsRoute && !hasUser) {
    return { kind: "redirect_sign_in", next: pathname };
  }
  return { kind: "next" };
}

/** Open-redirect guard for ?next= — only same-origin absolute paths
 *  survive; anything else falls back to "/". Rejects protocol-relative
 *  ("//host") and backslash tricks. */
export function safeNextPath(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/supabase`
Expected: PASS.

- [ ] **Step 5: Implement the proxy**

⚠️ Next 16 renamed `middleware` to `proxy` — the v2 contract names `web/src/proxy.ts`. Before writing, confirm the exact file-name + export convention against the installed Next 16.3.1 docs (`npx next --help` output or node_modules/next docs; the `vercel:nextjs` skill is available). If 16.3.1 still expects `src/middleware.ts` with `export function middleware`, use that name and record the deviation in the commit message — the behavior below is identical either way.

Create `web/src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { decideProxyAction } from "@/lib/supabase/proxyDecision";

/**
 * Session refresh + unauthenticated gate for the owner surface. Runs ONLY
 * on `/`, `/jobs/*`, and `/auth/*` (matcher below) — estimates routes
 * never read a session, so they stay entirely outside auth machinery.
 *
 * The owner-vs-pending check does NOT live here — the proxy knows only
 * "has a session or not". The (app)/jobs/layout.tsx server check owns the
 * active-owner decision (defense in depth: proxy for session presence,
 * layout for authorization).
 */
export default async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("proxy: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.");
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decision = decideProxyAction(request.nextUrl.pathname, user !== null);
  if (decision.kind === "redirect_sign_in") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/sign-in";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", decision.next);
    return NextResponse.redirect(redirectUrl);
  }
  return response;
}

export const config = {
  matcher: ["/", "/jobs/:path*", "/auth/:path*"],
};
```

- [ ] **Step 6: Implement the confirm route**

Create `web/src/app/auth/confirm/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSessionClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/supabase/proxyDecision";

/**
 * Magic-link landing. Supabase's email links carry token_hash + type;
 * verifyOtp() through the cookie-bound session client sets the auth
 * cookies (Route Handlers CAN write cookies, unlike Server Components).
 * Failure lands back on sign-in with a visible error flag — never a
 * silent 500.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash) {
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/auth/sign-in?error=confirm", request.url));
}
```

- [ ] **Step 7: Implement the sign-in page**

Create `web/src/app/auth/sign-in/page.tsx` (client component; visual language mirrors the existing app — zinc borders, base font sizes, dark-mode variants as in `(app)/layout.tsx`):

```tsx
"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * Email magic-link sign-in for owners (and, in Task 8b, foremen).
 *
 * `shouldCreateUser: false` is DELIBERATE and load-bearing: the app is
 * network-open, and without it any stranger could mint auth.users rows
 * (and workforce_profiles rows via the on_auth_user_created trigger) by
 * typing an email. New people are invited from the Supabase dashboard
 * first (docs/runbooks/owner-promotion.md), then sign in here.
 */
function SignInForm() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";
  const confirmError = searchParams.get("error") === "confirm";

  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setSignedInAs(user?.email ?? null);
    });
  }, []);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrorMessage(null);
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(nextPath)}`,
      },
    });
    if (error) {
      setState("error");
      setErrorMessage(error.message);
    } else {
      setState("sent");
    }
  }

  async function signOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    setSignedInAs(null);
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {confirmError ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          That sign-in link is invalid or expired. Request a new one below.
        </p>
      ) : null}
      {signedInAs ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as {signedInAs}.{" "}
          <button type="button" onClick={signOut} className="underline">
            Sign out
          </button>
        </p>
      ) : null}
      {state === "sent" ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Check your email — a sign-in link is on its way to {email.trim()}.
        </p>
      ) : (
        <form onSubmit={sendLink} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              className="rounded-md border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button
            type="submit"
            disabled={state === "sending"}
            className="rounded-md bg-zinc-900 px-3 py-2 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
          {state === "error" && errorMessage ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              {errorMessage.includes("Signups not allowed") || errorMessage.toLowerCase().includes("signup")
                ? "This email isn't set up for sign-in. Ask Matt to invite you first."
                : errorMessage}
            </p>
          ) : null}
        </form>
      )}
      <p className="text-sm text-zinc-500">
        Estimating doesn&apos;t need an account —{" "}
        <a href="/estimates" className="underline">
          go to Estimates
        </a>
        .
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
```

(`useSearchParams` requires the Suspense wrapper for build-time prerendering — hence the split.)

- [ ] **Step 8: Lint + build**

Run: `cd web && npm run lint && npm run build`
Expected: lint 0 new errors; build succeeds (the proxy file compiling into the build output confirms the naming convention was right — if the build ignores it, revisit Step 5's naming check).

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/supabase/proxyDecision.ts web/src/lib/supabase/__tests__ \
  web/src/proxy.ts web/src/app/auth/sign-in web/src/app/auth/confirm
git commit -m "feat: magic-link sign-in, confirm route, and /jobs proxy gate"
```

---

### Task 3 (Wave 1, runs ∥ Tasks 2 and 5): Owner-gate `/jobs` layout + flip `/`

**Files:**
- Create: `web/src/app/(app)/jobs/layout.tsx`
- Modify: `web/src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: Task 1's `getWorkforceSession`, `isActiveOwner`, `signOutAction`. (No import from Task 2 — `/auth/sign-in` appears only as a redirect path string, which is why this task doesn't wait for it. The Step 3 curl checks that exercise `/auth/sign-in` end-to-end only become meaningful once Task 2 has landed; run the build/lint portion regardless and defer the curls to whichever of Tasks 2/3 finishes second, noting it in the commit message if deferred.)
- Produces: every route under `/jobs` (dashboard, `[jobNumber]`, `costs`, `revenue`, `exceptions`) server-verified owner-only; `/` routing an active owner to `/jobs` and everyone else to `/estimates`.

- [ ] **Step 1: Create the gated layout**

Create `web/src/app/(app)/jobs/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getWorkforceSession, isActiveOwner } from "@/lib/workforce/profile";
import { signOutAction } from "@/app/auth/actions";

/**
 * v2 Task 8a: the financial-route gate. Every route under /jobs — the
 * dashboard, job detail, costs, revenue, exceptions — renders through
 * this layout, so the active-owner check happens exactly once, server-
 * side, per navigation. The proxy already bounced session-less requests
 * to /auth/sign-in; this layout is the AUTHORIZATION check (pending or
 * foreman profiles are not owners) and the defense-in-depth re-check.
 *
 * The estimator picker surface (/estimates/*) is deliberately outside
 * this gate and unchanged — see CLAUDE.md "No-login estimate tool".
 */
export default async function JobsLayout({ children }: { children: React.ReactNode }) {
  const session = await getWorkforceSession();
  if (session.status === "unauthenticated") {
    redirect("/auth/sign-in?next=/jobs");
  }
  if (session.status !== "authenticated" || !isActiveOwner(session.profile)) {
    redirect("/estimates");
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>Signed in as {session.profile.displayName}</span>
        <form action={signOutAction}>
          <button type="submit" className="underline">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Flip `/`**

Replace the body of `web/src/app/(app)/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getWorkforceSession, isActiveOwner } from "@/lib/workforce/profile";

/**
 * `/` has no content of its own. v2 Task 8a flipped the home surface per
 * the 2026-08-25 BUILD_PLAN amendment: an authenticated ACTIVE OWNER
 * lands on the Job Dashboard; everyone else — anonymous visitors,
 * pending profiles, foremen — continues to the estimate list exactly as
 * before. The no-login estimator picker flow stays reachable with zero
 * behavior change for anyone without an owner session.
 */
export default async function RootPage() {
  const session = await getWorkforceSession();
  if (session.status === "authenticated" && isActiveOwner(session.profile)) {
    redirect("/jobs");
  }
  redirect("/estimates");
}
```

- [ ] **Step 3: Build + verify redirect behavior locally**

Run: `cd web && npm run lint && npm run build`
Expected: build succeeds; `/` and `/jobs/*` compile as dynamic routes (cookie read).

Then, if `web/.env.local` exists locally: `npm run dev` and confirm with curl —

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/          # 307 → /estimates (no session)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/jobs      # 307 → /auth/sign-in?next=/jobs
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/auth/sign-in               # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/estimates                  # 200 (untouched)
```

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/(app)/jobs/layout.tsx' 'web/src/app/(app)/page.tsx'
git commit -m "feat: owner-gate /jobs financial routes and flip / to the dashboard"
```

---

### Task 4 (Wave 0, runs ∥ Task 1 — pure docs, no code dependencies): Owner-promotion runbook + canonical plan amendments

**Files:**
- Create: `docs/runbooks/owner-promotion.md`
- Modify: `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (Task 8 section — amendment block only)
- Modify: `BUILD_PLAN.md` (new dated amendment note)

**Interfaces:**
- Consumes: Matt's three Session-14 rulings; live `workforce_profiles` state (1 row: Matt, `pending`/`inactive`).
- Produces: the gate-time promotion procedure; the canonical record of the 8a/8b split.

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/owner-promotion.md` with exactly these sections:

```markdown
# Owner promotion + Supabase Auth configuration runbook

v2 Task 8a (Session 14, 2026-08-27). Run at the session's production gate,
each step on Matt's explicit go. Idempotent; re-runnable.

## 1. Supabase Auth configuration (dashboard, Matt or MCP-assisted)

Project `eiqqqwajmcpcwhvxxnhx` → Authentication → URL Configuration:

- **Site URL:** `https://lostboysdemolition.vercel.app`
- **Additional redirect URLs:**
  - `https://lostboysdemolition.vercel.app/auth/confirm`
  - `http://localhost:3000/auth/confirm`

Authentication → Sign In / Providers → Email: magic link enabled (default).
Signups are NOT disabled project-wide — the app passes
`shouldCreateUser: false` instead, so only dashboard-invited emails can
sign in. Note: Supabase's built-in email sender is rate-limited (a few
emails/hour) — fine for 1–2 owners; revisit (custom SMTP) before Task 8b
onboards foremen.

## 2. Promote Matt (one-time, service-role)

Read first:

    select auth_user_id, display_name, role, active
    from public.workforce_profiles;

Expected: exactly one row — display_name 'Matt', role 'pending',
active false. Then:

    update public.workforce_profiles
    set role = 'owner', active = true, updated_at = now()
    where display_name = 'Matt' and role = 'pending';

Verify: re-run the select; expect role 'owner', active true. This is the
deferred Task 0B "owner promotion" step — the only service-role identity
write in the system.

## 3. Live smoke (read-only)

1. Matt: `/auth/sign-in` → email → tap the emailed link → lands `/`,
   which redirects to `/jobs`.
2. `/jobs`, `/jobs/JOB-1108`, `/jobs/exceptions` render with the
   "Signed in as Matt · Sign out" bar.
3. Incognito window: `/` → `/estimates`; `/jobs` → `/auth/sign-in?next=/jobs`;
   `/estimates` + the picker work exactly as before.
4. Sign out → `/` → `/estimates` again.

## 4. Dane, later (deferred by Matt's Session-14 ruling)

1. Dashboard → Authentication → Users → **Invite user** with Dane's email.
2. Dane opens the invite link → auth user created → `on_auth_user_created`
   inserts his `workforce_profiles` row (`pending`/`inactive`).
3. Repeat §2's update for Dane's row (match on his `auth_user_id`).
4. §3 smoke from Dane's phone.
```

- [ ] **Step 2: Amend the v2 plan**

In `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md`, immediately under the `### Task 8: Authenticated mobile Job Checklist area` heading, insert:

```markdown
> **AMENDED 2026-08-27 (Session 14, Matt's ruling): Task 8 is split.**
> **Task 8a — SHIPPED Session 14:** owner auth (email magic link,
> `@supabase/ssr`, `shouldCreateUser: false`), owner-gating of every
> `/jobs/*` financial route (proxy + layout defense in depth), the `/`
> flip per the 2026-08-25 BUILD_PLAN amendment, and the owner-promotion
> runbook (`docs/runbooks/owner-promotion.md`; Matt promoted now, Dane
> deferred). **Task 8b — follow-on session:** everything else in this
> task (foreman mobile checklist area: offline queue, service worker,
> `job-checklist-photos` bucket, `submit_job_checklist` RPC, GHL
> lifecycle automation, `activateWorkforceProfile`, migration
> `20260818160000_ops_auth_and_checklist_storage.sql`). The Phase 3 gate
> closes at 8b. The backlogged overrun-alert `action_path` RPC fix
> attaches to 8b's migration window. Task 9 shipped in Session 14
> alongside 8a, with its override action gated by the authenticated
> owner rather than the estimator picker.
```

- [ ] **Step 3: Amend BUILD_PLAN.md**

After the `## AMENDED 2026-08-25 — the Job Dashboard is the web app's home surface` section, add:

```markdown
## AMENDED 2026-08-27 — v2 Task 8 split 8a/8b; owner auth ships first

Matt's Session-14 rulings: (1) ratified Task 8 splits into **8a** (owner
auth + `/jobs` financial-route gating + the `/` flip — shipped Session 14
with Task 9) and **8b** (the authenticated foreman mobile checklist area —
its own follow-on session, carrying the Phase 3 gate and the backlogged
alert `action_path` migration); (2) owner promotion covers **Matt now,
Dane later** (runbook: `docs/runbooks/owner-promotion.md`); (3) sign-in is
**email magic link** with `shouldCreateUser: false` (invite-only — the
deployment stays network-open for `/estimates`, while `/jobs/*` now
requires an active owner session).
```

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/owner-promotion.md \
  docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md \
  BUILD_PLAN.md
git commit -m "docs: owner-promotion runbook + record the Task 8a/8b split"
```

---

### Task 5 (Wave 0, Lane B start, runs ∥ Tasks 1 and 4 — pure module, no auth dependency): Forecast override validation

**Files:**
- Create: `web/src/lib/forecasts/types.ts`
- Create: `web/src/lib/forecasts/validate.ts`
- Test: `web/src/lib/forecasts/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: `COST_CATEGORIES`, `CostCategory` from `@/lib/profitability/types`.
- Produces (Tasks 6–7 depend on these exact names):
  - `type ForecastOverrideInput = { kind: "labor"; jobNumber: string; remainingWorkdays: number; expectedCrewSize: number; hoursPerDay: number; reason: string } | { kind: "category"; jobNumber: string; category: CostCategory; expectedRemainingCost: number; reason: string }`
  - `validateForecastOverrideInput(input: unknown): { ok: true; value: ForecastOverrideInput } | { ok: false; errors: string[] }`

- [ ] **Step 1: Write the failing validation tests**

Create `web/src/lib/forecasts/__tests__/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateForecastOverrideInput } from "../validate";

const labor = {
  kind: "labor",
  jobNumber: "JOB-1108",
  remainingWorkdays: 3,
  expectedCrewSize: 4,
  hoursPerDay: 8,
  reason: "Crew 2 pulled to another job two days",
};

const category = {
  kind: "category",
  jobNumber: "JOB-1108",
  category: "dump",
  expectedRemainingCost: 130,
  reason: "Two more loads expected",
};

describe("validateForecastOverrideInput — labor", () => {
  it("accepts a full labor triple", () => {
    const r = validateForecastOverrideInput(labor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(labor);
  });

  it("accepts remainingWorkdays 0 (job nearly done)", () => {
    expect(validateForecastOverrideInput({ ...labor, remainingWorkdays: 0 }).ok).toBe(true);
  });

  it("rejects zero or negative expectedCrewSize (zero-divisor guard)", () => {
    expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: 0 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: -2 }).ok).toBe(false);
  });

  it("rejects non-integer expectedCrewSize", () => {
    expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: 2.5 }).ok).toBe(false);
  });

  it("rejects hoursPerDay of 0, negative, or > 24 (zero-divisor guard)", () => {
    expect(validateForecastOverrideInput({ ...labor, hoursPerDay: 0 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, hoursPerDay: -1 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, hoursPerDay: 24.5 }).ok).toBe(false);
  });

  it("rejects negative remainingWorkdays", () => {
    expect(validateForecastOverrideInput({ ...labor, remainingWorkdays: -1 }).ok).toBe(false);
  });

  it("rejects a partial labor triple", () => {
    const partial: Record<string, unknown> = { ...labor };
    delete partial.hoursPerDay;
    expect(validateForecastOverrideInput(partial).ok).toBe(false);
  });

  it.each(["", "3", NaN, Infinity, null])(
    "rejects %p in every numeric field (empty-string/coercion carry)",
    (bad) => {
      expect(validateForecastOverrideInput({ ...labor, remainingWorkdays: bad }).ok).toBe(false);
      expect(validateForecastOverrideInput({ ...labor, expectedCrewSize: bad }).ok).toBe(false);
      expect(validateForecastOverrideInput({ ...labor, hoursPerDay: bad }).ok).toBe(false);
    },
  );
});

describe("validateForecastOverrideInput — category", () => {
  it("accepts a category ETC override", () => {
    const r = validateForecastOverrideInput(category);
    expect(r.ok).toBe(true);
  });

  it("accepts expectedRemainingCost 0 (nothing left to spend)", () => {
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: 0 }).ok).toBe(true);
  });

  it("rejects negative and non-number expectedRemainingCost", () => {
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: -5 }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: "130" }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...category, expectedRemainingCost: "" }).ok).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(validateForecastOverrideInput({ ...category, category: "overhead" }).ok).toBe(false);
  });
});

describe("validateForecastOverrideInput — shared", () => {
  it("rejects an unknown kind and a mixed submission", () => {
    expect(validateForecastOverrideInput({ ...labor, kind: "both" }).ok).toBe(false);
    expect(
      validateForecastOverrideInput({ ...labor, category: "dump", expectedRemainingCost: 100 }).ok,
    ).toBe(false); // labor schema is strict — category fields on a labor submission are rejected
  });

  it("rejects a blank or whitespace reason", () => {
    expect(validateForecastOverrideInput({ ...labor, reason: "" }).ok).toBe(false);
    expect(validateForecastOverrideInput({ ...labor, reason: "   " }).ok).toBe(false);
  });

  it("rejects a malformed job number", () => {
    expect(validateForecastOverrideInput({ ...labor, jobNumber: "1108" }).ok).toBe(false);
  });

  it("returns path-prefixed error strings", () => {
    const r = validateForecastOverrideInput({ ...labor, expectedCrewSize: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("expectedCrewSize"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/lib/forecasts`
Expected: FAIL — `../validate` does not exist.

- [ ] **Step 3: Implement types + validation**

Create `web/src/lib/forecasts/types.ts`:

```ts
import type { CostCategory } from "@/lib/profitability/types";

/** Discriminated override input: a labor override supplies the FULL
 *  crew-days triple (v2 Task 9 contract — "either a labor override
 *  (remainingWorkdays, expectedCrewSize, hoursPerDay) or one category
 *  ETC override"); a category override supplies one expected remaining
 *  cost. Exactly one kind per submission — one appended
 *  job_forecast_overrides row each. */
export type ForecastOverrideInput =
  | {
      kind: "labor";
      jobNumber: string;
      remainingWorkdays: number;
      expectedCrewSize: number;
      hoursPerDay: number;
      reason: string;
    }
  | {
      kind: "category";
      jobNumber: string;
      category: CostCategory;
      expectedRemainingCost: number;
      reason: string;
    };

export type ForecastOverrideValidation =
  | { ok: true; value: ForecastOverrideInput }
  | { ok: false; errors: string[] };
```

Create `web/src/lib/forecasts/validate.ts`:

```ts
// ============================================================
// Lost Boys Demolition — web app — forecast override validation
// (Profitability v2 Task 9, Session 14 Lane B)
//
// PURE — no "server-only", no I/O. Same safeParse → discriminated result,
// path-prefixed error-string pattern as @/lib/ledger/validate.ts.
//
// CRITICAL CARRY (Task 6 final review → Session 13 handoff): every
// numeric field is z.number() ONLY — never z.coerce.number(). Empty
// string, numeric string, NaN, and Infinity are all REJECTED. The
// positivity requirements on expectedCrewSize/hoursPerDay are the
// crew-days zero-divisor guard: an override can never inject a 0 into
// the remainingWorkdays × expectedCrewSize × hoursPerDay product that
// calculateJobHealth.ts builds its labor forecast from.
// ============================================================

import { z } from "zod";
import { COST_CATEGORIES } from "@/lib/profitability/types";
import type { ForecastOverrideInput, ForecastOverrideValidation } from "./types";

const JOB_NUMBER_RE = /^JOB-\d+$/;

const jobNumberSchema = z.string().regex(JOB_NUMBER_RE, "must look like JOB-1234");
const reasonSchema = z
  .string()
  .refine((s) => s.trim() !== "", { message: "reason is required" })
  .transform((s) => s.trim());

const laborSchema = z
  .object({
    kind: z.literal("labor"),
    jobNumber: jobNumberSchema,
    // numeric(5,2) column — cap well inside it. 0 allowed: "no days left".
    remainingWorkdays: z.number().finite().min(0).max(365),
    expectedCrewSize: z.number().int().positive().max(50),
    hoursPerDay: z.number().positive().max(24),
    reason: reasonSchema,
  })
  .strict();

const categorySchema = z
  .object({
    kind: z.literal("category"),
    jobNumber: jobNumberSchema,
    category: z.enum(COST_CATEGORIES),
    // numeric(12,2) column — cap well inside it. 0 allowed: "nothing left".
    expectedRemainingCost: z.number().finite().min(0).max(9_999_999),
    reason: reasonSchema,
  })
  .strict();

const overrideSchema = z.discriminatedUnion("kind", [laborSchema, categorySchema]);

export function validateForecastOverrideInput(input: unknown): ForecastOverrideValidation {
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
    };
  }
  return { ok: true, value: parsed.data as ForecastOverrideInput };
}
```

(If `COST_CATEGORIES` is typed as `CostCategory[]` rather than a tuple, adapt with `z.enum(COST_CATEGORIES as [CostCategory, ...CostCategory[]])` — check `@/lib/profitability/types` and follow however `@/lib/ledger/validate.ts` already consumes it.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/forecasts`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forecasts
git commit -m "feat: forecast override validation with crew-days zero-divisor guard"
```

---

### Task 6 (Wave 1, runs ∥ Tasks 2 and 3; needs Tasks 1 + 5): Override repo + owner-gated server action

**Files:**
- Create: `web/src/lib/forecasts/repo.ts`
- Modify: `web/src/app/(app)/jobs/actions.ts` (append the new action; touch nothing existing)
- Test: `web/src/lib/forecasts/__tests__/repo.test.ts`

**Interfaces:**
- Consumes: Task 5's `ForecastOverrideInput`/`validateForecastOverrideInput`; Task 1's `requireActiveOwner`/`OwnerAuthError`; existing `createAdminClient` (`@/lib/supabase/admin`), `getJobHealthDetail` (`@/lib/jobs/healthRepo`), `ForecastOverrideRow` (`@/lib/jobs/map`).
- Produces:
  - `createForecastOverride(input: ForecastOverrideInput, actor: { authUserId: string; displayName: string }): Promise<ForecastOverrideRow>` and `class ForecastOverrideError extends Error { code: "unknown_job" | "insert_failed" }`
  - `createForecastOverrideAction(input: unknown): Promise<ForecastOverrideActionResult>` where `type ForecastOverrideActionResult = { ok: true; overrideId: string; previousForecastProfit: number | null; newForecastProfit: number | null; newHealth: "on_track" | "watch" | "at_risk" | null; newConfidence: "high" | "medium" | "low" | null } | { ok: false; error: string; fieldErrors?: string[] }`

- [ ] **Step 1: Write the failing repo tests**

Create `web/src/lib/forecasts/__tests__/repo.test.ts` following the mock style of `web/src/lib/jobs/__tests__/repo.test.ts` (chainable Supabase client stub via `vi.fn()`; read that file first and mirror its builder). Test cases:

```ts
// 1. labor input maps to an insert row with category null, the three
//    labor columns set, expected_remaining_cost null, created_by =
//    actor.authUserId, created_by_name = actor.displayName.
// 2. category input maps to category + expected_remaining_cost set and
//    all three labor columns null.
// 3. a Postgres 23503 FK error surfaces as ForecastOverrideError
//    code "unknown_job".
// 4. any other insert error surfaces as code "insert_failed" with the
//    Postgres message preserved.
```

Run: `cd web && npx vitest run src/lib/forecasts` — expect the new file FAILs (`../repo` missing).

- [ ] **Step 2: Implement the repo**

Create `web/src/lib/forecasts/repo.ts`:

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ForecastOverrideRow } from "@/lib/jobs/map";
import type { ForecastOverrideInput } from "./types";

export class ForecastOverrideError extends Error {
  code: "unknown_job" | "insert_failed";
  constructor(code: "unknown_job" | "insert_failed", message: string) {
    super(message);
    this.name = "ForecastOverrideError";
    this.code = code;
  }
}

/**
 * Append-only insert into job_forecast_overrides (v2 Task 9). No update
 * or delete path exists by design — a wrong override is corrected by
 * appending a newer one (map.ts's pickLaborForecastSource and the
 * per-category latest-wins loop both read newest-first). RLS on the
 * table has no policies; this service-role write happens ONLY behind
 * createForecastOverrideAction's requireActiveOwner() gate.
 *
 * `created_by` carries the authenticated owner's real auth.users id —
 * the first writer in the system to do so under the post-no-login model.
 */
export async function createForecastOverride(
  input: ForecastOverrideInput,
  actor: { authUserId: string; displayName: string },
): Promise<ForecastOverrideRow> {
  const supabase = createAdminClient();
  const row = {
    job_number: input.jobNumber,
    category: input.kind === "category" ? input.category : null,
    remaining_workdays: input.kind === "labor" ? input.remainingWorkdays : null,
    expected_crew_size: input.kind === "labor" ? input.expectedCrewSize : null,
    hours_per_day: input.kind === "labor" ? input.hoursPerDay : null,
    expected_remaining_cost: input.kind === "category" ? input.expectedRemainingCost : null,
    reason: input.reason,
    created_by: actor.authUserId,
    created_by_name: actor.displayName,
  };
  const { data, error } = await supabase
    .from("job_forecast_overrides")
    .insert(row)
    .select("id, job_number, category, remaining_workdays, expected_crew_size, hours_per_day, expected_remaining_cost, reason, created_by_name, created_at")
    .single();
  if (error) {
    if (error.code === "23503") {
      throw new ForecastOverrideError("unknown_job", `No job ${input.jobNumber}.`);
    }
    throw new ForecastOverrideError("insert_failed", error.message);
  }
  return data as unknown as ForecastOverrideRow;
}
```

- [ ] **Step 3: Run repo tests to verify pass**

Run: `cd web && npx vitest run src/lib/forecasts`
Expected: PASS.

- [ ] **Step 4: Append the server action**

In `web/src/app/(app)/jobs/actions.ts`, append (imports merged at the top; existing code untouched):

```ts
import { requireActiveOwner, OwnerAuthError } from "@/lib/workforce/profile";
import { validateForecastOverrideInput } from "@/lib/forecasts/validate";
import { createForecastOverride, ForecastOverrideError } from "@/lib/forecasts/repo";
import { getJobHealthDetail } from "@/lib/jobs/healthRepo";

export type ForecastOverrideActionResult =
  | {
      ok: true;
      overrideId: string;
      previousForecastProfit: number | null;
      newForecastProfit: number | null;
      newHealth: "on_track" | "watch" | "at_risk" | null;
      newConfidence: "high" | "medium" | "low" | null;
    }
  | { ok: false; error: string; fieldErrors?: string[] };

/**
 * v2 Task 9: append an owner forecast override and report the health
 * delta. UNLIKE every other action in this file, the gate is the
 * AUTHENTICATED OWNER SESSION (Task 8a), not the estimator picker —
 * forecast overrides are Dane/Matt-only by contract, and this is the
 * first action written after real auth exists. The before/after
 * getJobHealthDetail reads are how "immediate recalculation" surfaces:
 * the second read recomputes with the new override and (via healthRepo's
 * watermark) persists a fresh job_forecast_snapshots row.
 */
export async function createForecastOverrideAction(
  input: unknown,
): Promise<ForecastOverrideActionResult> {
  let actor;
  try {
    actor = await requireActiveOwner();
  } catch (e) {
    if (e instanceof OwnerAuthError) {
      return {
        ok: false,
        error:
          e.code === "unauthenticated"
            ? "Sign in as an owner to override forecasts."
            : "Your account is not an active owner.",
      };
    }
    throw e;
  }

  const validated = validateForecastOverrideInput(input);
  if (!validated.ok) {
    return { ok: false, error: "Fix the highlighted fields.", fieldErrors: validated.errors };
  }
  const value = validated.value;

  try {
    const before = await getJobHealthDetail(value.jobNumber);
    const override = await createForecastOverride(value, {
      authUserId: actor.authUserId,
      displayName: actor.displayName,
    });
    const after = await getJobHealthDetail(value.jobNumber);
    revalidatePath(`/jobs/${value.jobNumber}`);
    return {
      ok: true,
      overrideId: override.id,
      previousForecastProfit: before?.health?.forecastProfit ?? null,
      newForecastProfit: after?.health?.forecastProfit ?? null,
      newHealth: after?.health?.health ?? null,
      newConfidence: after?.health?.confidence ?? null,
    };
  } catch (e) {
    if (e instanceof ForecastOverrideError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }
}
```

Before writing, read `JobHealthResult`'s actual field names in `@/lib/profitability/types.ts` (`health`, `confidence`, `forecastProfit` are expected from Task 3/6 — confirm and match exactly; if the result nests differently, adapt the three reads and the `ForecastOverrideActionResult` construction, keeping the declared result type).

- [ ] **Step 5: Lint, scoped tests, commit**

Run: `cd web && npm run lint && npx vitest run src/lib/forecasts "src/app/(app)/jobs"`
Expected: PASS (existing `jobs/__tests__/actions.test.ts` untouched and green).

```bash
git add web/src/lib/forecasts 'web/src/app/(app)/jobs/actions.ts'
git commit -m "feat: append-only forecast override repo and owner-gated action"
```

---

### Task 7 (Wave 2, after Task 6): ForecastOverridePanel + job detail wiring

**Files:**
- Create: `web/src/app/(app)/jobs/[jobNumber]/_components/ForecastOverridePanel.tsx`
- Test: `web/src/app/(app)/jobs/[jobNumber]/_components/__tests__/ForecastOverridePanel.test.ts`
- Modify: `web/src/app/(app)/jobs/[jobNumber]/page.tsx`

**Interfaces:**
- Consumes: Task 6's `createForecastOverrideAction` + `ForecastOverrideActionResult`; `JobHealthDetail`'s `healthInput`, `health`, `overrides` (already fetched — `overrides: ForecastOverrideRow[]` is in the detail payload); `CATEGORY_LABELS` from `@/lib/jobs/map`.
- Produces: the panel section on `/jobs/[jobNumber]` (v2 contract: defaults closed, shows current forecast values, after save displays the new health result and the forecast-profit delta, shows override history without touching checklist rows).

- [ ] **Step 1: Write the failing pure-helper tests**

House pattern (see `AuditTimeline.test.ts`): components are tested through exported pure helpers, not rendering. Create `__tests__/ForecastOverridePanel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildOverrideSubmission,
  formatProfitDelta,
} from "../ForecastOverridePanel";

describe("buildOverrideSubmission", () => {
  it("builds a labor submission from form strings", () => {
    expect(
      buildOverrideSubmission("labor", "JOB-1108", {
        remainingWorkdays: "3",
        expectedCrewSize: "4",
        hoursPerDay: "8",
        category: "",
        expectedRemainingCost: "",
        reason: "Crew pulled",
      }),
    ).toEqual({
      kind: "labor",
      jobNumber: "JOB-1108",
      remainingWorkdays: 3,
      expectedCrewSize: 4,
      hoursPerDay: 8,
      reason: "Crew pulled",
    });
  });

  it("maps empty numeric strings to undefined, never 0 (empty-string carry)", () => {
    const built = buildOverrideSubmission("labor", "JOB-1108", {
      remainingWorkdays: "",
      expectedCrewSize: "4",
      hoursPerDay: "8",
      category: "",
      expectedRemainingCost: "",
      reason: "x",
    });
    expect((built as Record<string, unknown>).remainingWorkdays).toBeUndefined();
  });

  it("builds a category submission", () => {
    expect(
      buildOverrideSubmission("category", "JOB-1108", {
        remainingWorkdays: "",
        expectedCrewSize: "",
        hoursPerDay: "",
        category: "dump",
        expectedRemainingCost: "130",
        reason: "Two more loads",
      }),
    ).toEqual({
      kind: "category",
      jobNumber: "JOB-1108",
      category: "dump",
      expectedRemainingCost: 130,
      reason: "Two more loads",
    });
  });
});

describe("formatProfitDelta", () => {
  it("formats a signed delta", () => {
    expect(formatProfitDelta(1000, 750)).toBe("-$250.00");
    expect(formatProfitDelta(750, 1000)).toBe("+$250.00");
  });
  it("returns null when either side is unknown", () => {
    expect(formatProfitDelta(null, 750)).toBeNull();
    expect(formatProfitDelta(750, null)).toBeNull();
  });
  it("formats a zero delta without sign", () => {
    expect(formatProfitDelta(500, 500)).toBe("$0.00");
  });
});
```

Run: `cd web && npx vitest run "src/app/(app)/jobs"` — expect FAIL (component missing).

- [ ] **Step 2: Implement the panel**

Create `ForecastOverridePanel.tsx` — client component. Structural requirements (styling mirrors `CostEntryForm.tsx`'s form conventions — read it first, reuse its `parseRequiredNumber` empty-string→`undefined` pattern verbatim):

```tsx
"use client";

import { useState, useTransition } from "react";
import { CATEGORY_LABELS } from "@/lib/jobs/map";
import type { ForecastOverrideRow } from "@/lib/jobs/map";
import {
  createForecastOverrideAction,
  type ForecastOverrideActionResult,
} from "../../actions";

// ---- exported pure helpers (unit-tested) ----

interface OverrideFormStrings {
  remainingWorkdays: string;
  expectedCrewSize: string;
  hoursPerDay: string;
  category: string;
  expectedRemainingCost: string;
  reason: string;
}

/** Form strings → action input. Empty string → undefined (NEVER Number("")
 *  → 0 — the Task 6 final-review carry), so Zod reports missing rather
 *  than silently zeroing. Validation itself lives server-side in
 *  @/lib/forecasts/validate.ts; this only shapes the payload. */
export function buildOverrideSubmission(
  mode: "labor" | "category",
  jobNumber: string,
  form: OverrideFormStrings,
): Record<string, unknown> {
  const num = (v: string): number | undefined => {
    const trimmed = v.trim();
    return trimmed === "" ? undefined : Number(trimmed);
  };
  if (mode === "labor") {
    return {
      kind: "labor",
      jobNumber,
      remainingWorkdays: num(form.remainingWorkdays),
      expectedCrewSize: num(form.expectedCrewSize),
      hoursPerDay: num(form.hoursPerDay),
      reason: form.reason.trim(),
    };
  }
  return {
    kind: "category",
    jobNumber,
    category: form.category === "" ? undefined : form.category,
    expectedRemainingCost: num(form.expectedRemainingCost),
    reason: form.reason.trim(),
  };
}

const deltaCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Signed forecast-profit delta label, or null when either side is
 *  unknown (no snapshotable health before/after). */
export function formatProfitDelta(previous: number | null, next: number | null): string | null {
  if (previous === null || next === null) return null;
  const delta = next - previous;
  const label = deltaCurrency.format(Math.abs(delta));
  if (delta > 0) return `+${label}`;
  if (delta < 0) return `-${label}`;
  return label;
}

// ---- component ----

interface ForecastOverridePanelProps {
  jobNumber: string;
  current: {
    remainingWorkdays: number | null;
    expectedCrewSize: number | null;
    hoursPerDay: number;
    forecastProfit: number | null;
    health: string | null;
  };
  overrides: ForecastOverrideRow[];
}

export function ForecastOverridePanel({ jobNumber, current, overrides }: ForecastOverridePanelProps) {
  // <details>-based disclosure, closed by default (v2 Task 9 contract).
  // State: mode toggle (labor | category), the six form strings, pending
  // via useTransition, and the last ForecastOverrideActionResult.
  // On success: render newHealth + newConfidence chips and
  // formatProfitDelta(previousForecastProfit, newForecastProfit).
  // Below the form: override history (props.overrides, already newest-
  // first) — created_at in America/Denver medium/short, created_by_name,
  // reason, and a values summary ("3 days × 4 crew × 8h" for labor;
  // `${CATEGORY_LABELS[category]} ETC → $X` for category rows).
  // fieldErrors render as a list exactly like CostEntryForm does.
  ...
}
```

Implement the elided body fully — every state transition above is a requirement, not a suggestion. No financial inputs beyond the contract's fields; no edit/delete affordance on history rows (append-only).

- [ ] **Step 3: Wire into the job detail page**

In `web/src/app/(app)/jobs/[jobNumber]/page.tsx`:
- Import the panel; render it **between `LaborVarianceCard` and `ActionQueue`**, passing `jobNumber`, `overrides={detail.overrides}`, and `current` built from `detail.healthInput` (`remainingWorkdays`, `expectedCrewSize`, `hoursPerDay`) and `detail.health` (`forecastProfit`, `health`) — with `current` falling back to `{ remainingWorkdays: null, expectedCrewSize: null, hoursPerDay: 8, forecastProfit: null, health: null }` when `healthInput`/`health` are null (no-budget defensive path).
- Update the Task 6 locked-section-order comment from 8 sections to 9, explicitly noting the Session-14 insertion — the order is review-locked; changing the comment IS the deliberate act.

- [ ] **Step 4: Tests, lint, build**

Run: `cd web && npx vitest run "src/app/(app)/jobs" src/lib/forecasts && npm run lint && npm run build`
Expected: PASS / 0 new lint errors / build green.

- [ ] **Step 5: Commit**

```bash
git add 'web/src/app/(app)/jobs/[jobNumber]/_components/ForecastOverridePanel.tsx' \
  'web/src/app/(app)/jobs/[jobNumber]/_components/__tests__/ForecastOverridePanel.test.ts' \
  'web/src/app/(app)/jobs/[jobNumber]/page.tsx'
git commit -m "feat: owner forecast override panel on job detail"
```

---

### Task 8: Final integration (orchestrator)

**Files:** none new — verification + review only.

- [ ] **Step 1: Full suites**

```bash
cd web && npx vitest run && npm run lint && npm run build
cd .. && deno task test
```

Expected: web ≥ 758 + the new tests, all passing; lint 0 errors (1 pre-existing warning tolerated); build green; deno 411/411 with the golden-321 gate intact (no Deno source changed — any deno failure means environmental drift, investigate before proceeding).

- [ ] **Step 2: Whole-branch adversarial review**

Strongest available model reviews the entire branch diff (`git diff main...claude/v2-task8a-owner-auth`) with explicit attention to: session-cookie handling (no token leak into logs/client props), the open-redirect guard, `shouldCreateUser: false` actually present, the picker surface untouched (`git diff main -- web/src/lib/estimator.ts web/src/app/\(app\)/estimates web/src/app/\(app\)/layout.tsx web/src/app/\(app\)/EstimatorChip.tsx` must be EMPTY), the override action's gate ordering (auth before validation before I/O), and zero schema/migration changes (`git diff main -- supabase/` must be EMPTY).

- [ ] **Step 3: Fix round if needed, re-review, then STOP for Matt's gates**

Matt's gate sequence (each on his explicit go):
1. Supabase Auth URL configuration (runbook §1 — dashboard).
2. Owner promotion (runbook §2 — service-role SQL via MCP, Matt watching).
3. Merge to main (fast-forward) + push.
4. Vercel production deploy verify: `/` 307→`/estimates` anonymous, `/jobs` 307→`/auth/sign-in`, `/estimates` 200, `/auth/sign-in` 200.
5. Live smoke (runbook §3, read-only). Any write smoke (e.g., a real override on JOB-1108) is a separate per-item ask.
6. Session close: BUILD_LOG entry, `NEXT_SESSION_PROMPT.md` regeneration, CLAUDE.md corrections (the "no login / network-open" language must gain the 8a nuance: `/estimates` open, `/jobs/*` owner-gated; `NEXT_PUBLIC_SUPABASE_ANON_KEY` is now load-bearing; v2 phase-row update), memory update.

## Risk flags

- **Next 16 proxy naming** — the contract says `web/src/proxy.ts`; Task 2 Step 5 verifies against installed docs before writing. Wrong naming fails visibly (gate simply absent), and Task 3 Step 3's curl checks catch it.
- **Magic-link email delivery** — Supabase's built-in sender is rate-limited (a few/hour). Fine for one owner; the runbook flags custom SMTP before 8b's foreman rollout.
- **`shouldCreateUser: false`** is the only thing standing between a network-open sign-in page and stranger-minted auth users. It is a review checklist item, and the runbook's invite-first flow depends on it.
- **Cookie reads make `/`, `/jobs/*` fully dynamic** — they already are (`force-dynamic` data pages); no caching regression expected. `/estimates` stays out of the matcher entirely.
- **Two `getJobHealthDetail` reads per override save** is deliberate (delta display) and cheap at this scale; the second read also persists the fresh forecast snapshot via the existing watermark logic.
- **Nobody can test the pending-profile path live** (only one auth user, promoted at the gate) — covered by unit tests on `isActiveOwner` + the layout's redirect logic; accepted.
