"use server";

import { revalidatePath } from "next/cache";
import { isEstimatorName } from "@/lib/estimator";
import {
  EstimateValidationError,
  createEstimate,
  createNewVersion,
  updateQuote,
  updateStatus,
} from "@/lib/estimates/repo";
import type { EstimateActor, EstimateRow, EstimateStatus } from "@/lib/estimates/types";

/**
 * Server actions for the estimates data layer. Every action here is a
 * standalone entry point a client component can call directly (not bound
 * to a `<form action={...}>` — the estimate draft is a rich nested object
 * with a dynamic line-item array, so it travels as a plain serializable JS
 * argument the way Next.js server actions support when invoked
 * programmatically, rather than via FormData). Task 11's builder and Task
 * 11b's list/detail pages are the intended callers.
 *
 * IDENTITY (Matt's directive, replacing the Task 6 login gate): there is no
 * login. Who's estimating is a client-side picker (see @/lib/estimator and
 * EstimatorChip.tsx), persisted in localStorage, and passed in as a plain
 * `estimatorName` string on every mutating call below. Each action
 * re-validates that string against the 3-name allowlist itself, via
 * `resolveActor` — these actions ARE the trust boundary in front of the
 * service-role client, since anything past this point writes with an
 * admin connection that bypasses RLS. A name that isn't on the allowlist
 * never reaches repo.ts.
 *
 * Zod validation happens at repo.ts's createEstimate/createNewVersion
 * (validateEstimateDraft parses `unknown` input) — that IS the
 * zod-at-the-trust-boundary check, since these actions are the client's
 * only entry point into repo.ts. updateStatusAction/updateQuoteAction
 * validate their own (much narrower) inputs directly below.
 *
 * None of these actions call `redirect()` — the created/updated row is
 * returned to the caller, which owns navigation (e.g. router.push to the
 * new estimate's detail page after a successful create). Each mutating
 * action does call `revalidatePath` for the pages whose cached data it
 * just invalidated.
 */

export type ActionResult =
  | { ok: true; estimate: EstimateRow }
  | { ok: false; error: string; fieldErrors?: string[] };

function toActionResult(err: unknown): ActionResult {
  if (err instanceof EstimateValidationError) {
    return { ok: false, error: err.message, fieldErrors: err.errors };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message };
}

/** Allowlist-checks the picker-declared name and shapes it into the
 *  `EstimateActor` the data layer expects. `id` is always null — there is
 *  no auth.users row backing a picker name. Returns null (not a thrown
 *  error) so callers can surface a friendly, uniform message instead of
 *  routing an invalid name through toActionResult's generic Error path. */
function resolveActor(estimatorName: string): EstimateActor | null {
  return isEstimatorName(estimatorName)
    ? { id: null, name: estimatorName }
    : null;
}

/** Creates a version-1 estimate from a draft object. */
export async function createEstimateAction(
  draft: unknown,
  estimatorName: string,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  try {
    const estimate = await createEstimate(draft, actor);
    revalidatePath("/estimates");
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

/** Creates a new version of an existing estimate chain (the "revise" flow — Task 11b). */
export async function newVersionAction(
  parentId: string,
  draft: unknown,
  estimatorName: string,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  try {
    const estimate = await createNewVersion(parentId, draft, actor);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${parentId}`);
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

const ESTIMATE_STATUSES: readonly EstimateStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "superseded",
  "historical",
];

/** Flips an estimate's status (Sent/Accepted/Declined buttons on the detail page). */
export async function updateStatusAction(
  id: string,
  status: string,
  estimatorName: string,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };

  if (!ESTIMATE_STATUSES.includes(status as EstimateStatus)) {
    return { ok: false, error: `invalid status: ${status}` };
  }

  try {
    const estimate = await updateStatus(id, status as EstimateStatus, actor);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${id}`);
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

/**
 * Sets (or clears, with quotedPrice=null) an estimate's quoted_price. The
 * UI enforces the override-reason rule before calling this (via
 * validateQuoteOverride against the estimate's known total_bid); repo.ts's
 * updateQuote re-checks it against the live DB row regardless, and the RPC
 * itself is the final backstop.
 */
export async function updateQuoteAction(
  id: string,
  quotedPrice: number | null,
  reason: string | null,
  estimatorName: string,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  try {
    const estimate = await updateQuote(id, quotedPrice, reason, actor);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${id}`);
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}
