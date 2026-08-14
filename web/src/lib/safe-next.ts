/**
 * Sanitizes a `?next=` redirect target so it can never leave this origin.
 *
 * `s.startsWith("/")` alone is not enough: `//evil.com` is a network-path
 * reference (browsers/most URL parsers treat a leading `//` as
 * protocol-relative — same as `https://evil.com`), and `/\evil.com` is
 * treated the same way by several URL parsers (backslash normalizes to
 * forward slash). Both pass a bare `startsWith("/")` check and both are
 * open redirects. Reject any value that isn't a single-slash, same-origin
 * path.
 *
 * Also normalizes `searchParams.get("next")` returning an array (e.g.
 * `?next=/a&next=/b` on some parsers, or any caller passing
 * `URLSearchParams.getAll()` output by mistake) by taking the first
 * element and applying the same rules to it, rather than letting a
 * non-string reach `.startsWith` and throw.
 */
export function safeNext(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v;

  if (typeof s !== "string") return "/";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) {
    return "/";
  }

  return s;
}
