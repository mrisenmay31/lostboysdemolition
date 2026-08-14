import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("passes through a plain same-origin path", () => {
    expect(safeNext("/ok")).toBe("/ok");
  });

  it("rejects a network-path reference (//evil.com)", () => {
    expect(safeNext("//evil.com")).toBe("/");
  });

  it("rejects a backslash network-path reference (/\\evil.com)", () => {
    expect(safeNext("/\\evil.com")).toBe("/");
  });

  it("takes the first element when given an array and applies the same rules", () => {
    expect(safeNext(["/a", "/b"])).toBe("/a");
    expect(safeNext(["//evil.com", "/b"])).toBe("/");
  });

  it("rejects non-string input", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(42)).toBe("/");
    expect(safeNext({})).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe("/");
  });
});
