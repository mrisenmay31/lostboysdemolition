import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Public paths reachable without a session. Keep this list short and
// explicit — everything else in the matcher below is gated.
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Standard @supabase/ssr session-refresh middleware. Runs on every matched
 * request (see `config.matcher`): refreshes the auth cookie via
 * `getUser()` (server-verified, not a cookie decode) and redirects
 * unauthenticated requests to /login. `/login` itself is exempt so a
 * signed-out visitor can reach the form.
 *
 * The refreshed session cookies MUST be copied onto `supabaseResponse`
 * (not `NextResponse.next()` built fresh) — this is what keeps the
 * session alive across requests; a shortcut here is a common source of
 * "logged out on refresh" bugs.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "middleware: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set " +
        "(check web/.env.local — see task-6-report.md if it doesn't exist yet).",
    );
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    const res = NextResponse.redirect(loginUrl);
    // Copy supabaseResponse's cookies onto this redirect — getUser() may
    // have just CLEARED a dead/invalid session cookie, and a fresh
    // NextResponse.redirect() built from scratch would discard that
    // clearing write, leaving the dead cookie on the browser.
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }

  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.searchParams.delete("next"); // don't launder the param one hop further
    const res = NextResponse.redirect(homeUrl);
    // Same reasoning: getUser() may have just rotated the refresh token.
    // Without this copy, the browser keeps the dead old token and the next
    // request silently signs the user back out.
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, and common static asset extensions
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
