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
