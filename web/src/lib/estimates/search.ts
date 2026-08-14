// ============================================================
// Lost Boys Demolition — web app — estimate list search sanitization
//
// PURE. listEstimates (repo.ts) builds a raw PostgREST `.or(...)` filter
// string by hand:
//   `job_name.ilike.%${q}%,client_name.ilike.%${q}%`
// PostgREST's filter mini-language treats `,` as the separator between
// OR conditions and `(`/`)` as grouping — passed through unescaped, a
// search string containing any of those characters lets the value break
// out of its intended `ilike` condition and smuggle in additional filter
// clauses (e.g. `q = "a,status.eq.declined"` chains a second OR
// condition; `q = "a)or(status.eq.draft"` breaks out of the implicit
// group `.or()` wraps its argument in). This is filter-injection, not
// SQL-injection (supabase-js/PostgREST still parameterize the resulting
// query against Postgres), but it lets a plain search box silently widen
// or narrow the result set — including surfacing rows outside the
// intended job_name/client_name match — in ways the estimator never
// asked for.
//
// SQL's own LIKE wildcards `%` and `_` are neutralized too, so a search
// for a literal percent sign or underscore in a job/client name matches
// literally instead of acting as a wildcard. PostgREST forwards `ilike`
// patterns straight to Postgres's LIKE machinery, which honors a
// backslash escape by default — so escaping (not stripping) `%`/`_` is
// both correct and lossless.
// ============================================================

/** Characters with PostgREST filter-syntax meaning inside an `.or(...)`
 *  expression's value position. Stripped entirely rather than escaped —
 *  unlike LIKE's `%`/`_`, PostgREST's filter grammar has no backslash-
 *  escape mechanism for its own structural characters, and no real
 *  client/job name needs a literal comma or parenthesis to be found by
 *  search. Stripping keeps the resulting pattern unambiguous. */
const FILTER_SYNTAX_CHARS = /[,()]/g;

/**
 * Prepares a raw search-box string for safe embedding inside an
 * `ilike.%<value>%` PostgREST filter. Order matters: backslash is
 * escaped FIRST so the backslashes this function itself inserts (for
 * `%` and `_`) are never re-escaped by the later replacements.
 *
 * Returns "" for input that is entirely filter-syntax characters (e.g.
 * "()," ) — callers should treat an empty result as "no usable search
 * term" and skip filtering rather than sending an empty-but-present
 * `ilike.%%` pattern.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(FILTER_SYNTAX_CHARS, "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
