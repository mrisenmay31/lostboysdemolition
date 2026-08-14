/**
 * Sanitizes a `?next=` redirect target so it can never leave this origin.
 *
 * Earlier version of this function used a character blocklist
 * (`startsWith("/")`, reject `//` and `/\`). That's whack-a-mole: WHATWG
 * URL parsing (which is what browsers actually use to resolve a redirect
 * `Location` header / `<a href>`) strips ASCII tab/LF/CR from a URL before
 * resolving it, so `"/\t/evil.com"`, `"/\n/evil.com"`, and `"/\r/evil.com"`
 * all sail past a `startsWith("/")` + "no leading `//` or `/\\`" check —
 * `new URL("/\t/evil.com", "http://localhost")` resolves to
 * `http://evil.com/`, an off-origin URL, even though the raw string looks
 * like an innocuous absolute path. A blocklist would need to keep chasing
 * whatever browsers strip/normalize next.
 *
 * The robust fix is to stop pattern-matching the string and instead
 * resolve it exactly as a browser would (against a fixed dummy origin),
 * then check the RESULT's origin. Same-origin passes; anything else —
 * scheme-relative (`//host`), backslash-relative (`/\host`), control-char
 * tricks, an absolute URL to another host, a host embedded via userinfo —
 * fails the origin check and gets rejected. The origin check is the real
 * gate; the raw-string `startsWith` checks below it are belt-and-suspenders
 * only, not the mechanism doing the actual work.
 */
export function safeNext(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v;

  if (typeof s !== "string" || s.length === 0) return "/";

  const base = "http://localhost";

  let u: URL;
  try {
    u = new URL(s, base);
  } catch {
    return "/";
  }

  if (u.origin !== base) return "/"; // any host/scheme escape → reject

  // Belt-and-suspenders on the raw string, on top of the origin check
  // above (which is what actually blocks the control-char/backslash
  // bypasses — these three conditions are already unreachable for a
  // same-origin `u`, kept only as a second, independent layer).
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) {
    return "/";
  }

  return u.pathname + u.search + u.hash; // normalized, same-origin path
}
