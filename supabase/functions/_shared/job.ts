export function isValidJobNumber(s: string): boolean {
  return /^JOB-\d{4,}$/.test(s);
}

const STATE_TOKEN = /^(UT|Utah)\.?,?$/i;
const TRAILING_COUNTRY = /^(USA|United States)\.?$/i;
// Whole-segment is just a state (optionally with a trailing zip) — never a city
const STATE_ZIP_ONLY = /^(UT|Utah)\.?(\s+\d{5}(-\d{4})?)?$/i;
const ZIP_ONLY = /^\d{5}(-\d{4})?$/;

export function parseCity(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  let parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  // drop a trailing country segment before selecting the candidate
  if (parts.length && TRAILING_COUNTRY.test(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }
  if (!parts.length) return null; // country-only address (e.g. "USA", ", USA") — no city left
  if (parts.length >= 2) {
    // "street, city, state zip" → second-to-last segment unless it's the state itself.
    // Walk left if the candidate turns out to be the state/zip segment (e.g. no street
    // segment present, so "city, state zip" only has 2 parts).
    let idx = parts.length >= 3 ? parts.length - 2 : 1;
    while (idx >= 0) {
      const candidate = parts[idx];
      const cleaned = candidate.replace(/\s+(UT|Utah)\.?(\s+\d{5}(-\d{4})?)?$/i, "").trim();
      if (cleaned && !STATE_ZIP_ONLY.test(cleaned) && !ZIP_ONLY.test(cleaned)) return cleaned;
      idx--;
    }
    return null;
  }
  // No commas: take tokens before a state token, drop leading street-number/name heuristically
  const tokens = parts[0].split(/\s+/);
  const stateIdx = tokens.findIndex((t) => STATE_TOKEN.test(t));
  if (stateIdx > 0) {
    // walk back from state collecting capitalized tokens that aren't obviously street words
    const cityTokens: string[] = [];
    for (let i = stateIdx - 1; i >= 0; i--) {
      const t = tokens[i];
      if (/^\d/.test(t) || /^(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Way|Pl|S|N|E|W)\.?$/i.test(t)) break;
      cityTokens.unshift(t);
    }
    return cityTokens.length ? cityTokens.join(" ") : null;
  }
  return tokens.length <= 3 ? parts[0] : null; // bare city name
}

export function clientLabel(opts: {
  companyName?: string | null; firstName?: string | null; lastName?: string | null;
}): string {
  return opts.companyName?.trim() || opts.lastName?.trim() || opts.firstName?.trim() || "Client";
}

export function buildJobName(jobNumber: string, client: string, city: string | null): string {
  return `${jobNumber} – ${client}${city ? ` – ${city}` : ""}`;
}
