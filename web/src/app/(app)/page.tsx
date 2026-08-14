import { redirect } from "next/navigation";

/**
 * `/` has no content of its own — it's just the auth-gated entry point.
 * Estimates pages are a later task's scope, so this 404s for now (there
 * is no src/app/(app)/estimates route yet); the redirect itself, and the
 * fact that it only fires for an authenticated request, is what this
 * task verifies.
 */
export default function RootPage() {
  redirect("/estimates");
}
