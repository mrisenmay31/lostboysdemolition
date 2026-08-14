"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export interface SignInState {
  error?: string;
}

/**
 * Email+password sign-in. Redirects to `next` (defaulting to the app root,
 * which itself redirects to /estimates) on success; returns an error
 * message for the form to render on failure. Uses `redirect()` on the
 * success path so a page refresh never resubmits the form.
 */
export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter both email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: "Incorrect email or password." };
  }

  redirect(next);
}

/**
 * Signs out the current session and returns to /login. Called from the
 * (app) shell's nav — see web/src/app/(app)/layout.tsx.
 *
 * Scope is deliberately the default ("global" — revokes every session for
 * this user, on every device). That's the right call for a 3-user internal
 * tool: nobody expects "sign out" here to mean "sign out of just this
 * device," and there's no multi-device use case this would break.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("signOut: supabase.auth.signOut() failed:", error.message);
  }
  redirect("/login");
}
