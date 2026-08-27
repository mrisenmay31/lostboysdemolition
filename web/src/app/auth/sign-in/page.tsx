"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * Email magic-link sign-in for owners (and, in Task 8b, foremen).
 *
 * `shouldCreateUser: false` is DELIBERATE and load-bearing: the app is
 * network-open, and without it any stranger could mint auth.users rows
 * (and workforce_profiles rows via the on_auth_user_created trigger) by
 * typing an email. New people are invited from the Supabase dashboard
 * first (docs/runbooks/owner-promotion.md), then sign in here.
 */
function SignInForm() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";
  const confirmError = searchParams.get("error") === "confirm";

  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setSignedInAs(user?.email ?? null);
    });
  }, []);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrorMessage(null);
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(nextPath)}`,
      },
    });
    if (error) {
      setState("error");
      setErrorMessage(error.message);
    } else {
      setState("sent");
    }
  }

  async function signOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    setSignedInAs(null);
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {confirmError ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          That sign-in link is invalid or expired. Request a new one below.
        </p>
      ) : null}
      {signedInAs ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as {signedInAs}.{" "}
          <button type="button" onClick={signOut} className="underline">
            Sign out
          </button>
        </p>
      ) : null}
      {state === "sent" ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Check your email — a sign-in link is on its way to {email.trim()}.
        </p>
      ) : (
        <form onSubmit={sendLink} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              className="rounded-md border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button
            type="submit"
            disabled={state === "sending"}
            className="rounded-md bg-zinc-900 px-3 py-2 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
          {state === "error" && errorMessage ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              {errorMessage.includes("Signups not allowed") || errorMessage.toLowerCase().includes("signup")
                ? "This email isn't set up for sign-in. Ask Matt to invite you first."
                : errorMessage}
            </p>
          ) : null}
        </form>
      )}
      <p className="text-sm text-zinc-500">
        Estimating doesn&apos;t need an account —{" "}
        <Link href="/estimates" className="underline">
          go to Estimates
        </Link>
        .
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
