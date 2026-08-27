// PURE — no I/O, no next/server import. Tested directly; web/src/proxy.ts
// is a thin shell around this so the gating logic itself is unit-testable.

export type ProxyDecision = { kind: "next" } | { kind: "redirect_sign_in"; next: string };

export function decideProxyAction(pathname: string, hasUser: boolean): ProxyDecision {
  const isJobsRoute = pathname === "/jobs" || pathname.startsWith("/jobs/");
  if (isJobsRoute && !hasUser) {
    return { kind: "redirect_sign_in", next: pathname };
  }
  return { kind: "next" };
}

/** Open-redirect guard for ?next= — only same-origin absolute paths
 *  survive; anything else falls back to "/". Rejects protocol-relative
 *  ("//host") and backslash tricks. */
export function safeNextPath(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}
