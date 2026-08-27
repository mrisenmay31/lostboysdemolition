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
