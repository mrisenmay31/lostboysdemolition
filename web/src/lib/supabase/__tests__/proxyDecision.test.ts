import { describe, expect, it } from "vitest";
import { decideProxyAction, safeNextPath } from "../proxyDecision";

describe("decideProxyAction", () => {
  it("redirects unauthenticated /jobs and /jobs/* to sign-in with next", () => {
    expect(decideProxyAction("/jobs", false)).toEqual({ kind: "redirect_sign_in", next: "/jobs" });
    expect(decideProxyAction("/jobs/JOB-1108/costs", false)).toEqual({
      kind: "redirect_sign_in",
      next: "/jobs/JOB-1108/costs",
    });
  });
  it("passes authenticated /jobs through", () => {
    expect(decideProxyAction("/jobs", true)).toEqual({ kind: "next" });
  });
  it("passes / and /estimates and /auth through regardless of session", () => {
    expect(decideProxyAction("/", false)).toEqual({ kind: "next" });
    expect(decideProxyAction("/estimates", false)).toEqual({ kind: "next" });
    expect(decideProxyAction("/auth/sign-in", false)).toEqual({ kind: "next" });
  });
  it("does not treat /jobsish prefixes as gated", () => {
    expect(decideProxyAction("/jobsite", false)).toEqual({ kind: "next" });
  });
});

describe("safeNextPath", () => {
  it("accepts a same-origin path", () => {
    expect(safeNextPath("/jobs/JOB-1108")).toBe("/jobs/JOB-1108");
  });
  it.each([null, "", "https://evil.example", "//evil.example", "jobs", "/\\evil"])(
    "falls back to / for %s",
    (v) => {
      expect(safeNextPath(v)).toBe("/");
    },
  );
});
