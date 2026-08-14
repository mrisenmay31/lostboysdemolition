import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client factory. `import "server-only"` makes any
 * accidental import from a Client Component a BUILD ERROR, not a runtime
 * leak — see web/src/app/debug/page.tsx's sibling test in task-6-report.md
 * for the spot-check that proves it.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is read lazily INSIDE this function, not at
 * module top level, so importing this module never requires the variable
 * to be set — only *calling* createAdminClient() does. That keeps
 * `npm run build` green in any environment (like this one) that doesn't
 * have the service-role key locally; the var is supplied at deploy time.
 *
 * `persistSession: false` / `autoRefreshToken: false`: this client is
 * short-lived and per-request, never a session-bearing client — it must
 * never write to cookies or attempt a token refresh loop.
 *
 * There is no login in this tool — the service-role key bypasses RLS
 * entirely, and there is no access control in front of any table this
 * client touches. The estimates server actions validating the
 * picker-declared estimator name against the fixed allowlist is not
 * access control — it only constrains attribution (who a write is
 * recorded as coming from), not whether the write is allowed.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
