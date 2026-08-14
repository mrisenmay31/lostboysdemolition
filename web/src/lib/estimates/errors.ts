// ============================================================
// Lost Boys Demolition — web app — Postgres error classification
//
// PURE. repo.ts's createNewVersion races on the `(estimate_number,
// version)` uniqueness the DB enforces whenever two estimators revise
// the same parent estimate at nearly the same time — the second RPC call
// hits the unique constraint and supabase-js surfaces it as a bare
// PostgrestError whose `.message` reads like
//   'duplicate key value violates unique constraint
//    "estimates_estimate_number_version_key"'
// which is not something to show an estimator. This module recognizes
// that specific failure (Postgres SQLSTATE 23505, "unique_violation") so
// repo.ts can swap it for a friendly message instead of surfacing the
// raw database error string.
// ============================================================

/** Postgres SQLSTATE for unique_violation. supabase-js's PostgrestError
 *  carries the underlying Postgres error code verbatim on `.code`. */
export const POSTGRES_UNIQUE_VIOLATION = "23505";

/** True when `err` looks like a Postgres unique_violation. Accepts the
 *  loose `{ code?: ... }` shape (rather than importing PostgrestError)
 *  so this stays a dependency-free pure function callers can unit-test
 *  without pulling in @supabase/supabase-js's types. */
export function isUniqueViolationError(
  err: { code?: string | null } | null | undefined,
): boolean {
  return err?.code === POSTGRES_UNIQUE_VIOLATION;
}

/** Shown in place of the raw constraint-violation message when
 *  createNewVersion loses a revise race against another version already
 *  created for the same parent. */
export const NEWER_VERSION_EXISTS_MESSAGE =
  "A newer version of this estimate already exists. Refresh and revise the latest version instead.";
