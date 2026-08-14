import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

const SAME_ORIGIN = "http://localhost";

/** The property that actually matters: resolving the returned value against
 * the same fixed base safeNext used internally must land back on that base's
 * origin. A string that merely "looks like" a path (passes startsWith("/"))
 * isn't good enough — this is what the tab/LF/CR bypass exploited. */
function assertResolvesSameOrigin(returned: string) {
  expect(new URL(returned, SAME_ORIGIN).origin).toBe(SAME_ORIGIN);
}

describe("safeNext", () => {
  it("passes through a plain same-origin path", () => {
    expect(safeNext("/ok")).toBe("/ok");
  });

  it("preserves query string and hash on a legit path", () => {
    expect(safeNext("/estimates/1416?tab=x#y")).toBe("/estimates/1416?tab=x#y");
  });

  it("rejects a network-path reference (//evil.com)", () => {
    const result = safeNext("//evil.com");
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  it("rejects a backslash network-path reference (/\\evil.com)", () => {
    const result = safeNext("/\\evil.com");
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  // Control-char bypass (the finding this round of hardening closes):
  // WHATWG URL parsing strips ASCII tab/LF/CR before resolving, so
  // "/\t/evil.com" resolves to http://evil.com/ even though the raw string
  // passes a bare startsWith("/") check. new URL(...).origin is what
  // actually catches this — see safe-next.ts's doc comment.
  it("rejects a literal-tab bypass (/\\t/evil.com)", () => {
    const result = safeNext("/\t/evil.com");
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  it("rejects a literal-newline bypass (/\\n/evil.com)", () => {
    const result = safeNext("/\n/evil.com");
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  it("rejects a literal-carriage-return bypass (/\\r/evil.com)", () => {
    const result = safeNext("/\r/evil.com");
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  it("takes the first element when given an array and applies the same rules", () => {
    expect(safeNext(["/a", "/b"])).toBe("/a");
    const result = safeNext(["//evil.com", "/b"]);
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  it("rejects non-string input", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(42)).toBe("/");
    expect(safeNext({})).toBe("/");
  });

  it("rejects an absolute URL", () => {
    const result = safeNext("https://evil.com");
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  it("rejects a host embedded via userinfo/subdomain tricks", () => {
    // "http://localhost.evil.com" is NOT same-origin as "http://localhost" —
    // a naive prefix check (`origin.startsWith(base)`) would wrongly accept
    // this; the exact `!==` comparison in safeNext does not.
    const result = safeNext("http://localhost.evil.com/x");
    expect(result).toBe("/");
    assertResolvesSameOrigin(result);
  });

  it("every hostile payload resolves same-origin after sanitization", () => {
    const hostilePayloads = [
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "https://evil.com",
      "http://localhost.evil.com/x",
      ["//evil.com"],
      "not-a-path",
    ];

    for (const payload of hostilePayloads) {
      assertResolvesSameOrigin(safeNext(payload));
    }
  });
});
