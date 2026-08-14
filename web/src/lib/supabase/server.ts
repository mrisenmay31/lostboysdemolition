import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Anon (publishable-key) Supabase client for use in Server Components,
 * Server Actions, and Route Handlers. Reads/writes the auth session via
 * Next.js cookies — this is the SESSION MANAGEMENT client, not a data
 * client. RLS on every app table is enabled with zero policies (see
 * CLAUDE.md), so this client cannot read any table; it exists only to
 * drive `supabase.auth.*`.
 *
 * Must be created per-request (cookies() is request-scoped) — never
 * module-level singleton.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` was called from a Server Component. This can be
            // ignored if middleware is refreshing the session (it is —
            // see src/middleware.ts), since the middleware's response
            // carries the refreshed cookies to the browser.
          }
        },
      },
    },
  );
}
