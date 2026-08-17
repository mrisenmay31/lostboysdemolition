// ============================================================
// Lost Boys Demolition — shared Slack helpers
// Consolidates the three duplicated copies of Slack logic that previously
// lived in ghl-job-webhook/index.ts, ghl-job-webhook/handlers.ts, and
// crew-night-before/index.ts + handlers.ts (crew env-key resolution and the
// postSlackMessage network call), and introduces the BL-4 crew job-block
// message format (buildCrewJobBlock). Pure functions throughout except
// postSlackMessage, which does real network I/O — its bot token is a
// PARAMETER, never read from Deno.env directly, so this module has no
// top-level side effects and can be unit tested without hitting the network.
// ============================================================

// ── Crew → env-key resolution (single source of truth for crew vocabulary) ──

export type CrewEnvKey = "crew1" | "crew2" | "crew3" | "crew4";

const CREW_ENV_KEY_MAP: Record<string, CrewEnvKey> = {
  "crew 1": "crew1",
  "crew 2": "crew2",
  "crew 3": "crew3",
  "crew 4": "crew4",
};

const CREW_ENV_VAR_MAP: Record<CrewEnvKey, string> = {
  crew1: "SLACK_CREW1_CHANNEL",
  crew2: "SLACK_CREW2_CHANNEL",
  crew3: "SLACK_CREW3_CHANNEL",
  crew4: "SLACK_CREW4_CHANNEL",
};

/** Case-insensitive/trimmed. "Crew 1".."Crew 4" -> key; anything else (incl.
 *  "Jackson", "Other", null, "") -> null. */
export function resolveCrewEnvKey(crew: string | null | undefined): CrewEnvKey | null {
  if (!crew) return null;
  return CREW_ENV_KEY_MAP[crew.trim().toLowerCase()] ?? null;
}

/** Env VAR NAME for a crew, e.g. "SLACK_CREW1_CHANNEL" — not its value; the
 *  caller resolves that via its own Deno.env accessor so this stays a pure
 *  function. Implemented in terms of resolveCrewEnvKey so the crew
 *  vocabulary ("Crew 1".."Crew 4") has exactly one source of truth. Returns
 *  null for unmapped crews (incl. "Jackson", "Other", null, ""). */
export function resolveCrewChannelEnvVar(crew: string | null | undefined): string | null {
  const key = resolveCrewEnvKey(crew);
  return key ? CREW_ENV_VAR_MAP[key] : null;
}

// ── postSlackMessage — side-effecting, not unit tested here ─────────────────

/** Consolidates the three identical copies (ghl-job-webhook/index.ts,
 *  crew-night-before/index.ts — both formerly module-scoped on
 *  SLACK_BOT_TOKEN). Token is a PARAMETER here, not read from module scope —
 *  shared code must not touch Deno.env directly; callers pass their own
 *  resolved SLACK_BOT_TOKEN. Returns Slack's ok flag + error, never throws
 *  on a non-ok Slack response (mirrors the original copies). */
export async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json();
  console.log("[slack] post message response:", JSON.stringify(data));
  return { ok: data.ok === true, error: data.error };
}

// ── Date / phone formatting ──────────────────────────────────────────────────

/** Formats a plain `date` column value ("YYYY-MM-DD", no time/zone) as
 *  "Thu Aug 20". Anchored at noon UTC and formatted in UTC so the
 *  weekday/month/day are read straight off the calendar string, immune to
 *  any timezone shifting either the machine's or Denver's — the robust of
 *  the two existing copies (crew-night-before/handlers.ts:73-79), reused
 *  here rather than the ghl-job-webhook version's local Date.UTC + toLocale
 *  approach so there is exactly one implementation going forward. */
export function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(dt);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(dt);
  return `${weekday} ${month} ${d}`;
}

/** US 10-digit -> "(801) 555-0142". Also handles a leading "1"/"+1" (11
 *  digits, after stripping non-digits). Anything else (extensions,
 *  international numbers, letters, empty/whitespace-only) passes through
 *  trimmed and unchanged. Never throws. */
export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length === 10) {
    return `(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
  }
  return trimmed;
}

// ── Crew job block (BL-4 format) ─────────────────────────────────────────────

export interface CrewJobBlockInput {
  headline: string; // e.g. "🏗️ New job scheduled — JOB-1104"
  contactName: string | null; // person, e.g. "Ann Morrison"
  businessName: string | null; // company, e.g. "Morrison Construction"
  clientPhone: string | null; // raw; formatted via formatPhone internally
  startDate: string | null; // "YYYY-MM-DD"; rendered via formatDateLabel
  startTime: string | null; // free text from GHL, e.g. "8:00 AM"; passed through trimmed
  jobAddress: string | null;
  scopeSummary: string | null; // pre-rendered, possibly multi-line
}

/** Builds the BL-4 crew Slack message body: three line-groups (identity,
 *  schedule, scope), each with empty/null lines dropped, each group dropped
 *  entirely if it ends up empty, surviving groups joined by a blank line.
 *  NO MONEY on any line, ever — no total bid, quoted price, markup, margin,
 *  hours, or dump counts; this function only ever touches the fields on
 *  CrewJobBlockInput, none of which are pricing data, so that invariant
 *  holds by construction as long as callers don't smuggle dollar figures
 *  into scopeSummary. */
export function buildCrewJobBlock(input: CrewJobBlockInput): string {
  const contactName = input.contactName?.trim() || null;
  const businessNameTrimmed = input.businessName?.trim() || null;
  // clientLabel() upstream can collapse a company contact's name into a
  // single label, so businessName and contactName can legitimately arrive
  // identical — printing the same string twice looks broken, so omit the
  // business line whenever the two match (case-insensitive, trimmed).
  const businessLine =
    businessNameTrimmed && businessNameTrimmed.toLowerCase() !== (contactName ?? "").toLowerCase()
      ? businessNameTrimmed
      : null;

  const identityGroup = [
    input.headline?.trim() || null,
    contactName,
    businessLine,
    formatPhone(input.clientPhone),
  ].filter((line): line is string => !!line);

  const scheduleGroup = [
    input.startDate ? formatDateLabel(input.startDate) : null,
    input.startTime?.trim() || null,
    input.jobAddress?.trim() || null,
  ].filter((line): line is string => !!line);

  const scopeGroup = input.scopeSummary && input.scopeSummary.trim().length > 0
    ? [input.scopeSummary]
    : [];

  return [identityGroup, scheduleGroup, scopeGroup]
    .map((group) => group.join("\n"))
    .filter((group) => group.length > 0)
    .join("\n\n");
}

/** Divider line used between job blocks in a multi-job digest. */
export const BLOCK_DIVIDER = "──────────";

/** Joins blocks with a blank line, divider, blank line. Single block -> no
 *  divider. Empty input -> "". */
export function joinCrewJobBlocks(blocks: string[]): string {
  if (blocks.length === 0) return "";
  if (blocks.length === 1) return blocks[0];
  return blocks.join(`\n\n${BLOCK_DIVIDER}\n\n`);
}
