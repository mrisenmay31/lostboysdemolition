import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthedUser {
  id: string;
  name: string;
}

/**
 * Server-verified auth gate. Calls `supabase.auth.getUser()` — which
 * round-trips to Supabase Auth to validate the session token — rather than
 * `getSession()`, which only decodes the local cookie and can be spoofed.
 * Redirects to /login on any miss (no session, invalid session, network
 * error surfaced by Supabase as a null user).
 *
 * Call this FIRST in every server action and every gated page/layout —
 * see web/src/app/(app)/layout.tsx and the login server actions. Only
 * after requireUser() resolves should an admin client (web/src/lib/supabase/admin.ts)
 * ever be constructed.
 *
 * `name` prefers `user_metadata.display_name` (set manually by Matt when
 * provisioning each of the 3 accounts — see CLAUDE.md Manual Setup #2) and
 * falls back to the email's local part so the nav shell never renders a
 * blank name for an account that hasn't had display_name set yet.
 */
export async function requireUser(): Promise<AuthedUser> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  const displayName =
    typeof user.user_metadata?.display_name === "string" &&
    user.user_metadata.display_name.trim().length > 0
      ? user.user_metadata.display_name
      : (user.email?.split("@")[0] ?? "there");

  return { id: user.id, name: displayName };
}
