import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

export type WorkforceRole = "pending" | "owner" | "foreman";

export interface WorkforceProfile {
  authUserId: string;
  displayName: string;
  role: WorkforceRole;
  active: boolean;
}

export type WorkforceSession =
  | { status: "unauthenticated" }
  | { status: "no_profile"; authUserId: string }
  | { status: "authenticated"; profile: WorkforceProfile };

const ROLES: readonly WorkforceRole[] = ["pending", "owner", "foreman"];

/** Pure, defensive row normalizer (house pattern: every wire row is
 *  normalized before use — see map.ts). Returns null rather than
 *  guessing when any field is off-contract. */
export function normalizeWorkforceProfileRow(raw: Record<string, unknown>): WorkforceProfile | null {
  const authUserId = typeof raw.auth_user_id === "string" && raw.auth_user_id !== "" ? raw.auth_user_id : null;
  const displayName =
    typeof raw.display_name === "string" && raw.display_name.trim() !== "" ? raw.display_name.trim() : null;
  const role = typeof raw.role === "string" && (ROLES as readonly string[]).includes(raw.role)
    ? (raw.role as WorkforceRole)
    : null;
  const active = typeof raw.active === "boolean" ? raw.active : null;
  if (authUserId === null || displayName === null || role === null || active === null) return null;
  return { authUserId, displayName, role, active };
}

export function isActiveOwner(profile: WorkforceProfile | null): boolean {
  return profile !== null && profile.role === "owner" && profile.active === true;
}

/** Resolves the current cookie session to a workforce profile. RLS
 *  (`workforce_self_read`) guarantees the query can only ever see the
 *  caller's own row, so `.eq()` here is belt-and-braces, not the
 *  security boundary. */
export async function getWorkforceSession(): Promise<WorkforceSession> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };
  const { data, error } = await supabase
    .from("workforce_profiles")
    .select("auth_user_id, display_name, role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error || !data) return { status: "no_profile", authUserId: user.id };
  const profile = normalizeWorkforceProfileRow(data);
  return profile ? { status: "authenticated", profile } : { status: "no_profile", authUserId: user.id };
}

export class OwnerAuthError extends Error {
  code: "unauthenticated" | "not_owner";
  constructor(code: "unauthenticated" | "not_owner") {
    super(code === "unauthenticated" ? "Not signed in." : "Signed in, but not an active owner.");
    this.name = "OwnerAuthError";
    this.code = code;
  }
}

/** Server-action gate: returns the active owner profile or throws
 *  OwnerAuthError. Actions ARE the trust boundary in front of the
 *  service-role client (same doctrine as jobs/actions.ts's module doc). */
export async function requireActiveOwner(): Promise<WorkforceProfile> {
  const session = await getWorkforceSession();
  if (session.status === "unauthenticated") throw new OwnerAuthError("unauthenticated");
  if (session.status !== "authenticated" || !isActiveOwner(session.profile)) {
    throw new OwnerAuthError("not_owner");
  }
  return session.profile;
}
