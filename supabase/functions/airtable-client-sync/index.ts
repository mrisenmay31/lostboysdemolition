// ============================================================
// Lost Boys Demolition — Airtable to GHL Client Sync
// Supabase Edge Function: airtable-client-sync
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GHL_API_KEY          = Deno.env.get('GHL_API_KEY')!
const GHL_LOCATION_ID      = Deno.env.get('GHL_LOCATION_ID')!
const AIRTABLE_BASE_ID     = Deno.env.get('AIRTABLE_BASE_ID')!
const AIRTABLE_API_KEY     = Deno.env.get('AIRTABLE_API_KEY')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET       = Deno.env.get('AIRTABLE_WEBHOOK_SECRET')!

const AIRTABLE_CLIENTS_TABLE = 'tblSJkwDdupKzsst7'

const FIELDS = {
  // clientName (fldyIBidorXegZFHf) is a formula field — do not read or write to it
  firstName:    'fld6jXXgXUEWEvW0H',
  lastName:     'fldng2X0AGhTnxrex',
  clientType:   'fldJoDlrTMUu99YQw',
  companyName:  'fldxc5LB2eKwEuSTX',
  contactName:  'fldI5frhZxRY16DgS',
  email:        'fldMVOoOV9TRdUAyC',
  phone:        'fldzROwSsF7IoYYqN',
  ghlContactId: 'fldC4zAieX10BVacc',
  ghlCompanyId: 'fldd3U0I423OVOJER',
}

const GHL_BASE = 'https://services.leadconnectorhq.com'

// Tolerant body reader for every GHL fetch below. res.json() throws on a
// non-JSON body (an HTML 502 from a proxy, an empty 204/400) — that throw
// happens *before* res.ok can be checked, so it defeats the null-return and
// duplicate-400 contracts these callers depend on. Mirrors parseBody() in
// web/src/lib/ghl/client.ts:120-128.
async function parseGhlBody(res: Response): Promise<any> {
  const text = await res.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// FIXED 2026-08-17: the original GET /contacts/?locationId=...&email=...
// contract changed and now returns HTTP 422 on the live API. Never checking
// res.ok meant a failed search silently returned null, indistinguishable
// from "no such contact". Replaced with POST /contacts/search + an `eq`
// filter, mirroring the live-verified web/src/lib/ghl/client.ts
// searchContactByEmail implementation (Phase B slice 2, T9f).
async function searchGhlByEmail(email: string) {
  const res = await fetch(`${GHL_BASE}/contacts/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locationId: GHL_LOCATION_ID,
      filters: [{ field: 'email', operator: 'eq', value: email }],
      page: 1,
      pageLimit: 10,
    })
  })
  const data = await parseGhlBody(res)
  if (!res.ok) {
    console.error(`[ghl] contact search FAILED (status ${res.status}):`, JSON.stringify(data))
    return null
  }
  const contact = data?.contacts?.[0] ?? null
  if (!contact) {
    console.log('[ghl] contact search: no match found for email')
  }
  return contact
}

// Returns the raw status alongside the body (rather than branching internally)
// so the caller can distinguish "created" from "duplicate-400" from "genuine
// failure" without re-deriving statusCode out of the body, which GHL is not
// contractually guaranteed to echo.
async function createGhlContact(
  fields: Record<string, any>
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationId: GHL_LOCATION_ID, ...fields })
  })
  const data = await parseGhlBody(res)
  if (!res.ok) {
    // Do not throw here — the duplicate-400 fallback below depends on
    // reading status/meta.contactId out of this exact error response.
    console.error(`[ghl] create contact FAILED (status ${res.status}):`, JSON.stringify(data))
  } else {
    console.log('[ghl] create contact response:', JSON.stringify(data))
  }
  return { ok: res.ok, status: res.status, data }
}

async function updateGhlContact(ghlContactId: string, fields: Record<string, any>) {
  const res = await fetch(`${GHL_BASE}/contacts/${ghlContactId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  })
  const data = await parseGhlBody(res)
  if (!res.ok) {
    // This is now the load-bearing write on the fixed path — a rejected PUT
    // must not be reported as a success. Throw so the outer catch records
    // status='error' with a real error_message instead of sync_log asserting
    // fields were written when they were not.
    console.error(`[ghl] update contact FAILED (status ${res.status}):`, JSON.stringify(data))
    throw new Error(`GHL contact update failed (status ${res.status}): ${JSON.stringify(data)}`)
  }
  console.log('[ghl] update contact response:', JSON.stringify(data))
  return data
}

async function writeGhlIdToAirtable(recordId: string, ghlContactId: string) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [FIELDS.ghlContactId]: ghlContactId } })
  })
  const data = await res.json()
  console.log('[airtable] write GHL Contact ID response:', JSON.stringify(data))
  return data
}

function clientTypeToTag(clientType: string | null): string[] {
  if (!clientType) return []
  if (clientType === 'Contractor') return ['Contractor']
  if (clientType === 'Homeowner')  return ['Homeowner']
  return []
}

function extractGhlContactId(data: any): string | null {
  return data?.contact?.id ?? data?.id ?? data?.contacts?.[0]?.id ?? null
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const incomingSecret = req.headers.get('x-webhook-secret')
  if (incomingSecret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let payload: any
  try { payload = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const airtableRecordId = payload.record_id
  const firstName        = payload.fields?.[FIELDS.firstName] ?? ''
  const lastName         = payload.fields?.[FIELDS.lastName] ?? ''
  const clientName       = `${firstName} ${lastName}`.trim()
  const email            = payload.fields?.[FIELDS.email]?.toLowerCase()?.trim()
  const phone            = payload.fields?.[FIELDS.phone] ?? ''
  const companyName      = payload.fields?.[FIELDS.companyName] ?? ''
  const clientType       = payload.fields?.[FIELDS.clientType] ?? null
  const existingGhlId    = payload.fields?.[FIELDS.ghlContactId] ?? null

  let matchMethod: string      = 'none'
  let actionTaken: string      = 'error'
  let ghlContactId: string|null = existingGhlId
  let status                   = 'success'
  let errorMessage: string|null = null

  try {
    const tags = clientTypeToTag(clientType)
    // firstName/lastName/email default to '' upstream, and JSON.stringify
    // drops undefined but keeps "" — an unguarded blank name here would PUT
    // an empty string and erase the name on the GHL contact.
    const ghlFields = {
      firstName:   firstName || undefined,
      lastName:    lastName || undefined,
      email:       email || undefined,
      phone:       phone || undefined,
      companyName: companyName || undefined,
      tags:        tags.length ? tags : undefined,
    }

    if (existingGhlId) {
      matchMethod  = 'ghl_contact_id'
      ghlContactId = existingGhlId
      await updateGhlContact(existingGhlId, ghlFields)
      actionTaken  = 'updated'
    } else if (email) {
      const existing = await searchGhlByEmail(email)
      if (existing) {
        matchMethod  = 'email'
        ghlContactId = existing.id as string
        // Write-back BEFORE update: the ID write-back is a match cache, not
        // a success claim. It came from GHL's own search result, so the
        // linkage is true whether or not the field update below lands —
        // caching it now means a failed update still leaves this client's
        // *next* sync taking the cheap, working existingGhlId branch instead
        // of stranding it with no GHL Contact ID (the automation that
        // invokes this function is create-only, so nothing else will ever
        // retry a bare Airtable record). sync_log still records the update
        // failure honestly via the throw below.
        if (airtableRecordId) {
          await writeGhlIdToAirtable(airtableRecordId, ghlContactId)
        }
        await updateGhlContact(existing.id, ghlFields)
        actionTaken  = 'updated'
      } else {
        matchMethod   = 'none'
        const created = await createGhlContact(ghlFields)

        // GHL returns 400 with meta.contactId when duplicate contacts are not allowed
        if (created.status === 400 && created.data?.meta?.contactId) {
          const duplicateContactId: string = created.data.meta.contactId
          console.log(`[ghl] Duplicate blocked — using existing contact ID: ${duplicateContactId}`)
          ghlContactId = duplicateContactId
          // 'email_duplicate' is legal only because of migration
          // 20260817140000_widen_sync_log_match_method.sql — the pairing
          // distinguishes "search worked" (match_method='email') from
          // "search fell through to create and hit GHL's duplicate guard"
          // (match_method='email_duplicate'), which are otherwise
          // indistinguishable in sync_log.
          matchMethod = 'email_duplicate'
          // Same write-before-update rationale as the search-match branch
          // above: this branch used to stop after matching the existing
          // contact, never writing the new field values to it — silently
          // dropping this sync's edits. Update it like the other match
          // branches do, but cache the ID first so a failed update doesn't
          // strand this client with no GHL Contact ID.
          if (airtableRecordId) {
            await writeGhlIdToAirtable(airtableRecordId, ghlContactId)
          }
          await updateGhlContact(duplicateContactId, ghlFields)
          actionTaken = 'updated'
        } else if (created.ok) {
          ghlContactId = extractGhlContactId(created.data)
          if (!ghlContactId) {
            throw new Error(`GHL contact create returned no ID. Full response: ${JSON.stringify(created.data)}`)
          }
          actionTaken = 'created'
          if (airtableRecordId) {
            await writeGhlIdToAirtable(airtableRecordId, ghlContactId)
          }
        } else {
          throw new Error(`GHL contact create failed (status ${created.status}): ${JSON.stringify(created.data)}`)
        }
      }
    } else {
      actionTaken  = 'skipped'
      errorMessage = 'No email or GHL Contact ID — cannot sync to GHL'
    }

    if (email) {
      await supabase.from('client_sync_state').upsert({
        email, airtable_record_id: airtableRecordId, ghl_contact_id: ghlContactId,
        client_name: clientName, client_type: clientType,
        last_synced_at: new Date().toISOString(), last_direction: 'airtable_to_ghl',
      }, { onConflict: 'email', ignoreDuplicates: false })
    }

  } catch (err: any) {
    status       = 'error'
    actionTaken  = 'error'
    errorMessage = err.message ?? String(err)
    console.error('[error] airtable-client-sync:', errorMessage)
  }

  const { error: syncLogError } = await supabase.from('sync_log').insert({
    direction: 'airtable_to_ghl', trigger_event: 'client_created',
    email: email ?? null, match_method: matchMethod,
    airtable_record_id: airtableRecordId ?? null, ghl_contact_id: ghlContactId ?? null,
    action_taken: actionTaken, status, error_message: errorMessage, payload_in: payload,
  })
  // Logging failure must never change the HTTP response — log and continue.
  if (syncLogError) {
    console.error('[error] sync_log insert failed:', JSON.stringify(syncLogError))
  }

  return new Response(
    JSON.stringify({ success: status === 'success', action: actionTaken, ghlContactId }),
    { status: status === 'success' ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  )
})
