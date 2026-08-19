import { notFound } from "next/navigation";
import { loadRatesConfig } from "@/lib/rates";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEstimate } from "@/lib/estimates/repo";
import { resolveReviseCostDefaults, type ScopeLibraryItem } from "@/lib/estimates/builderLogic";
import {
  EstimateBuilder,
  type BuilderInitialValues,
} from "../../_components/EstimateBuilder";

/**
 * Server shell for the "revise" flow (Task 11b): loads the parent
 * estimate's full detail (header + line items), the live rate config, and
 * the active scope_library rows, then hands all three to EstimateBuilder
 * in "revise" mode. EstimateBuilder itself owns turning `initial` into
 * freshly-keyed local state and calling newVersionAction(parentId, ...)
 * on save — see its module doc comment for why that structurally avoids
 * the "stale LineItemCard" desync risk this route's design has to answer.
 *
 * `dynamic = "force-dynamic"`: same reasoning as `new/page.tsx` — this
 * route reads live rates and a live parent estimate on every request;
 * without an explicit force, Next's static optimizer could otherwise
 * prerender it once and freeze both.
 */
export const dynamic = "force-dynamic";

export default async function ReviseEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail;
  try {
    detail = await getEstimate(id);
  } catch {
    notFound();
  }
  const { estimate, lineItems, financialDetails } = detail;

  // Deliberately NO status-based notFound() guard here (Task 11b live
  // smoke finding — see task report). Server Actions that call
  // revalidatePath (every action in actions.ts does, on success)
  // automatically refresh the CURRENT route's Server Component tree —
  // and since a successful revise flips THIS SAME parent to 'superseded'
  // as part of the very save being submitted, a status guard here would
  // fire on that automatic post-save refresh and 404 the page out from
  // under the client component's own "Estimate revised" success screen,
  // on every single successful revise, not just a stale-bookmark replay.
  // The scenario this guard would have caught — landing on a revise URL
  // for a row someone else already revised in the meantime — is instead
  // caught at SAVE time: repo.ts's createNewVersion hits the DB's
  // (estimate_number, version) unique constraint and surfaces the same
  // friendly "a newer version already exists" message (lib/estimates/
  // errors.ts) that a genuine concurrent-revise race produces. One
  // failure mode, one place it's handled, and it doesn't break the happy
  // path to do it.

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
    throw new Error(`ReviseEstimatePage: scope_library query failed: ${error.message}`);
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

  const initial: BuilderInitialValues = {
    clientName: estimate.client_name ?? "",
    clientType: estimate.client_type,
    clientEmail: estimate.client_email ?? "",
    clientPhone: estimate.client_phone ?? "",
    jobName: estimate.job_name ?? "",
    jobAddress: estimate.job_address ?? "",
    city: estimate.city ?? "",
    jobType: estimate.job_type,
    estimateDate: estimate.estimate_date,
    jobDetails: estimate.job_details ?? "",
    laborMethod: estimate.labor_method,
    totalJobHoursRaw: estimate.total_job_hours !== null ? String(estimate.total_job_hours) : "0",
    daysAtJobRaw: estimate.days_at_job !== null ? String(estimate.days_at_job) : "0",
    numEmployeesRaw: estimate.num_employees !== null ? String(estimate.num_employees) : "0",
    dumpCountRaw: String(estimate.dump_count),
    markupPctRaw: String(estimate.markup_pct),
    isPathB: estimate.is_path_b,
    // Economic-plan category costs (Phase 1, v2 Task 2 lane 2d) — preloaded
    // from the PARENT version's financial_details row when one exists.
    // Fix round F5: financialDetails is null only for a pre-Task-2 LEGACY
    // row (created via the v1 create_estimate_with_items RPC, which never
    // wrote this table) — for those, resolveReviseCostDefaults folds the
    // parent's whole `job_specific_costs` aggregate into otherDirectCostRaw
    // (materials/rentals/subcontractors at "0") rather than zeroing all
    // four, which would have silently discounted the legacy job's real
    // cost the moment the builder recomputes jobSpecificCosts as the sum
    // of these four fields. See builderLogic.ts's doc comment for the
    // full reasoning.
    ...resolveReviseCostDefaults(estimate.job_specific_costs, financialDetails),
    // Preloaded from the parent AND marked "touched" — a revise should
    // never silently overwrite a previously-entered expected cost with a
    // fresh dumpCount/ccFee-derived suggestion just because dumpCount
    // happens to change during the revise.
    expectedDumpCostRaw: String(financialDetails?.expected_dump_cost ?? 0),
    expectedDumpCostTouched: true,
    expectedProcessingCostRaw: String(financialDetails?.expected_processing_cost ?? 0),
    expectedProcessingCostTouched: true,
    lineItems: lineItems.map((li) => ({
      scopeLibraryId: li.scope_library_id,
      name: li.name,
      description: li.description,
      laborHours: li.labor_hours,
      dumpCount: li.dump_count,
      materialsCost: li.materials_cost,
    })),
  };

  return (
    <>
      {estimate.status === "superseded" ? (
        // Deferred minor #7 (Task 11b review, fix round 1): the detail
        // page never LINKS Revise for a superseded row, but this route
        // itself has no hard guard against a stale bookmark/back-button
        // landing here directly (see the comment above for why removing
        // that guard was necessary). One-line heads-up rather than a
        // block — saving still works (or surfaces the friendly
        // unique-violation message if someone else already revised it).
        <p className="mx-auto w-full max-w-lg bg-amber-100 px-4 py-2 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          This is an older version — you&apos;re revising v{estimate.version}, not the latest.
        </p>
      ) : null}
      <EstimateBuilder
        ratesConfig={ratesConfig}
        scopeItems={scopeItems}
        formMode="revise"
        parentId={estimate.id}
        initial={initial}
      />
    </>
  );
}
