import { redirect } from "next/navigation";

/**
 * `/` has no content of its own — it's the internal tool's landing route,
 * and it exists only to send everyone straight to the estimate list at
 * `/estimates` (src/app/(app)/estimates/page.tsx). There is no login gate
 * here: identity is a picker (see EstimatorChip.tsx) validated against the
 * Dane/Jackson/Matt allowlist inside the server actions, not a session
 * check on this route.
 */
export default function RootPage() {
  redirect("/estimates");
}
