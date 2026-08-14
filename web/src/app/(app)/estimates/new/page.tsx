import { loadRatesConfig } from "@/lib/rates";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScopeLibraryItem } from "@/lib/estimates/builderLogic";
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

export default async function NewEstimatePage() {
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

  return <EstimateBuilder ratesConfig={ratesConfig} scopeItems={scopeItems} />;
}
