import "server-only";

// ============================================================
// Lost Boys Demolition — web app — GHL pipeline stage identity
//
// Single authority for "Job Pipeline" stage IDs used by the estimate
// commercial lifecycle (Task 2, profitability v2). Mirrors the proven
// resolve-by-name-at-runtime pattern already live in two places: the
// cold-start pipeline resolution in
// supabase/functions/ghl-job-webhook/index.ts, and client.ts's own
// resolvePipeline() — stage NAMES are the config (checked into this
// file), stage IDs are resolved from the live GHL API and cached, never
// hardcoded.
//
// Deliberately distinct from client.ts's resolvePipeline(): that
// function resolves only the single "Estimate in Progress" stage id the
// estimate push (Task 12) needs, and push.ts already depends on its
// exact cache/return shape — changing it is out of scope for this
// additive-only lane. This module resolves every stage Task 2's
// commercial lifecycle needs (Estimate in Progress, Quote Sent, Quote
// Accepted, Closed Lost (Declined)) on top of client.ts's ADDITIVE
// fetchJobPipelineStages() (the raw, unfiltered stage list), and owns its
// own independent per-process cache — the two caches are not shared and
// each does its own live fetch on first use.
// ============================================================

import { fetchJobPipelineStages } from "./client";

/** The exact 12 live GHL "Job Pipeline" stage names, in pipeline order —
 *  LIVE-VERIFIED 2026-08-19 against the real GHL API (source:
 *  ghl-job-webhook [startup] "Job Pipeline stages" log, pipeline id
 *  `OMDtCf2eHWQ1GQrEcJA1`), superseding the profitability v2 spec's
 *  doc-sourced list this const previously carried verbatim. Two entries
 *  differ from the doc wording: stage 7 is "Job In Progress" (capital
 *  "In"), and stage 11 is "Paid / Closed Won" (spaced slash, no
 *  parenthetical). The location also has a SECOND pipeline
 *  ("Contractor Pipeline") that itself contains a stage literally named
 *  "Job Scheduled" — concrete, live proof that the pipeline-membership
 *  assertion in commercialLifecycle.ts (`assertOpportunityInJobPipelineAndMoveStage`)
 *  is load-bearing, not defensive-programming boilerplate: a name match
 *  alone is not enough to know which pipeline a stage id belongs to.
 *  Exported for reuse anywhere the full stage list matters (e.g. a debug
 *  dump); only four of these twelve have typed accessors below — the ones
 *  Task 2's commercial lifecycle actually drives. */
export const JOB_PIPELINE_STAGE_NAMES = [
  "New Lead",
  "Intake/Qualification",
  "Estimate in Progress",
  "Quote Sent",
  "Quote Accepted",
  "Job Scheduled",
  "Job In Progress",
  "Job Completed",
  "Invoice Review",
  "Invoice Sent",
  "Paid / Closed Won",
  "Closed Lost (Declined)",
] as const;

export type JobPipelineStageName = (typeof JOB_PIPELINE_STAGE_NAMES)[number];

// NOTE (fix round F7, additive-only lane): this module's stage resolution
// deliberately duplicates client.ts's resolvePipeline() (which resolves
// only the single "Estimate in Progress" stage id the estimate push
// needs) rather than folding into it — push.ts already depends on that
// function's exact cache/return shape, and changing it is out of scope
// here. Likewise, resolvePipeline() (push flow, Task 12) and
// resolveJobPipelineStages() (commercial lifecycle, Task 2) both resolve
// "Estimate in Progress" independently, each against its own cache — a
// tracked duplication, not an oversight; retirement/unification is
// deferred, not forgotten.

/** Case-insensitive substring needles for the 4 stages resolved below —
 *  the same match predicate as client.ts's resolvePipeline() and the
 *  Deno edge functions' findStageId (a May 2026 error log showed combined
 *  stage names in the wild, e.g. "Deposit Received/Job Scheduled", which
 *  is why substring — not exact-equality — is the proven-safe match).
 *  None of these four needles is a substring of any of the other eight
 *  live stage names, so there is no cross-match risk among the twelve.
 *
 *  Derived from JOB_PIPELINE_STAGE_NAMES above (fix round F7) rather than
 *  hand-duplicated, so the canonical name list is the single source of
 *  truth for both the display names and the match needles — a name typo'd
 *  or reworded in one place can no longer silently diverge from the
 *  other. `needleFor` drops any parenthetical qualifier before
 *  lowercasing (e.g. "Closed Lost (Declined)" → "closed lost") to
 *  preserve the original, deliberately-broad substrings — those exist so
 *  a reformatted or combined live stage name (e.g. "Closed Lost /
 *  Declined", or "Deposit Received/Job Scheduled" per the May 2026
 *  incident above) still matches on the same core words, the same
 *  behavior this derivation must not narrow. */
function needleFor(name: JobPipelineStageName): string {
  return name.split("(")[0].trim().toLowerCase();
}

const STAGE_SUBSTRINGS = {
  estimateInProgress: needleFor("Estimate in Progress"),
  quoteSent: needleFor("Quote Sent"),
  quoteAccepted: needleFor("Quote Accepted"),
  closedLost: needleFor("Closed Lost (Declined)"),
} as const;

export interface JobPipelineStages {
  pipelineId: string;
  estimateInProgressStageId: string;
  quoteSentStageId: string;
  quoteAcceptedStageId: string;
  closedLostStageId: string;
}

/** Resolves a single stage id by case-insensitive substring match.
 *
 *  Fix round F4: these ids drive PUT writes that move a real opportunity
 *  through the pipeline, so silently taking client.ts's
 *  `findStageIdBySubstring`'s first hit (its `.find` semantics) is not
 *  safe here — an ambiguous needle that happens to match two live stage
 *  names would resolve to whichever one the API happened to list first,
 *  wrongly and silently. This function does its own local `filter` over
 *  the same substring predicate instead: more than one hit throws,
 *  naming the needle, the label, and every stage name that matched, so an
 *  ambiguous configuration fails loudly instead of picking one at random.
 *  client.ts's `findStageIdBySubstring` itself is intentionally left
 *  unchanged — it's proven in the edge functions and other callers rely
 *  on its first-match contract. */
function resolveStage(stages: Array<{ id: string; name: string }>, substring: string, label: string): string {
  const needle = substring.toLowerCase();
  const matches = stages.filter((s) => (s?.name ?? "").toLowerCase().includes(needle));

  if (matches.length === 0) {
    throw new Error(
      `GHL stage matching "${substring}" (${label}) not found in "Job Pipeline". ` +
        `Found: ${stages.map((s) => s.name).join(", ") || "none"}`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `GHL stage matching "${substring}" (${label}) is AMBIGUOUS in "Job Pipeline" — ` +
        `${matches.length} stages matched: ${matches.map((s) => s.name).join(", ")}.`,
    );
  }

  // Review D1: the Array<{id: string}> type is a cast over untyped GHL
  // JSON — a stage that matched by name but carries no usable id would
  // otherwise resolve to undefined and turn every later stage move into a
  // silent no-op PUT ({pipelineStageId: undefined} serializes to {}).
  const id = matches[0].id;
  if (!id) {
    throw new Error(
      `GHL stage "${matches[0].name}" matched "${substring}" (${label}) but has no id.`,
    );
  }
  return id;
}

let stagesCache: Promise<JobPipelineStages> | null = null;

async function resolveJobPipelineStagesUncached(): Promise<JobPipelineStages> {
  const { pipelineId, stages } = await fetchJobPipelineStages();
  return {
    pipelineId,
    estimateInProgressStageId: resolveStage(stages, STAGE_SUBSTRINGS.estimateInProgress, "Estimate in Progress"),
    quoteSentStageId: resolveStage(stages, STAGE_SUBSTRINGS.quoteSent, "Quote Sent"),
    quoteAcceptedStageId: resolveStage(stages, STAGE_SUBSTRINGS.quoteAccepted, "Quote Accepted"),
    closedLostStageId: resolveStage(stages, STAGE_SUBSTRINGS.closedLost, "Closed Lost (Declined)"),
  };
}

/** Resolves and caches (per process) the 4 "Job Pipeline" stage ids the
 *  commercial lifecycle needs (create/link → Estimate in Progress,
 *  presentEstimate → Quote Sent, recordEstimateAcceptance → Quote
 *  Accepted, reverseEstimateAcceptance's `closed_lost` destination →
 *  Closed Lost (Declined); the `quote_sent` reversal destination reuses
 *  quoteSentStageId). Cached the same way client.ts's resolvePipeline()
 *  is: a failed resolution is NOT cached, so the next call retries
 *  cleanly against a fresh fetch instead of wedging every subsequent
 *  server action on one transient GHL error for the life of the process.
 *  Caching is per Node.js server process/worker, not per request or
 *  per server action call — repeated calls across different server
 *  actions within the same warm process share one resolution and issue
 *  no further network calls until the process restarts (or the resolve
 *  fails and the next call retries). */
export function resolveJobPipelineStages(): Promise<JobPipelineStages> {
  if (!stagesCache) {
    stagesCache = resolveJobPipelineStagesUncached().catch((err) => {
      stagesCache = null;
      throw err;
    });
  }
  return stagesCache;
}

/** Test-only escape hatch — clears the module-level stage cache. */
export function __resetJobPipelineStagesCacheForTests(): void {
  stagesCache = null;
}
