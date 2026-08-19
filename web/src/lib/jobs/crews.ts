// ============================================================
// Lost Boys Demolition — web app — crew vocabulary (shared, pure)
// (Phase 1, v2 Task 4 / profitability v2 Phase 1 Session 3, lane 4b,
// fix round 1 — review finding #2, MINOR/trust boundary)
//
// PURE. No "server-only" — this module is imported by BOTH a Server
// module (validate.ts, in turn used by jobs/repo.ts and jobs/actions.ts)
// AND a Client Component (ScheduleEstimateForm.tsx). Splitting the
// constant out here, rather than either duplicating it or importing one
// side from the other, is what keeps both import chains clean:
// crews.ts -> validate.ts (no server-only anywhere in that chain) and
// crews.ts -> ScheduleEstimateForm.tsx (same). Neither direction ever
// crosses jobs/repo.ts or jobs/actions.ts, so nothing pulls
// "server-only" toward the client bundle.
//
// FIX ROUND 1 FINDING (MINOR, trust boundary): the first pass only
// enforced "Crew 1".."Crew 4" as a client-side <select>'s option list —
// validate.ts's Zod schema accepted ANY nonblank string for `crew`. This
// app has no login and ships network-open (CLAUDE.md "No-login estimate
// tool": "the deployment ships network-layer OPEN"), so a crafted
// request bypassing the form entirely could mint a job with
// `crew: "whatever"`, which then silently resolves to no Slack channel
// and no crew calendar downstream (_shared/slack.ts's
// resolveCrewEnvKey/resolveCrewChannelEnvVar only recognize these four
// exact values — everything else is treated as the ordinary
// "Jackson"/"Other" no-crew-calendar case, ordinarily correct, but wrong
// here since nothing legitimately produces an out-of-vocabulary crew
// string). The fix is this module plus validate.ts's `z.enum(CREW_OPTIONS)`
// (see that file) — the closed set is now enforced at the server trust
// boundary, not just presented as a client affordance.
//
// Deliberately ONLY the four operational crews — "Jackson"/"Other" (the
// legacy Airtable-era values `_shared/slack.ts`'s crew map already
// treats as "no crew calendar/channel", by design, for main-calendar-only
// jobs) are NOT added here per the fix-round instruction: whether the app
// scheduler should ever be able to select a crew-less assignment is a
// pending product decision for Matt, out of scope for this fix.
// ============================================================

export const CREW_OPTIONS = ["Crew 1", "Crew 2", "Crew 3", "Crew 4"] as const;

export type Crew = (typeof CREW_OPTIONS)[number];

export function isCrew(value: unknown): value is Crew {
  return typeof value === "string" && (CREW_OPTIONS as readonly string[]).includes(value);
}
