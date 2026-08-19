"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { computeEstimate, roundToCent, type EstimateInputs, type LaborMethod } from "@/lib/pricing";
import type { RatesConfig } from "@/lib/rates";
import type {
  ClientType,
  EstimateDraft,
  EstimateRow,
  JobType,
  LineItemDraft,
} from "@/lib/estimates/types";
import {
  assignSortOrders,
  deriveMode,
  parseNonNegativeDecimal,
  sumLineItems,
  type ScopeLibraryItem,
} from "@/lib/estimates/builderLogic";
import { createEstimateAction, newVersionAction } from "../actions";
import type { GhlFirstIdentity } from "../actions";
import type { EstimatePrefill } from "@/lib/ghl/prefill";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import {
  DecimalInputHint,
  Field,
  fieldInputClass,
  fieldTextareaClass,
  readOnlyValueClass,
} from "./Field";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import { PresetChips } from "./PresetChips";
import { ScopePickerSheet } from "./ScopePickerSheet";
import { LineItemCard } from "./LineItemCard";
import { StickyTotalBar } from "./StickyTotalBar";

/**
 * Preloaded values for the revise flow (Task 11b) — one field per piece of
 * builder state that a fresh create doesn't have a starting value for.
 * `lineItems` here are plain drafts (no client-side `key`) — EstimateBuilder
 * assigns each a fresh `crypto.randomUUID()` key in its OWN initial-state
 * initializer (see the `lineItems` useState below), the same way
 * `addLineItem` already does for a line item added interactively. That's
 * what keeps the review's "revise page must mount FRESH LineItemCard
 * components" requirement structurally true: this is a brand-new
 * EstimateBuilder mount (a different route, `[id]/revise/page.tsx`, never
 * the same component instance the parent's OWN detail page rendered), so
 * there is no existing LineItemCard whose raw-text state this could ever
 * desync from — the keys are generated once, at this mount's first render,
 * and LineItemCard's internal raw-text state initializes from `item.*`
 * exactly once per key, same as the create flow.
 */
export interface BuilderInitialValues {
  clientName: string;
  clientType: ClientType | null;
  clientEmail: string;
  clientPhone: string;
  jobName: string;
  jobAddress: string;
  city: string;
  jobType: JobType | null;
  estimateDate: string;
  jobDetails: string;
  laborMethod: LaborMethod;
  totalJobHoursRaw: string;
  daysAtJobRaw: string;
  numEmployeesRaw: string;
  dumpCountRaw: string;
  markupPctRaw: string;
  isPathB: boolean;
  lineItems: LineItemDraft[];
  // Economic-plan category costs (Phase 1, v2 Task 2 lane 2d) — replace the
  // single "Job-specific costs" field. jobSpecificCosts is now DERIVED
  // (materialsCostRaw + rentalsCostRaw + subcontractorsCostRaw +
  // otherDirectCostRaw), never entered directly, so there is no
  // jobSpecificCostsRaw here any more.
  materialsCostRaw: string;
  rentalsCostRaw: string;
  subcontractorsCostRaw: string;
  otherDirectCostRaw: string;
  /** Raw text + whether the estimator has manually edited it away from the
   *  dumpCount * estimatedDumpCostPerLoad auto-suggestion — see the
   *  `expectedDumpCostTouched` state below for why this pairing exists. */
  expectedDumpCostRaw: string;
  expectedDumpCostTouched: boolean;
  /** Same auto-suggest/touched pairing, sourced from the live ccFee
   *  preview instead of dumpCount. */
  expectedProcessingCostRaw: string;
  expectedProcessingCostTouched: boolean;
}

interface EstimateBuilderProps {
  ratesConfig: RatesConfig;
  scopeItems: readonly ScopeLibraryItem[];
  /** "create" (default) posts a version-1 estimate via createEstimateAction.
   *  "revise" posts a new version of `parentId`'s chain via newVersionAction
   *  — see `[id]/revise/page.tsx`, the only caller that sets this. */
  formMode?: "create" | "revise";
  /** Required when formMode === "revise" — the estimate id being revised. */
  parentId?: string;
  /** Preloads every field below from the parent estimate. Only meaningful
   *  (and only ever passed) alongside formMode === "revise". */
  initial?: BuilderInitialValues;
  /** GHL-first entry point (Phase 1, v2 Task 2 lane 2d) —
   *  `/estimates/new?ghlOpportunityId=` (new/page.tsx) loads this via
   *  loadPrefillFromOpportunity and passes it through. Prefills the
   *  contact/job fields below and, on save, tells createEstimateAction to
   *  link the new estimate family to this GHL contact/opportunity. Only
   *  meaningful alongside formMode === "create" (the default) — a revise
   *  reuses the parent's already-linked identity, never this prop. */
  ghlPrefill?: EstimatePrefill | null;
}

/** Line items need a stable React key before they have a DB id — carried
 *  client-side only and stripped before the draft is submitted. */
type LocalLineItem = LineItemDraft & { key: string };

const MARKUP_PRESETS = [20, 25, 30, 35] as const;

const CLIENT_TYPE_OPTIONS: readonly SegmentedOption<ClientType>[] = [
  { value: "Homeowner", label: "Homeowner" },
  { value: "Contractor", label: "Contractor" },
];

const JOB_TYPE_OPTIONS: readonly SegmentedOption<JobType>[] = [
  { value: "Residential", label: "Residential" },
  { value: "Commercial", label: "Commercial" },
];

const LABOR_METHOD_OPTIONS: readonly SegmentedOption<LaborMethod>[] = [
  { value: "total_hours", label: "Total hours" },
  { value: "days_employees", label: "Days × crew" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Turns a GHL-first prefill's contact fields into a single display name
 *  for the "Client name" field — company name wins (matches the pricing
 *  Contractor/Homeowner split's own convention of treating a company as
 *  the client), falling back to "First Last" or whichever half is
 *  present. Empty string (never null) when nothing usable came back —
 *  same "estimator can always type over it" contract as every other
 *  prefilled field here. */
function ghlPrefillClientName(prefill: EstimatePrefill): string {
  if (prefill.companyName) return prefill.companyName;
  return [prefill.firstName, prefill.lastName].filter(Boolean).join(" ").trim();
}

export function EstimateBuilder({
  ratesConfig,
  scopeItems,
  formMode = "create",
  parentId,
  initial,
  ghlPrefill,
}: EstimateBuilderProps) {
  // No login — identity is the header EstimatorChip's self-declared pick,
  // persisted in localStorage and shared across every route via
  // useEstimator()'s cross-component subscription. Save requires a pick
  // (see handleSave); actions.ts independently re-validates the name
  // against the fixed 3-person allowlist server-side regardless.
  const { estimator } = useEstimator();

  // Client — GHL-first prefill (ghlPrefill) only ever applies on a fresh
  // create (formMode === "create", the default); `initial` (revise flow)
  // always wins when both happen to be present, since useState's
  // initializer only reads the first non-undefined default it's given.
  const [clientName, setClientName] = useState(
    initial?.clientName ?? (ghlPrefill ? ghlPrefillClientName(ghlPrefill) : ""),
  );
  const [clientType, setClientType] = useState<ClientType | null>(initial?.clientType ?? null);
  const [clientEmail, setClientEmail] = useState(initial?.clientEmail ?? ghlPrefill?.email ?? "");
  const [clientPhone, setClientPhone] = useState(initial?.clientPhone ?? ghlPrefill?.phone ?? "");

  // Job
  const [jobName, setJobName] = useState(initial?.jobName ?? "");
  const [jobAddress, setJobAddress] = useState(initial?.jobAddress ?? ghlPrefill?.address1 ?? "");
  const [city, setCity] = useState(initial?.city ?? ghlPrefill?.city ?? "");
  const [jobType, setJobType] = useState<JobType | null>(initial?.jobType ?? null);
  const [estimateDate, setEstimateDate] = useState(initial?.estimateDate ?? todayIso);
  const [jobDetails, setJobDetails] = useState(initial?.jobDetails ?? "");

  // Scope line items — see BuilderInitialValues' doc comment above for why
  // assigning a fresh key here (rather than carrying one from the caller)
  // is what makes the revise flow mount brand-new LineItemCard instances.
  const [lineItems, setLineItems] = useState<LocalLineItem[]>(() =>
    (initial?.lineItems ?? []).map((item) => ({ ...item, key: crypto.randomUUID() })),
  );
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  // Labor, Dumps, Costs, Markup — every one of these fields holds RAW TEXT,
  // not a number, and is parsed via parseNonNegativeDecimal below (Task 11
  // review Finding 1: a `type="number"` input blanks `.value` for
  // legal-but-incomplete decimal states like ".25" or "0.", fighting
  // every keystroke of a fractional entry — see that function's doc
  // comment for the full explanation).
  const [laborMethod, setLaborMethod] = useState<LaborMethod>(initial?.laborMethod ?? "total_hours");
  const [totalJobHoursRaw, setTotalJobHoursRaw] = useState(initial?.totalJobHoursRaw ?? "0");
  const [daysAtJobRaw, setDaysAtJobRaw] = useState(initial?.daysAtJobRaw ?? "0");
  const [numEmployeesRaw, setNumEmployeesRaw] = useState(initial?.numEmployeesRaw ?? "0");
  const [dumpCountRaw, setDumpCountRaw] = useState(initial?.dumpCountRaw ?? "0");
  const [markupPctRaw, setMarkupPctRaw] = useState(
    () => initial?.markupPctRaw ?? String(ratesConfig.defaultMarkupPct),
  );

  // Economic-plan category costs (Phase 1, v2 Task 2 lane 2d) — REPLACE the
  // single "Job-specific costs" input. jobSpecificCosts (the one number
  // computeEstimate() still takes) is DERIVED below from these four, never
  // entered directly — see the `jobSpecificCosts` useMemo further down.
  const [materialsCostRaw, setMaterialsCostRaw] = useState(initial?.materialsCostRaw ?? "0");
  const [rentalsCostRaw, setRentalsCostRaw] = useState(initial?.rentalsCostRaw ?? "0");
  const [subcontractorsCostRaw, setSubcontractorsCostRaw] = useState(
    initial?.subcontractorsCostRaw ?? "0",
  );
  const [otherDirectCostRaw, setOtherDirectCostRaw] = useState(initial?.otherDirectCostRaw ?? "0");

  // expectedDumpCost / expectedProcessingCost default to a live-computed
  // suggestion (dumpCount * estimatedDumpCostPerLoad, and the live ccFee
  // preview, respectively) but never overwrite a value the estimator has
  // typed into directly — the `touched` flag flips true on the field's own
  // onChange and never resets, so a later dumpCount/markup edit updates the
  // SUGGESTION silently but leaves an already-touched field alone. Neither
  // is ever folded into jobSpecificCosts (see the six-field doc comment on
  // EstimateDraft in types.ts).
  const [expectedDumpCostRaw, setExpectedDumpCostRaw] = useState(initial?.expectedDumpCostRaw ?? "0");
  const [expectedDumpCostTouched, setExpectedDumpCostTouched] = useState(
    initial?.expectedDumpCostTouched ?? false,
  );
  const [expectedProcessingCostRaw, setExpectedProcessingCostRaw] = useState(
    initial?.expectedProcessingCostRaw ?? "0",
  );
  const [expectedProcessingCostTouched, setExpectedProcessingCostTouched] = useState(
    initial?.expectedProcessingCostTouched ?? false,
  );

  // Path B — "record only, no formal proposal". Persisted: draft.isPathB
  // -> estimates.is_path_b (not null default false). The DB column is
  // IMMUTABLE once saved (trigger-enforced, same guard as every other
  // frozen column) — a wrong pick can't be edited in place, only
  // corrected by a new version — so the checkbox shows a one-line warning
  // when checked (see the Path B section below) rather than treating it
  // as a casually reversible toggle. On revise, preloaded from the
  // parent's current value but stays editable — this is a NEW row, not an
  // edit of the old one, so a corrected Path B pick is a legitimate
  // reason to revise in the first place.
  const [isPathB, setIsPathB] = useState(initial?.isPathB ?? false);

  // Sticky bar / save
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<
    { estimate: EstimateRow; drift: number | null; linkWarning: string | null } | null
  >(null);

  const mode = deriveMode(laborMethod, lineItems.length);
  const lineItemSums = useMemo(() => sumLineItems(lineItems), [lineItems]);

  // Derived numbers from the raw-text fields above.
  const totalJobHoursQuick = parseNonNegativeDecimal(totalJobHoursRaw);
  const daysAtJob = parseNonNegativeDecimal(daysAtJobRaw);
  const numEmployees = parseNonNegativeDecimal(numEmployeesRaw);
  const dumpCountQuick = parseNonNegativeDecimal(dumpCountRaw);
  const markupPct = parseNonNegativeDecimal(markupPctRaw);

  const materialsCost = parseNonNegativeDecimal(materialsCostRaw);
  const rentalsCost = parseNonNegativeDecimal(rentalsCostRaw);
  const subcontractorsCost = parseNonNegativeDecimal(subcontractorsCostRaw);
  const otherDirectCost = parseNonNegativeDecimal(otherDirectCostRaw);
  // expectedDumpCost/expectedProcessingCost are parsed further down, from
  // `displayedExpectedDumpCostRaw`/`displayedExpectedProcessingCostRaw` —
  // those need `outputs` (for the ccFee-derived suggestion), which isn't
  // computed yet at this point in the component body.

  // jobSpecificCosts is DERIVED — the single aggregate computeEstimate()
  // still takes, never entered directly (v2 doc Task 2 Step 4: "Continue
  // passing this legacy aggregate into computeEstimate() so customer quote
  // math remains unchanged"). Deliberately excludes expectedDumpCost/
  // expectedProcessingCost — those are real-cost estimates, not part of
  // the priced quote input.
  const jobSpecificCosts = roundToCent(materialsCost + rentalsCost + subcontractorsCost + otherDirectCost);

  const effectiveTotalJobHours =
    laborMethod === "total_hours"
      ? mode === "itemized"
        ? lineItemSums.laborHours
        : totalJobHoursQuick
      : null;

  const effectiveDumpCount = mode === "itemized" ? lineItemSums.dumpCount : dumpCountQuick;

  const materialsFloor = lineItemSums.materialsCost;
  const materialsCostBelowFloor = mode === "itemized" && materialsCost < materialsFloor;

  const inputs: EstimateInputs = useMemo(() => {
    if (laborMethod === "total_hours") {
      return {
        laborMethod: "total_hours",
        totalJobHours: effectiveTotalJobHours ?? 0,
        dumpCount: effectiveDumpCount,
        jobSpecificCosts,
        markupPct,
      };
    }
    return {
      laborMethod: "days_employees",
      daysAtJob,
      numEmployees,
      dumpCount: effectiveDumpCount,
      jobSpecificCosts,
      markupPct,
    };
  }, [
    laborMethod,
    effectiveTotalJobHours,
    effectiveDumpCount,
    jobSpecificCosts,
    markupPct,
    daysAtJob,
    numEmployees,
  ]);

  // Live preview — recomputed on every keystroke against the server-
  // provided rates. The server action recomputes authoritatively on save;
  // this is a preview only.
  const outputs = useMemo(() => computeEstimate(inputs, ratesConfig.rates), [inputs, ratesConfig.rates]);

  // Auto-suggest expectedDumpCost from dumpCount * estimatedDumpCostPerLoad
  // — but ONLY until the estimator edits the field directly (touched).
  // Deliberately not folded into `inputs`/`outputs` — this suggestion never
  // feeds computeEstimate(). Computed at RENDER TIME (not via a
  // useEffect+setState — that pattern cascades an extra render on every
  // dumpCount keystroke and is the exact anti-pattern React's own
  // react-hooks/set-state-in-effect rule flags): the raw-text state below
  // holds only what the estimator has actually TYPED; the value shown in
  // the input, and the value parsed for submission, both fall back to this
  // live suggestion whenever the field hasn't been touched yet.
  const suggestedExpectedDumpCostRaw = roundToCent(
    effectiveDumpCount * ratesConfig.estimatedDumpCostPerLoad,
  ).toFixed(2);
  const displayedExpectedDumpCostRaw = expectedDumpCostTouched
    ? expectedDumpCostRaw
    : suggestedExpectedDumpCostRaw;

  // Same auto-suggest/touched pairing, sourced from the live ccFee preview
  // — the priced-in CC-fee rate and the actual card-processor rate are
  // currently the same 3.5% (CLAUDE.md Pricing Benchmarks), so the live
  // preview IS the best available estimate of the real processing cost
  // until an estimator overrides it.
  const suggestedExpectedProcessingCostRaw = outputs.ccFee.toFixed(2);
  const displayedExpectedProcessingCostRaw = expectedProcessingCostTouched
    ? expectedProcessingCostRaw
    : suggestedExpectedProcessingCostRaw;

  const expectedDumpCost = parseNonNegativeDecimal(displayedExpectedDumpCostRaw);
  const expectedProcessingCost = parseNonNegativeDecimal(displayedExpectedProcessingCostRaw);

  const filteredScopeItems = useMemo(() => {
    if (!jobType) return scopeItems;
    return scopeItems.filter((item) => item.jobTypeApplicability.includes(jobType));
  }, [scopeItems, jobType]);

  function addLineItem(scopeItem: ScopeLibraryItem) {
    // sortOrder is deliberately NOT set here (see assignSortOrders' doc
    // comment, Task 11 review Finding 3) — it's derived fresh from the
    // final array's order at submit time instead, so removing a middle
    // item and adding a new one can never collide two items on the same
    // sort_order.
    setLineItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        scopeLibraryId: scopeItem.id,
        name: scopeItem.name,
        description: scopeItem.defaultDescription,
        laborHours: scopeItem.defaultLaborHours,
        dumpCount: scopeItem.defaultDumpCount,
        materialsCost: scopeItem.defaultMaterialsCost ?? 0,
      },
    ]);
    setScopePickerOpen(false);
  }

  function updateLineItem(key: string, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeLineItem(key: string) {
    setLineItems((prev) => prev.filter((item) => item.key !== key));
  }

  function handleLaborMethodChange(next: LaborMethod) {
    setLaborMethod(next);
    if (next === "days_employees") {
      // days_employees has no totalJobHours field for line items to
      // reconcile against (validateEstimateDraft only requires it in
      // total_hours mode) -- switching methods clears any in-progress
      // itemization rather than leaving an unreconcilable draft.
      setLineItems([]);
    }
  }

  async function handleSave() {
    setSaveError(null);
    setFieldErrors([]);
    setSaved(null);

    if (!estimator) {
      setSaveError("Pick who's estimating — tap a name up top.");
      return;
    }
    if (!clientName.trim()) {
      setSaveError("Client name is required.");
      return;
    }
    if (!jobName.trim()) {
      setSaveError("Job name is required.");
      return;
    }
    if (materialsCostBelowFloor) {
      setSaveError(
        `Materials cost must be at least $${materialsFloor.toFixed(2)} (the sum of scope item materials).`,
      );
      return;
    }

    const draft: EstimateDraft = {
      jobName: jobName.trim(),
      clientName: clientName.trim(),
      clientType,
      clientEmail: clientEmail.trim() || null,
      clientPhone: clientPhone.trim() || null,
      jobAddress: jobAddress.trim() || null,
      city: city.trim() || null,
      jobType,
      estimateDate,
      jobDetails: jobDetails.trim() || null,
      laborMethod,
      totalJobHours: laborMethod === "total_hours" ? effectiveTotalJobHours : null,
      daysAtJob: laborMethod === "days_employees" ? daysAtJob : null,
      numEmployees: laborMethod === "days_employees" ? numEmployees : null,
      dumpCount: effectiveDumpCount,
      jobSpecificCosts,
      markupPct,
      materialsCost,
      rentalsCost,
      expectedDumpCost,
      subcontractorsCost,
      otherDirectCost,
      expectedProcessingCost,
      isPathB,
      // sort_order is derived fresh from final array order here, not
      // carried from add-time (Task 11 review Finding 3 — see
      // assignSortOrders' doc comment).
      lineItems: assignSortOrders(lineItems.map(({ key: _key, ...rest }) => rest)),
    };

    const ghlIdentity: GhlFirstIdentity | undefined =
      formMode === "create" && ghlPrefill
        ? { ghlContactId: ghlPrefill.ghlContactId, ghlOpportunityId: ghlPrefill.ghlOpportunityId }
        : undefined;

    setSaving(true);
    try {
      const result =
        formMode === "revise" && parentId
          ? await newVersionAction(parentId, draft, estimator)
          : await createEstimateAction(draft, estimator, ghlIdentity);
      if (!result.ok) {
        // On the revise path this also carries the friendly "a newer
        // version already exists" message when repo.ts detects the
        // (estimate_number, version) unique-constraint race (see
        // repo.ts's computeAndCreate + lib/estimates/errors.ts) — no
        // special-casing needed here, it's just another saveError string.
        setSaveError(result.error);
        setFieldErrors(result.fieldErrors ?? []);
        return;
      }
      const previewTotal = outputs.totalBid;
      const savedTotal = result.estimate.total_bid;
      const drift = Math.abs(previewTotal - savedTotal) > 0.01 ? savedTotal - previewTotal : null;
      setSaved({ estimate: result.estimate, drift, linkWarning: result.linkWarning ?? null });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Resets every field back to a blank create-mode form, in place. Used
   * by the "Create another" button on the success screen INSTEAD OF a
   * `<Link href="/estimates/new">` (Task 11 integration-round minor,
   * elevated in Task 11b): after Save, the URL never changed — this
   * component never navigates, it just swaps to the `saved` branch below
   * — so a Link back to the SAME url (`/estimates/new`) is a no-op
   * navigation in the App Router (no route change means no remount), and
   * `saved` would stay populated forever. Resetting state directly makes
   * "Create another" work regardless of Next's same-URL navigation
   * behavior. Not used when formMode is "revise" — reviving a chain a second time
   * needs a fresh parentId, so that screen instead links back to the list.
   */
  function resetForm() {
    setClientName("");
    setClientType(null);
    setClientEmail("");
    setClientPhone("");
    setJobName("");
    setJobAddress("");
    setCity("");
    setJobType(null);
    setEstimateDate(todayIso());
    setJobDetails("");
    setLineItems([]);
    setScopePickerOpen(false);
    setLaborMethod("total_hours");
    setTotalJobHoursRaw("0");
    setDaysAtJobRaw("0");
    setNumEmployeesRaw("0");
    setDumpCountRaw("0");
    setMaterialsCostRaw("0");
    setRentalsCostRaw("0");
    setSubcontractorsCostRaw("0");
    setOtherDirectCostRaw("0");
    setExpectedDumpCostRaw("0");
    setExpectedDumpCostTouched(false);
    setExpectedProcessingCostRaw("0");
    setExpectedProcessingCostTouched(false);
    setMarkupPctRaw(String(ratesConfig.defaultMarkupPct));
    setIsPathB(false);
    setExpanded(false);
    setSaving(false);
    setSaveError(null);
    setFieldErrors([]);
    setSaved(null);
  }

  if (saved) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">
          {formMode === "revise" ? "Estimate revised" : "Estimate saved"}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Estimate #{saved.estimate.estimate_number} v{saved.estimate.version} for{" "}
          {saved.estimate.client_name ?? "—"}.
          {formMode === "revise" ? " The previous version is now superseded." : ""}
        </p>
        <div className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
          <p className="text-2xl font-semibold">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              saved.estimate.total_bid,
            )}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {saved.estimate.true_margin_pct.toFixed(1)}% true margin
          </p>
        </div>
        {saved.drift !== null ? (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Note: the saved total differs from your last on-screen preview by{" "}
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              Math.abs(saved.drift),
            )}
            . The saved value above is authoritative — pricing rates may have changed since the
            page loaded.
          </p>
        ) : null}
        {saved.linkWarning ? (
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-xs font-medium text-red-800 dark:bg-red-950/40 dark:text-red-300">
            {saved.linkWarning}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Link
            href={`/estimates/${saved.estimate.id}`}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            View estimate
          </Link>
          {formMode === "revise" ? (
            <Link
              href="/estimates"
              className="flex h-12 flex-1 items-center justify-center rounded-lg border border-zinc-300 text-sm font-semibold dark:border-zinc-700"
            >
              Back to list
            </Link>
          ) : (
            <button
              type="button"
              onClick={resetForm}
              className="flex h-12 flex-1 items-center justify-center rounded-lg border border-zinc-300 text-sm font-semibold dark:border-zinc-700"
            >
              Create another
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 p-4 pb-8">
        <h1 className="text-xl font-semibold">
          {formMode === "revise" ? "Revise estimate" : "New estimate"}
        </h1>
        {/* Client */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Client
          </h2>
          <Field label="Client name" htmlFor="clientName">
            <input
              id="clientName"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className={fieldInputClass}
              required
            />
          </Field>
          <Field label="Client type" htmlFor="clientType">
            <SegmentedControl
              name="Client type"
              value={clientType}
              onChange={(v) => setClientType(v)}
              options={CLIENT_TYPE_OPTIONS}
            />
          </Field>
          <Field label="Email" htmlFor="clientEmail">
            <input
              id="clientEmail"
              type="email"
              inputMode="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Phone" htmlFor="clientPhone">
            <input
              id="clientPhone"
              type="tel"
              inputMode="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
        </section>

        {/* Job */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Job
          </h2>
          <Field label="Job name" htmlFor="jobName">
            <input
              id="jobName"
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              className={fieldInputClass}
              required
            />
          </Field>
          <Field label="Job address" htmlFor="jobAddress">
            <input
              id="jobAddress"
              type="text"
              value={jobAddress}
              onChange={(e) => setJobAddress(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="City" htmlFor="city">
            <input
              id="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Job type" htmlFor="jobType">
            <SegmentedControl
              name="Job type"
              value={jobType}
              onChange={(v) => setJobType(v)}
              options={JOB_TYPE_OPTIONS}
            />
          </Field>
          <Field label="Estimate date" htmlFor="estimateDate">
            <input
              id="estimateDate"
              type="date"
              value={estimateDate}
              onChange={(e) => setEstimateDate(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Job details" htmlFor="jobDetails">
            <textarea
              id="jobDetails"
              rows={3}
              value={jobDetails}
              onChange={(e) => setJobDetails(e.target.value)}
              className={fieldTextareaClass}
            />
          </Field>
        </section>

        {/* Scope line items — hidden entirely for days_employees */}
        {laborMethod === "total_hours" ? (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Scope
              </h2>
              <button
                type="button"
                onClick={() => setScopePickerOpen(true)}
                className="h-10 rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
              >
                + Add scope
              </button>
            </div>
            {lineItems.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No scope line items yet — quick mode. Enter hours/dumps/costs directly below, or
                add scope items to switch to itemized mode.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {lineItems.map((item) => (
                  <LineItemCard
                    key={item.key}
                    item={item}
                    onChange={(patch) => updateLineItem(item.key, patch)}
                    onRemove={() => removeLineItem(item.key)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {/* Labor */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Labor
          </h2>
          <Field label="Method" htmlFor="laborMethod">
            <SegmentedControl
              name="Labor method"
              value={laborMethod}
              onChange={(v) => handleLaborMethodChange(v)}
              options={LABOR_METHOD_OPTIONS}
            />
          </Field>
          {laborMethod === "total_hours" ? (
            <Field
              label="Total job hours"
              htmlFor="totalJobHours"
              hint={mode === "itemized" ? "Sum of scope item hours below." : undefined}
            >
              {mode === "itemized" ? (
                <div id="totalJobHours" className={readOnlyValueClass}>
                  {lineItemSums.laborHours.toFixed(2)} hrs
                </div>
              ) : (
                <>
                  <input
                    id="totalJobHours"
                    type="text"
                    inputMode="decimal"
                    value={totalJobHoursRaw}
                    onChange={(e) => setTotalJobHoursRaw(e.target.value)}
                    className={fieldInputClass}
                  />
                  <DecimalInputHint raw={totalJobHoursRaw} />
                </>
              )}
            </Field>
          ) : (
            <>
              <Field label="Days at job" htmlFor="daysAtJob">
                <input
                  id="daysAtJob"
                  type="text"
                  inputMode="decimal"
                  value={daysAtJobRaw}
                  onChange={(e) => setDaysAtJobRaw(e.target.value)}
                  className={fieldInputClass}
                />
                <DecimalInputHint raw={daysAtJobRaw} />
              </Field>
              <Field label="Number of employees" htmlFor="numEmployees">
                <input
                  id="numEmployees"
                  type="text"
                  inputMode="numeric"
                  value={numEmployeesRaw}
                  onChange={(e) => setNumEmployeesRaw(e.target.value)}
                  className={fieldInputClass}
                />
                <DecimalInputHint raw={numEmployeesRaw} />
              </Field>
            </>
          )}
        </section>

        {/* Dumps */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Dumps
          </h2>
          <Field
            label="Dump loads"
            htmlFor="dumpCount"
            hint={mode === "itemized" ? "Sum of scope item dump loads below." : "Fractional loads allowed (e.g. 0.25)."}
          >
            {mode === "itemized" ? (
              <div id="dumpCount" className={readOnlyValueClass}>
                {lineItemSums.dumpCount.toFixed(2)}
              </div>
            ) : (
              <>
                <input
                  id="dumpCount"
                  type="text"
                  inputMode="decimal"
                  value={dumpCountRaw}
                  onChange={(e) => setDumpCountRaw(e.target.value)}
                  className={fieldInputClass}
                />
                <DecimalInputHint raw={dumpCountRaw} />
              </>
            )}
          </Field>
        </section>

        {/* Costs — category inputs (Phase 1, v2 Task 2 lane 2d) replace the
            single "Job-specific costs" field. materialsCost/rentalsCost/
            subcontractorsCost/otherDirectCost still sum into the one
            jobSpecificCosts number computeEstimate() takes (shown as a
            read-only total below); expectedDumpCost/expectedProcessingCost
            are REAL-cost planning inputs that never feed the customer
            quote — they only change the planned-profit numbers Dane sees
            on the estimate detail page. */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Costs
          </h2>
          <Field
            label="Materials"
            htmlFor="materialsCost"
            hint={mode === "itemized" ? `Must be at least $${materialsFloor.toFixed(2)} (sum of scope item materials).` : undefined}
            error={materialsCostBelowFloor ? "Below the scope items' materials total." : undefined}
          >
            <input
              id="materialsCost"
              type="text"
              inputMode="decimal"
              value={materialsCostRaw}
              onChange={(e) => setMaterialsCostRaw(e.target.value)}
              className={fieldInputClass}
            />
            <DecimalInputHint raw={materialsCostRaw} />
          </Field>
          <Field label="Rentals" htmlFor="rentalsCost">
            <input
              id="rentalsCost"
              type="text"
              inputMode="decimal"
              value={rentalsCostRaw}
              onChange={(e) => setRentalsCostRaw(e.target.value)}
              className={fieldInputClass}
            />
            <DecimalInputHint raw={rentalsCostRaw} />
          </Field>
          <Field label="Subcontractors" htmlFor="subcontractorsCost">
            <input
              id="subcontractorsCost"
              type="text"
              inputMode="decimal"
              value={subcontractorsCostRaw}
              onChange={(e) => setSubcontractorsCostRaw(e.target.value)}
              className={fieldInputClass}
            />
            <DecimalInputHint raw={subcontractorsCostRaw} />
          </Field>
          <Field label="Other direct costs" htmlFor="otherDirectCost">
            <input
              id="otherDirectCost"
              type="text"
              inputMode="decimal"
              value={otherDirectCostRaw}
              onChange={(e) => setOtherDirectCostRaw(e.target.value)}
              className={fieldInputClass}
            />
            <DecimalInputHint raw={otherDirectCostRaw} />
          </Field>
          <Field label="Job-specific costs (total)" htmlFor="jobSpecificCostsTotal" hint="Materials + rentals + subcontractors + other direct — feeds the quote.">
            <div id="jobSpecificCostsTotal" className={readOnlyValueClass}>
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(jobSpecificCosts)}
            </div>
          </Field>
          <Field
            label="Expected dump cost"
            htmlFor="expectedDumpCost"
            hint="Real expected cost — planning only, never charged to the customer. Suggested from dump loads until edited."
          >
            <input
              id="expectedDumpCost"
              type="text"
              inputMode="decimal"
              value={displayedExpectedDumpCostRaw}
              onChange={(e) => {
                setExpectedDumpCostTouched(true);
                setExpectedDumpCostRaw(e.target.value);
              }}
              className={fieldInputClass}
            />
            <DecimalInputHint raw={displayedExpectedDumpCostRaw} />
          </Field>
          <Field
            label="Expected processing cost"
            htmlFor="expectedProcessingCost"
            hint="Real expected card-processing cost — planning only. Suggested from the live CC-fee preview until edited."
          >
            <input
              id="expectedProcessingCost"
              type="text"
              inputMode="decimal"
              value={displayedExpectedProcessingCostRaw}
              onChange={(e) => {
                setExpectedProcessingCostTouched(true);
                setExpectedProcessingCostRaw(e.target.value);
              }}
              className={fieldInputClass}
            />
            <DecimalInputHint raw={displayedExpectedProcessingCostRaw} />
          </Field>
        </section>

        {/* Markup */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Markup
          </h2>
          <Field label="Markup %" htmlFor="markupPct">
            <PresetChips
              inputId="markupPct"
              rawValue={markupPctRaw}
              onRawChange={setMarkupPctRaw}
              presets={MARKUP_PRESETS}
            />
          </Field>
        </section>

        {/* Path B */}
        <section className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={isPathB}
              onChange={(e) => setIsPathB(e.target.checked)}
              className="h-5 w-5 rounded border-zinc-300 dark:border-zinc-700"
            />
            Record only — no proposal will be sent
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            For trusted-contractor jobs invoiced at completion. This estimate still becomes the
            job&apos;s variance baseline.
          </p>
          {isPathB ? (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              Record-only — no proposal doc will be pushed. Can&apos;t be changed after save (a
              correction needs a new version).
            </p>
          ) : null}
        </section>

        {fieldErrors.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {fieldErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <StickyTotalBar
        outputs={outputs}
        markupPct={markupPct}
        markupFloorPct={ratesConfig.markupFloorPct}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onSave={handleSave}
        saving={saving}
        saveError={saveError}
      />

      <ScopePickerSheet
        open={scopePickerOpen}
        onClose={() => setScopePickerOpen(false)}
        items={filteredScopeItems}
        onSelect={addLineItem}
      />
    </div>
  );
}
