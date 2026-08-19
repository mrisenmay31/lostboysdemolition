"use client";

import { useState } from "react";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import type { ClientType, EstimateIdentityLinkRow } from "@/lib/estimates/types";
import { findContactMatchesAction, linkEstimateIdentityAction } from "../../actions";
import type { ContactCreationFields } from "@/lib/estimates/commercialLifecycle";
import type { GhlContact } from "@/lib/ghl/types";

interface IdentityLinkPanelProps {
  estimateId: string;
  identityLink: EstimateIdentityLinkRow | null;
  clientName: string | null;
  clientType: ClientType | null;
  clientEmail: string | null;
  clientPhone: string | null;
  jobAddress: string | null;
  city: string | null;
  jobName: string | null;
}

function contactLabel(contact: GhlContact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return contact.companyName || name || contact.email || contact.phone || contact.id;
}

/** Splits a free-text "First Last" name into parts — mirrors
 *  `@/lib/ghl/estimateFields.ts`'s `splitClientName` (never forked; a
 *  second inline copy would be exactly the kind of drift risk that
 *  module's own doc comment warns against elsewhere in this codebase).
 *  Not imported directly because that module is outside this fix round's
 *  file-ownership lane — duplicated here as a 3-line pure helper rather
 *  than importing across the lane boundary. Keep in sync if
 *  `splitClientName` ever changes. */
function splitPersonName(name: string): { firstName: string | null; lastName: string | null } {
  const trimmed = name.trim();
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Fix round F9: derives real name/address fields for GHL contact
 *  creation instead of the email/phone-only payload this panel sent
 *  before — CLAUDE.md's `airtable-client-sync` history (name-erasure bug,
 *  `ghlFields` defaulting blank names to `''` which `JSON.stringify`
 *  keeps) is exactly the house scar this must not repeat: a blank-named
 *  GHL contact should never be created when a real name is available, so
 *  every field below is `null` (dropped by `JSON.stringify` through
 *  `linkEstimateIdentity`'s `?? undefined` mapping) rather than `''` when
 *  there's nothing to put there.
 *
 *  Company vs. person is `clientType`'s call, mirroring
 *  `EstimateBuilder.tsx`'s `ghlPrefillClientName` convention IN REVERSE
 *  (that function turns a GHL contact's company/first/last into one
 *  display name, preferring company; this turns one display name back
 *  into GHL contact fields, using `clientType` — which `ghlPrefillClientName`
 *  doesn't have — as the signal that convention doesn't have access to):
 *  `clientType === "Contractor"` treats the whole name as `companyName`
 *  (a contractor's `client_name` is normally a business name, same
 *  assumption CLAUDE.md's `clientLabel()`/`companyName || lastName ||
 *  firstName` collapse documents for the reverse direction); anything
 *  else (Homeowner or unset) treats it as a person and splits it. */
function deriveContactCreationFields(input: {
  clientName: string | null;
  clientType: ClientType | null;
  clientEmail: string | null;
  clientPhone: string | null;
  jobAddress: string | null;
  city: string | null;
}): ContactCreationFields {
  const name = (input.clientName ?? "").trim();
  const isCompany = input.clientType === "Contractor" && name.length > 0;
  const { firstName, lastName } = isCompany ? { firstName: null, lastName: null } : splitPersonName(name);
  return {
    firstName,
    lastName,
    companyName: isCompany ? name : null,
    email: input.clientEmail,
    phone: input.clientPhone,
    address1: input.jobAddress,
    city: input.city,
  };
}

/**
 * App-first identity search + link (Phase 1, v2 Task 2 lane 2d). Only
 * rendered when this estimate's family has no GHL identity link yet — the
 * GHL-first entry point (`/estimates/new?ghlOpportunityId=`) links
 * automatically at create time, so this panel is the app-first estimator's
 * path to the same place. Per the v2 spec ("show possible matches, and
 * require explicit contact/opportunity selection or creation. Never
 * silently merge"), this NEVER auto-picks — every candidate requires an
 * explicit tap, and "create new" is an equally explicit, separate choice.
 */
export function IdentityLinkPanel({
  estimateId,
  identityLink,
  clientName,
  clientType,
  clientEmail,
  clientPhone,
  jobAddress,
  city,
  jobName,
}: IdentityLinkPanelProps) {
  const { estimator } = useEstimator();
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<GhlContact[] | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    setError(null);
    setSearching(true);
    try {
      const result = await findContactMatchesAction(clientEmail, clientPhone, estimator);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCandidates(result.contacts);
    } finally {
      setSearching(false);
    }
  }

  async function handleLinkExisting(contact: GhlContact) {
    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    setError(null);
    setLinking(true);
    try {
      const result = await linkEstimateIdentityAction(
        {
          estimateId,
          selection: {
            ghlContactId: contact.id,
            ghlOpportunityId: null,
            createContact: false,
            createOpportunity: true,
          },
          opportunityName: jobName ?? undefined,
        },
        estimator,
      );
      if (!result.ok) setError(result.error);
    } finally {
      setLinking(false);
    }
  }

  async function handleCreateNew() {
    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    setError(null);
    setLinking(true);
    try {
      const result = await linkEstimateIdentityAction(
        {
          estimateId,
          selection: {
            ghlContactId: null,
            ghlOpportunityId: null,
            createContact: true,
            createOpportunity: true,
          },
          contactFields: deriveContactCreationFields({
            clientName,
            clientType,
            clientEmail,
            clientPhone,
            jobAddress,
            city,
          }),
          opportunityName: jobName ?? undefined,
        },
        estimator,
      );
      if (!result.ok) setError(result.error);
    } finally {
      setLinking(false);
    }
  }

  if (identityLink) {
    return (
      <section className="flex flex-col gap-1 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          GHL identity
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Linked to opportunity {identityLink.ghl_opportunity_id} (contact {identityLink.ghl_contact_id})
          by {identityLink.linked_by_name}.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        GHL identity
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Not yet linked to a GHL contact/opportunity — presenting or accepting this estimate won&apos;t
        move anything in GHL until it is.
      </p>
      <button
        type="button"
        onClick={handleSearch}
        disabled={searching}
        className="h-10 w-fit rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
      >
        {searching ? "Searching…" : "Search GHL"}
      </button>

      {candidates ? (
        <div className="flex flex-col gap-2">
          {candidates.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No matching contacts found.</p>
          ) : (
            <>
              {/* Known limitation (fix round F8, not fixed this round): tapping
                  a candidate below links its CONTACT only — this always
                  CREATES a brand-new opportunity (selection.createOpportunity
                  is hard-coded true in handleLinkExisting), even when the
                  contact already has a matching GHL opportunity that should
                  have been reused instead. Full opportunity-selection UI
                  (searching/picking an existing opportunity, not just a
                  contact) is a future improvement — the selection shape
                  already supports it via EstimateIdentitySelection.
                  ghlOpportunityId (@/lib/ghl/prefill.ts), this panel just
                  never sets it to anything but null. */}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Linking a contact below always creates a NEW GHL opportunity — picking an
                existing opportunity isn&apos;t supported yet.
              </p>
              <ul className="flex flex-col gap-2">
                {candidates.map((contact) => (
                  <li key={contact.id}>
                    <button
                      type="button"
                      onClick={() => handleLinkExisting(contact)}
                      disabled={linking}
                      className="flex h-11 w-full items-center justify-between rounded-lg border border-zinc-300 px-3 text-sm disabled:opacity-60 dark:border-zinc-700"
                    >
                      <span>{contactLabel(contact)}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Link</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            onClick={handleCreateNew}
            disabled={linking}
            className="h-10 w-fit rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
          >
            {linking ? "Creating…" : "Create new contact + opportunity"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
