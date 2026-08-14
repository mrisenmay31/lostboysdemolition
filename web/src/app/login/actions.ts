"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  const next = String(formData.get("next") ?? "/");

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

  redirect(next.startsWith("/") ? next : "/");
}

/**
 * Signs out the current session and returns to /login. Called from the
 * (app) shell's nav — see web/src/app/(app)/layout.tsx.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
