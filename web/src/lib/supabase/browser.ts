"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Anon-key browser client — used ONLY by the sign-in page (signInWithOtp,
 *  getUser, signOut). Never used for data reads; all data access stays in
 *  server code. */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "createBrowserSupabaseClient: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.",
    );
  }
  return createBrowserClient(url, anonKey);
}
