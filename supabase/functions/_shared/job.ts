export function isValidJobNumber(s: string): boolean {
  return /^JOB-\d{4,}$/.test(s);
}

const STATE_TOKEN = /^(UT|Utah)\.?,?$/i;

export function parseCity(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // "street, city, state zip" → second-to-last segment unless it's the state itself
    const candidate = parts.length >= 3 ? parts[parts.length - 2] : parts[1];
    const cleaned = candidate.replace(/\s+(UT|Utah)\.?(\s+\d{5}(-\d{4})?)?$/i, "").trim();
    return cleaned || null;
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
