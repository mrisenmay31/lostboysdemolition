import { redirect } from "next/navigation";
import { getWorkforceSession, isActiveOwner } from "@/lib/workforce/profile";

/**
 * `/` has no content of its own. v2 Task 8a flipped the home surface per
 * the 2026-08-25 BUILD_PLAN amendment: an authenticated ACTIVE OWNER
 * lands on the Job Dashboard; everyone else — anonymous visitors,
 * pending profiles, foremen — continues to the estimate list exactly as
 * before. The no-login estimator picker flow stays reachable with zero
 * behavior change for anyone without an owner session.
 */
export default async function RootPage() {
  const session = await getWorkforceSession();
  if (session.status === "authenticated" && isActiveOwner(session.profile)) {
    redirect("/jobs");
  }
  redirect("/estimates");
}
