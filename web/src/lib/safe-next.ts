/**
 * Sanitizes a `?next=` redirect target so it can never leave this origin.
 *
 * History of this function (two prior bypasses, both closed here):
 *
 * 1. A character blocklist on the raw input (`startsWith("/")`, reject `//`
 *    and `/\`) is whack-a-mole: WHATWG URL parsing (what a browser actually
 *    uses to resolve a redirect `Location` header) strips ASCII tab/LF/CR
 *    before resolving, so `"/\t/evil.com"` etc. pass a raw-string blocklist
 *    while still resolving off-origin. Fixed by resolving the INPUT against
 *    a fixed dummy origin and checking `u.origin === base` instead of
 *    pattern-matching the string.
 *
 * 2. The origin check above validates the INPUT, but this function returns
 *    a NORMALIZED value (`u.pathname + u.search + u.hash`), and that
 *    normalization can itself produce a protocol-relative path even though
 *    the input passed the origin check. `"/..//evil.com"` resolves same-
 *    origin (`new URL("/..//evil.com", base).origin === base`) because
 *    `..` only removes one path segment — but the resulting `pathname` is
 *    `"//evil.com"`, and `redirect()` handing THAT to the browser as a
 *    `Location` header is itself protocol-relative → `http://evil.com`.
 *    `"/.//evil.com"`, `"/a/..//evil.com"`, `"/%2e%2e//evil.com"`, and
 *    `"/foo/..//bar"` all normalize to a `//`-leading pathname the same
 *    way. The fix is to re-gate the OUTPUT, not just the input: check the
 *    normalized path for a `//` / `/\` prefix, AND re-resolve that path
 *    through `new URL` a second time and check its origin too. Belt and
 *    suspenders, both on the value that's actually returned.
 */
export function safeNext(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v;

  if (typeof s !== "string" || s.length === 0) return "/";

  const base = "http://localhost";

  try {
    const u = new URL(s, base);
    if (u.origin !== base) return "/"; // input-time gate

    const path = u.pathname + u.search + u.hash; // the value we'd actually return

    // Output-time gate #1: a normalized path beginning with // or /\ is
    // protocol-relative when a browser re-resolves it from a Location
    // header, regardless of how same-origin the INPUT looked.
    if (path.startsWith("//") || path.startsWith("/\\")) return "/";

    // Output-time gate #2 (the real proof): re-resolve the path itself and
    // confirm it's still same-origin. This is what actually catches the
    // normalized-`//`-prefix bypass class — gate #1 is redundant with this
    // for every case found so far, but kept as an independent, cheaper
    // first check.
    if (new URL(path, base).origin !== base) return "/";

    if (!path.startsWith("/")) return "/";

    return path;
  } catch {
    return "/";
  }
}
