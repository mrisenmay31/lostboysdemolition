import { loadRatesConfig } from "@/lib/rates";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScopeLibraryItem } from "@/lib/estimates/builderLogic";
import { EstimateBuilder } from "../_components/EstimateBuilder";

/**
 * Server shell for the estimate builder. Deliberately does NOT call
 * requireUser() itself (per an explicit mid-session directive, pending a
 * separate approved plan for how estimator attribution works without a
 * login gate) — the (app) layout's own requireUser() call, and the
 * existing requireUser() call inside estimates/actions.ts, are both left
 * untouched and still gate this route today. Loads the live
 * pricing_variables rate config and the active scope_library rows, then
 * hands both to the client component. Job-type filtering of scope items
 * happens client-side (EstimateBuilder) since jobType is a form field the
 * estimator hasn't chosen yet when this page renders.
 */
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
