// ============================================================
// Lost Boys Demolition — web app — estimate id shape check
//
// PURE. `pushEstimateAction` (actions.ts) has no login and no other
// access control in front of it (see admin.ts's doc comment) — the
// estimateId argument it takes is the only input the client controls.
// This is a cheap, defense-in-depth shape check: a malformed id can
// never reach getEstimate()'s `.eq("id", id)` query, which would
// otherwise surface as an opaque Postgres "invalid input syntax for
// type uuid" error instead of a clear client-facing message.
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidEstimateId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}
