# Estimate Builder (`web/`)

The Lost Boys Demolition estimate builder — Phase B slice 2. Mobile-first Next 16 App Router app
for Dane, Jackson, and Matt to build, revise, and push estimates to GHL.

**Live:** https://lbd-estimates.vercel.app (Vercel project `lostboysdemolition` — renamed from
`lbd-estimates` 2026-08-18; the production URL did **not** change with the rename. Root directory
`web`, include-outside-root ON, production branch `main`)

> **There is no login.** Identity is a device-remembered "Who's estimating?" picker validated
> server-side against a fixed 3-name allowlist (`src/lib/estimator.ts`). The deployment ships
> network-layer open — anyone with the URL can use it. See the "No-login estimate tool" section
> of the repo-root `CLAUDE.md` before changing anything about attribution or access.

## Getting started

`web/.env.local` is **not** in git and must be hand-created before local dev — the env guard
throws without it. The required variable names are in `web/.env.example`; values are in the
BUILD_LOG entry for 2026-08-14.

```bash
npm install
npm run dev          # http://localhost:3000
npx vitest run       # 261 tests
```

## What lives where

| Path | Role |
|---|---|
| `src/app/(app)/estimates/` | All routes: list, `new`, `[id]` detail, `[id]/revise` |
| `src/app/(app)/estimates/actions.ts` | Every server action (create, status, quote override, push) |
| `src/lib/estimates/` | Domain layer — repo, validate, map, lifecycle, search, builderLogic |
| `src/lib/ghl/` | GHL client, estimate-doc builder, field mapping, push orchestration |
| `src/lib/rates.ts` | `loadRatesConfig()` — reads `pricing_variables` live; never falls back to defaults |
| `src/lib/pricing.ts` | 2-line re-export shim → `supabase/functions/_shared/pricing.ts` |

## Two things not to "simplify"

- **`src/lib/pricing.ts` re-exports the engine; it does not copy it.** The pricing engine is
  golden-tested against all 321 live Airtable estimates to the cent (`deno task test` at the repo
  root). Forking it into `web/` would silently break that gate.
- **`next.config.ts`'s `experimental.externalDir` and `turbopack.root` are load-bearing** — they
  are what let the import above resolve across the `web/` boundary.
