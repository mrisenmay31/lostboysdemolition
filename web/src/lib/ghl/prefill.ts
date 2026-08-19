import "server-only";

// ============================================================
// Lost Boys Demolition — web app — GHL-first prefill + identity search
//
// Two entry points into estimate creation (v2 spec doc lines 938-974):
//
//  - App-first: the estimator starts in the builder with no known GHL
//    identity. findContactMatches() searches GHL by stable contact ID,
//    email, and phone, and returns candidates for an explicit-selection
//    UI. It NEVER auto-picks or merges — silent merging is the exact
//    failure mode the spec forbids ("show possible matches, and require
//    explicit contact/opportunity selection or creation. Never silently
//    merge").
//
//  - GHL-first: the estimator opens `/estimates/new?ghlOpportunityId=<id>`
//    from a GHL opportunity. loadPrefillFromOpportunity() fetches that
//    opportunity and its linked contact and returns a flat prefill object
//    the builder pre-fills its contact fields from.
//
// Both are read-only GHL lookups — no writes, no Supabase, no estimate
// creation. The actual create/link decision belongs to lane 2d's
// integration layer, which is why EstimateIdentitySelection (the shape
// that decision produces) is defined here, next to the search it
// consumes, rather than in that layer.
// ============================================================

import { GhlApiError, getContact, getOpportunity, searchContactsByEmail, searchContactsByPhone } from "./client";
import type { GhlContact } from "./types";

// ── GHL-first prefill ───────────────────────────────────────────────────

/** Flat prefill shape for the estimate builder's contact fields. Every
 *  contact-derived field is nullable — GHL-first entry must never throw
 *  just because a contact record is missing an optional field (or is
 *  missing entirely); it throws ONLY when the opportunity itself can't be
 *  found, since without an opportunity there is nothing to prefill from
 *  or link the estimate to. */
export interface EstimatePrefill {
  ghlContactId: string | null;
  ghlOpportunityId: string;
  opportunityName: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

function emptyContactFields(): Omit<EstimatePrefill, "ghlContactId" | "ghlOpportunityId" | "opportunityName"> {
  return {
    firstName: null,
    lastName: null,
    companyName: null,
    email: null,
    phone: null,
    address1: null,
    city: null,
    state: null,
    postalCode: null,
  };
}

/** Fetches a GHL opportunity and its linked contact, returning a flat
 *  prefill object for `/estimates/new?ghlOpportunityId=<id>`.
 *
 *  Throws when the opportunity itself is not found (getOpportunity
 *  propagates GhlApiError on a 404 — there is nothing to prefill or link
 *  against). Never throws for anything downstream of that: an
 *  opportunity with no `contactId` degrades to opportunity-only prefill
 *  with every contact field null — the estimator can still create/select
 *  a contact by hand in the UI.
 *
 *  A `contactId` whose contact fetch fails also degrades to
 *  opportunity-only prefill for the human-facing fields (name, email,
 *  etc.) — but `ghlContactId` itself is handled two different ways
 *  depending on WHY the fetch failed (fix round F6, docstring corrected
 *  to match the deliberate behavior below, which was already correct):
 *   - Any failure OTHER than a confirmed 404 (network/outage/auth/config
 *     error) is transient by nature, so `ghlContactId` is RETAINED from
 *     the opportunity's own `contactId` — a blip in reaching GHL must
 *     never sever an already-known identity link.
 *   - A confirmed 404 (GhlApiError with status 404) means the contact
 *     record itself is gone, so `ghlContactId` is NULLED — carrying a
 *     dangling id forward would let a deleted contact silently become the
 *     estimate's canonical identity. */
export async function loadPrefillFromOpportunity(ghlOpportunityId: string): Promise<EstimatePrefill> {
  const opportunity = await getOpportunity(ghlOpportunityId);

  const base: EstimatePrefill = {
    ghlContactId: opportunity.contactId ?? null,
    ghlOpportunityId: opportunity.id,
    opportunityName: opportunity.name ?? null,
    ...emptyContactFields(),
  };

  if (!opportunity.contactId) {
    console.warn(
      `[prefill] GHL opportunity ${ghlOpportunityId} has no contactId — returning opportunity-only prefill`,
    );
    return base;
  }

  try {
    const contact = await getContact(opportunity.contactId);
    return {
      ...base,
      ghlContactId: contact.id,
      firstName: contact.firstName ?? null,
      lastName: contact.lastName ?? null,
      companyName: contact.companyName ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      address1: contact.address1 ?? null,
      city: contact.city ?? null,
      state: contact.state ?? null,
      postalCode: contact.postalCode ?? null,
    };
  } catch (err) {
    const isConfirmedNotFound = err instanceof GhlApiError && err.status === 404;
    console.warn(
      `[prefill] contact fetch failed for ${opportunity.contactId} (opportunity ${ghlOpportunityId}), ` +
        `degrading to opportunity-only prefill${isConfirmedNotFound ? " (contact confirmed deleted — clearing ghlContactId)" : " (retaining ghlContactId — treating as transient)"}:`,
      err,
    );
    return {
      ...base,
      ghlContactId: isConfirmedNotFound ? null : base.ghlContactId,
    };
  }
}

// ── App-first identity search ───────────────────────────────────────────

export interface ContactMatchQuery {
  /** A previously-known GHL contact id (e.g. carried over from
   *  `estimate_identity_links` on a revise flow) — looked up directly
   *  rather than searched, per the spec's "stable contact ID" leg. A
   *  stale/deleted id degrades to "no match" rather than throwing, same
   *  as every other leg here — one bad candidate must never abort the
   *  whole search. */
  ghlContactId?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Resolves the stable-contact-ID leg of findContactMatches below.
 *
 *  Fix round F3: only a CONFIRMED 404 on this direct-by-id lookup may
 *  read as "no match" — a stale/deleted id genuinely doesn't exist, so
 *  degrading it to "no candidate from this leg" is correct. Anything else
 *  (network error, 401/403 auth/config failure, 5xx outage after
 *  ghlFetch's own retry is exhausted) must NOT be swallowed the same way:
 *  silently treating an outage as "no match" would let this leg
 *  manufacture a duplicate contact downstream (the human sees zero
 *  candidates, picks "create new", and GHL ends up with two records for
 *  the same person) — exactly the failure mode the "never silently
 *  merge" rule exists to prevent, just from the opposite direction. */
async function lookupStableContactId(ghlContactId: string): Promise<GhlContact | null> {
  try {
    return await getContact(ghlContactId);
  } catch (err) {
    if (err instanceof GhlApiError && err.status === 404) {
      console.warn(`[prefill] stable contact id ${ghlContactId} not found (404) — dropping from candidate list`);
      return null;
    }
    throw err;
  }
}

/** Runs the stable-contact-ID, email, and phone searches (whichever of
 *  the three are supplied) and returns the deduped union as candidates
 *  for an explicit-selection UI.
 *
 *  Fix round F1: the email/phone legs now consume `searchContactsByEmail`/
 *  `searchContactsByPhone` (the array-returning variants — see client.ts)
 *  instead of the first-match-only singular functions, so a search leg
 *  that genuinely has more than one live GHL contact matching the same
 *  email or phone surfaces ALL of them here, not silently just the
 *  first — the exact "never silently merge" violation this function's
 *  docstring already promised not to commit. The stable-contact-ID leg is
 *  unchanged in shape (a direct by-id lookup can only ever resolve to 0
 *  or 1 contact) but its error handling is now selective — see
 *  `lookupStableContactId` above (F3).
 *
 *  Deliberately NEVER auto-picks a "best" match, never merges duplicate
 *  candidates into one, and returns [] rather than throwing when nothing
 *  matches or no query fields were supplied — selection or creation is
 *  always a human's explicit choice downstream (v2 spec: "show possible
 *  matches, and require explicit contact/opportunity selection or
 *  creation. Never silently merge"). */
export async function findContactMatches(query: ContactMatchQuery): Promise<GhlContact[]> {
  const { ghlContactId, email, phone } = query;

  const lookups: Promise<GhlContact[]>[] = [];
  if (ghlContactId) {
    lookups.push(lookupStableContactId(ghlContactId).then((contact) => (contact ? [contact] : [])));
  }
  if (email) lookups.push(searchContactsByEmail(email));
  if (phone) lookups.push(searchContactsByPhone(phone));

  if (lookups.length === 0) return [];

  const results = await Promise.all(lookups);

  const byId = new Map<string, GhlContact>();
  for (const contacts of results) {
    for (const contact of contacts) {
      if (contact && !byId.has(contact.id)) byId.set(contact.id, contact);
    }
  }
  return Array.from(byId.values());
}

// ── Identity selection (spec-verbatim, v2 doc lines 945-950) ────────────
//
// The result of the human's explicit choice over findContactMatches()'s
// candidates (or a decision to create fresh). Defined here, next to the
// search that feeds it, for lane 2d's integration layer to import and
// act on — it is not itself acted on by anything in this file.

export interface EstimateIdentitySelection {
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  createContact: boolean;
  createOpportunity: boolean;
}
