// Lifted verbatim from airtable-job-scheduled/index.ts (see
// docs/superpowers/plans/2026-08-13-phase-a-job-record.md, Task 2), with `export` keywords
// added. Do not refactor internals.

export function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function base64urlEncode(input: string | ArrayBuffer): string {
  let bytes: Uint8Array
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input)
  } else {
    bytes = new Uint8Array(input)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  // replace any double-escaped newlines that survive JSON paste into Supabase env
  const privateKey  = sa.private_key.replace(/\\n/g, '\n')
  const clientEmail = sa.client_email

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // 30s backdating guards against clock skew between Supabase edge runtime and Google
  const now    = Math.floor(Date.now() / 1000) - 30
  const header = base64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64urlEncode(JSON.stringify({
    iss:   clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }))
  const signingInput = `${header}.${claims}`

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${base64urlEncode(signature)}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

export async function createCalendarEvent(calendarId: string, accessToken: string, eventBody: any): Promise<any> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Calendar event create failed (${res.status}): ${JSON.stringify(data)}`)
  return data
}

// Google Calendar all-day end dates are exclusive — add 1 day to the actual end
export function addOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function formatCurrency(amount: number): string {
  return `$${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── v2 Task 5A additions (integration-dispatcher) — additive only, nothing
//    above this line changes. Same style as createCalendarEvent: encodeURIComponent
//    on path params, error text extraction on !res.ok. ──────────────────────

export async function updateCalendarEvent(calendarId: string, eventId: string, accessToken: string, eventBody: any): Promise<any> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Calendar event update failed (${res.status}): ${JSON.stringify(data)}`)
  return data
}

// 404/410 (event already gone, e.g. deleted by a human on the calendar, or a
// prior fire's DELETE already succeeded but the id wasn't cleared before a
// crash) must NOT throw — the caller treats "already gone" as success, per
// the v2 Task 5 spec.
export async function deleteCalendarEvent(calendarId: string, eventId: string, accessToken: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )
  if (res.ok || res.status === 404 || res.status === 410) return
  const data = await res.json().catch(() => ({}))
  throw new Error(`Calendar event delete failed (${res.status}): ${JSON.stringify(data)}`)
}

// ── v2 Task 5B additions (google-calendar-webhook, inbound sync) — additive
//    only, nothing above this line changes. ──────────────────────────────

// 404/410 are DATA for the inbound sync leg (the event was deleted), not
// errors — unlike updateCalendarEvent, whose 404 is a failure. Any other
// non-OK status throws with the same error-text shape as its siblings.
export async function getCalendarEvent(calendarId: string, eventId: string, accessToken: string): Promise<{ status: number; event: any | null }> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (res.status === 404 || res.status === 410) return { status: res.status, event: null }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Calendar event fetch failed (${res.status}): ${JSON.stringify(data)}`)
  return { status: res.status, event: data }
}
