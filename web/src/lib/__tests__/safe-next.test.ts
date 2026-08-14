import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

const SAME_ORIGIN = "http://localhost";

/** The property that actually matters: resolving the returned value against
 * the same fixed base safeNext used internally must land back on that
 * base's origin. A string that merely "looks like" a path (passes
 * startsWith("/")) isn't good enough — this is what both prior bypasses
 * (control chars, then normalized `//`-prefix via `..` traversal)
 * exploited: each produced a `safeNext` return value that read as an
 * innocuous relative path but was NOT actually same-origin once resolved. */
function assertResolvesSameOrigin(returned: string) {
  expect(new URL(returned, SAME_ORIGIN).origin).toBe(SAME_ORIGIN);
}

/**
 * Every input that must be rejected to "/". Kept as ONE list, run through
 * ONE loop asserting the origin property (see the "battery" test at the
 * bottom) — so a future addition to this list can't be forgotten the way
 * the `/..//evil.com` class was omitted from the round-2 corpus even
 * though the round-2 fix's own reasoning ("re-resolve against a fixed
 * base") was already the right idea; the round-2 gap was that the RETURN
 * VALUE was never fed back through that same check.
 */
const HOSTILE_PAYLOADS: unknown[] = [
  // round-1 class: bare protocol-relative / backslash-relative
  "//evil.com",
  "/\\evil.com",
  // round-2 class: control chars WHATWG URL parsing strips before resolving
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r/evil.com",
  // absolute URL / off-origin host tricks
  "https://evil.com",
  "http://localhost.evil.com/x",
  // round-3 class: `..` traversal normalizing to a `//`-prefixed pathname
  // (input passes the origin check; the NORMALIZED OUTPUT is what's
  // protocol-relative)
  "/..//evil.com",
  "/.//evil.com",
  "/a/..//evil.com",
  "/%2e%2e//evil.com",
  "/foo/..//bar",
  "/..\\//evil.com",
  // array edge case
  ["//evil.com"],
];

describe("safeNext", () => {
  describe("safe inputs — must pass through unmodified (regression guard)", () => {
    it("plain same-origin path", () => {
      expect(safeNext("/ok")).toBe("/ok");
    });

    it("preserves query string and hash", () => {
      expect(safeNext("/estimates/1416?tab=x#y")).toBe(
        "/estimates/1416?tab=x#y",
      );
    });

    it("root path", () => {
      expect(safeNext("/")).toBe("/");
    });

    it("simple named route", () => {
      expect(safeNext("/estimates")).toBe("/estimates");
    });

    it("a dot-prefixed segment that merely starts with the literal string 'evil.com' — not traversal, not a host", () => {
      expect(safeNext("/.evil.com")).toBe("/.evil.com");
    });

    it("an @ in the path — not userinfo syntax when there's no host", () => {
      expect(safeNext("/@evil.com")).toBe("/@evil.com");
    });

    it("// appearing inside a QUERY STRING, not at the start of the path", () => {
      expect(safeNext("/redirect?url=//evil.com")).toBe(
        "/redirect?url=//evil.com",
      );
    });

    it("// appearing inside a HASH, not at the start of the path", () => {
      expect(safeNext("/#//evil.com")).toBe("/#//evil.com");
    });

    it("traversal that normalizes to a same-origin, non-// path is safe and passes through normalized", () => {
      // /a/../../evil.com normalizes to /evil.com — a single leading slash,
      // no protocol-relative form, genuinely same-origin. Over-rejecting
      // this would be a false positive, not a fix.
      expect(safeNext("/a/../../evil.com")).toBe("/evil.com");
    });

    it("a leading-slash-less input normalizes under the site root rather than being treated as hostile", () => {
      // "not-a-path" isn't itself a valid `next` value by convention, but
      // it's not an exploit either: WHATWG resolution treats it as a
      // relative path under the base's root, landing on /not-a-path —
      // same-origin either way. This function's job is "never leaves this
      // origin," not "reject anything a caller wouldn't normally send."
      const result = safeNext("not-a-path");
      expect(result).toBe("/not-a-path");
      assertResolvesSameOrigin(result);
    });
  });

  describe("array input", () => {
    it("takes the first element and applies the same rules", () => {
      expect(safeNext(["/a", "/b"])).toBe("/a");
    });

    it("rejects when the first element is hostile, even if later elements are benign", () => {
      const result = safeNext(["//evil.com", "/b"]);
      expect(result).toBe("/");
      assertResolvesSameOrigin(result);
    });
  });

  describe("non-string input", () => {
    it.each([undefined, null, 42, {}])("rejects %p", (input) => {
      expect(safeNext(input)).toBe("/");
    });
  });

  describe("hostile payload battery — every entry must reject to \"/\" AND resolve same-origin", () => {
    // Written as a loop over the full battery (not one assertion per case)
    // so a future addition to HOSTILE_PAYLOADS can't be forgotten — the
    // exact gap that let the `/..//evil.com` class through review round 2.
    for (const payload of HOSTILE_PAYLOADS) {
      it(`rejects ${JSON.stringify(payload)}`, () => {
        const result = safeNext(payload);
        expect(result).toBe("/");
        assertResolvesSameOrigin(result);
      });
    }

    it("every entry in the battery resolves same-origin (consolidated property check)", () => {
      for (const payload of HOSTILE_PAYLOADS) {
        assertResolvesSameOrigin(safeNext(payload));
      }
    });
  });
});
