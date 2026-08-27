# Owner promotion + Supabase Auth configuration runbook

v2 Task 8a (Session 14, 2026-08-27). Run at the session's production gate,
each step on Matt's explicit go. Idempotent; re-runnable.

## 1. Supabase Auth configuration (dashboard, Matt or MCP-assisted)

Project `eiqqqwajmcpcwhvxxnhx` → Authentication → URL Configuration:

- **Site URL:** `https://lostboysdemolition.vercel.app`
- **Additional redirect URLs:**
  - `https://lostboysdemolition.vercel.app/auth/confirm`
  - `http://localhost:3000/auth/confirm`

Authentication → Sign In / Providers → Email: magic link enabled (default).
Signups are NOT disabled project-wide — the app passes
`shouldCreateUser: false` instead, so only dashboard-invited emails can
sign in. Note: Supabase's built-in email sender is rate-limited (a few
emails/hour) — fine for 1–2 owners; revisit (custom SMTP) before Task 8b
onboards foremen.

Authentication → Emails (email templates) — REQUIRED, sign-in dead-ends
without this:

- **Magic Link template:** replace the default `{{ .ConfirmationURL }}`
  link with:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/`
- **Invite user template** (used for Dane later, §4): replace its link
  with:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/`
- Why: the app's `/auth/confirm` route verifies `token_hash`+`type`
  server-side (the Supabase SSR pattern); the default
  `{{ .ConfirmationURL }}` flow never reaches it. `next` is pinned to `/`
  by the template — after sign-in an active owner lands on `/`, which
  routes to `/jobs` (the deep-link `next` passed at sign-in time is
  intentionally not round-tripped through the email; known accepted
  limitation).
- Verify after saving: request a magic link from `/auth/sign-in` and
  confirm the email's link points at
  `https://lostboysdemolition.vercel.app/auth/confirm?token_hash=...&type=email&next=/`.

## 2. Promote Matt (one-time, service-role)

Read first:

    select auth_user_id, display_name, role, active
    from public.workforce_profiles;

Expected: exactly one row — display_name 'Matt', role 'pending',
active false. Then:

    update public.workforce_profiles
    set role = 'owner', active = true, updated_at = now()
    where display_name = 'Matt' and role = 'pending';

Verify: re-run the select; expect role 'owner', active true. This is the
deferred Task 0B "owner promotion" step — the only service-role identity
write in the system.

## 3. Live smoke (read-only)

1. Matt: `/auth/sign-in` → email → tap the emailed link → lands `/`,
   which redirects to `/jobs`.
2. `/jobs`, `/jobs/JOB-1108`, `/jobs/exceptions` render with the
   "Signed in as Matt · Sign out" bar.
3. Incognito window: `/` → `/estimates`; `/jobs` → `/auth/sign-in?next=/jobs`;
   `/estimates` + the picker work exactly as before.
4. Sign out → `/` → `/estimates` again.

## 4. Dane, later (deferred by Matt's Session-14 ruling)

1. Dashboard → Authentication → Users → **Invite user** with Dane's email.
2. Dane opens the invite link → auth user created → `on_auth_user_created`
   inserts his `workforce_profiles` row (`pending`/`inactive`).
3. Repeat §2's update for Dane's row (match on his `auth_user_id`).
4. §3 smoke from Dane's phone.
