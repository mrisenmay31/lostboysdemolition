import { loadRatesConfig } from "@/lib/rates";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScopeLibraryItem } from "@/lib/estimates/builderLogic";
import { loadPrefillFromOpportunity, type EstimatePrefill } from "@/lib/ghl/prefill";
import { EstimateBuilder } from "../_components/EstimateBuilder";

/**
 * Server shell for the estimate builder. There is no login (Matt's
 * directive) — identity is the header EstimatorChip's self-declared pick,
 * re-validated server-side in actions.ts against the fixed 3-person
 * allowlist; this page itself has no gate to call. Loads the live
 * pricing_variables rate config and the active scope_library rows, then
 * hands both to the client component. Job-type filtering of scope items
 * happens client-side (EstimateBuilder) since jobType is a form field the
 * estimator hasn't chosen yet when this page renders.
 *
 * GHL-FIRST ENTRY (Phase 1, v2 Task 2 lane 2d): `?ghlOpportunityId=<id>`
 * loads that opportunity + its contact via loadPrefillFromOpportunity and
 * hands the result to EstimateBuilder as `ghlPrefill` — the estimator
 * lands on a pre-filled form, and saving auto-links the new estimate
 * family to that GHL identity (see actions.ts's createEstimateAction). A
 * failed prefill load (bad/deleted opportunity id) does NOT 404 the whole
 * page — it degrades to an ordinary blank app-first form, logging the
 * failure server-side, since a malformed query param should never block
 * the estimator from creating an estimate by hand instead.
 *
 * `dynamic = "force-dynamic"`: with no cookies()/auth call left on this
 * route to implicitly force dynamic rendering, Next's static optimizer
 * would otherwise prerender this page ONCE at build time — freezing
 * loadRatesConfig()'s rates and the scope_library list at whatever they
 * were during the last deploy, directly contradicting the documented
 * "pricing_variables is read live, never falls back" contract
 * (web/src/lib/rates.ts). Forcing dynamic rendering keeps both queries
 * running fresh on every request, as intended.
 */
export const dynamic = "force-dynamic";

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ ghlOpportunityId?: string }>;
}) {
  const { ghlOpportunityId } = await searchParams;

  // ⚠️ Fix round F4 (not fixed this round, flagged as an accepted-risk
  // decision for BUILD_LOG): this fetch is an UNGATED read of live GHL
  // opportunity + contact data (name, email, phone, address) — anyone who
  // can reach this URL with a guessed/observed `ghlOpportunityId` gets a
  // pre-filled form with that person's contact details. actions.ts's
  // findContactMatchesAction was closed this round (now `resolveActor`-
  // gated), but this Server Component runs BEFORE any client-side
  // estimator pick exists to check — there is no clean way to gate a
  // page's own render against a value that only lives in localStorage on
  // the client. This sits on top of the SAME already-documented
  // network-layer-open posture as the rest of the no-login estimate tool
  // (CLAUDE.md "No-login estimate tool": "the deployment ships
  // network-layer OPEN... revisit before this tool handles anything more
  // sensitive than internal estimate drafts") — not a new exposure this
  // round introduced, but one this round's audit surfaced and did not
  // close.
  let ghlPrefill: EstimatePrefill | null = null;
  if (ghlOpportunityId) {
    try {
      ghlPrefill = await loadPrefillFromOpportunity(ghlOpportunityId);
    } catch (err) {
      console.error(`NewEstimatePage: loadPrefillFromOpportunity(${ghlOpportunityId}) failed:`, err);
    }
  }

  const ratesConfig = await loadRatesConfig();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scope_library")
    .select(
      "id, name, default_description, default_labor_hours, default_dump_count, default_materials_cost, job_type_applicability",
    )
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`NewEstimatePage: scope_library query failed: ${error.message}`);
  }

  const scopeItems: ScopeLibraryItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    defaultDescription: row.default_description as string,
    defaultLaborHours: Number(row.default_labor_hours),
    defaultDumpCount: Number(row.default_dump_count),
    defaultMaterialsCost:
      row.default_materials_cost === null ? null : Number(row.default_materials_cost),
    jobTypeApplicability: (row.job_type_applicability as string[] | null) ?? [],
  }));

  return <EstimateBuilder ratesConfig={ratesConfig} scopeItems={scopeItems} ghlPrefill={ghlPrefill} />;
}
