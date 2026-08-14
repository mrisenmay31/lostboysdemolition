"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  EstimateValidationError,
  createEstimate,
  createNewVersion,
  updateQuote,
  updateStatus,
} from "@/lib/estimates/repo";
import type { EstimateRow, EstimateStatus } from "@/lib/estimates/types";

/**
 * Server actions for the estimates data layer. Every action here is a
 * standalone entry point a client component can call directly (not bound
 * to a `<form action={...}>` — the estimate draft is a rich nested object
 * with a dynamic line-item array, so it travels as a plain serializable JS
 * argument the way Next.js server actions support when invoked
 * programmatically, rather than via FormData). Task 11's builder and Task
 * 11b's list/detail pages are the intended callers.
 *
 * HARD RULE (from the Task 6 review): every server action under (app)
 * calls requireUser() ITSELF. The (app) layout's requireUser() call is
 * display-only (it renders the signed-in user's name in the header) — it
 * runs concurrently with page/children rendering in Next.js, so it is NOT
 * a gate any action can rely on. Each action below re-verifies the session
 * before touching data.
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

/** Creates a version-1 estimate from a draft object. */
export async function createEstimateAction(draft: unknown): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const estimate = await createEstimate(draft, user);
    revalidatePath("/estimates");
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

/** Creates a new version of an existing estimate chain (the "revise" flow — Task 11b). */
export async function newVersionAction(parentId: string, draft: unknown): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const estimate = await createNewVersion(parentId, draft, user);
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
export async function updateStatusAction(id: string, status: string): Promise<ActionResult> {
  const user = await requireUser();

  if (!ESTIMATE_STATUSES.includes(status as EstimateStatus)) {
    return { ok: false, error: `invalid status: ${status}` };
  }

  try {
    const estimate = await updateStatus(id, status as EstimateStatus, user);
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
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const estimate = await updateQuote(id, quotedPrice, reason, user);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${id}`);
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}
