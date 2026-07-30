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

async function searchGhlByEmail(email: string) {
  const res = await fetch(
    `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
  )
  const data = await res.json()
  return data.contacts?.[0] ?? null
}

async function createGhlContact(fields: Record<string, any>) {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationId: GHL_LOCATION_ID, ...fields })
  })
  const data = await res.json()
  console.log('[ghl] create contact response:', JSON.stringify(data))
  return data
}

async function updateGhlContact(ghlContactId: string, fields: Record<string, any>) {
  const res = await fetch(`${GHL_BASE}/contacts/${ghlContactId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  })
  const data = await res.json()
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
    const ghlFields = {
      firstName,
      lastName,
      email,
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
        ghlContactId = existing.id
        await updateGhlContact(existing.id, ghlFields)
        actionTaken  = 'updated'
      } else {
        matchMethod       = 'none'
        const created     = await createGhlContact(ghlFields)
        ghlContactId      = extractGhlContactId(created)

        // GHL returns 400 with meta.contactId when duplicate contacts are not allowed
        if (!ghlContactId && created?.statusCode === 400 && created?.meta?.contactId) {
          console.log(`[ghl] Duplicate blocked — using existing contact ID: ${created.meta.contactId}`)
          ghlContactId = created.meta.contactId
          matchMethod  = 'email_duplicate'
          actionTaken  = 'matched_existing'
        } else if (!ghlContactId) {
          throw new Error(`GHL contact create returned no ID. Full response: ${JSON.stringify(created)}`)
        } else {
          actionTaken = 'created'
        }
      }
      if (ghlContactId && airtableRecordId) {
        await writeGhlIdToAirtable(airtableRecordId, ghlContactId)
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

  await supabase.from('sync_log').insert({
    direction: 'airtable_to_ghl', trigger_event: 'client_created',
    email: email ?? null, match_method: matchMethod,
    airtable_record_id: airtableRecordId ?? null, ghl_contact_id: ghlContactId ?? null,
    action_taken: actionTaken, status, error_message: errorMessage, payload_in: payload,
  })

  return new Response(
    JSON.stringify({ success: status === 'success', action: actionTaken, ghlContactId }),
    { status: status === 'success' ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  )
})
