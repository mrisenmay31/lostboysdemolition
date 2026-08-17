-- BL-4: crew Slack message fields on public.jobs.
--
-- The crew notification today is four thin lines (job name, date, address, client).
-- Matt's target format adds the client's business name, a contact person, a phone
-- number, a start time, and the job scope. The blocker was never formatting — the
-- jobs table simply had nowhere to put any of it. This adds those columns.
--
-- This is a restoration, not an invention: the retired airtable-job-scheduled
-- function built exactly this block (index.ts:241-271) and Phase A's rebuild
-- dropped it because the Postgres fields didn't exist yet.
--
-- Net new GHL API calls to populate these: ZERO. The Quote Accepted leg already
-- does GET /contacts/{id} (holding phone, companyName, firstName, lastName) and
-- the schedule leg already does GET /opportunities/{id} (holding every custom
-- field, of which it currently reads three). Everything below is data already in
-- hand and previously discarded.
--
-- All columns nullable: every one is omitted from the Slack message when blank,
-- and backfilling the 2 existing (cancelled test) rows is pointless.

alter table jobs
  -- Person to ask for on site. NB: this is deliberately NOT redundant with
  -- client_name. _shared/job.ts clientLabel() collapses a contact down to
  -- companyName || lastName || firstName, so for any company contact
  -- client_name IS the business name and the human's name is lost. Matt's
  -- format wants both lines ("Ann Morrison" / "Morrison Construction"), which
  -- is unachievable without storing the person separately.
  add column if not exists client_contact_name text,
  -- GHL contact companyName. Rendered only when present AND different from the
  -- contact name, since clientLabel() can legitimately make the two identical.
  add column if not exists business_name text,
  add column if not exists client_phone text,
  -- TEXT, matching GHL's "Job Start Time" custom field (qJOGxmXtwExCNpoBrp1h),
  -- which is a TEXT field, not a time. Stored and rendered as free text — no
  -- parsing, no over-modelling. Matt confirmed 2026-08-14 this field is not
  -- reliably populated today; the line is omitted when blank, so it simply
  -- lights up if Dane starts filling it in.
  add column if not exists start_time text,
  -- Pre-rendered, possibly multi-line scope text. Hybrid source (Matt's
  -- decision): the linked estimate's line items when an estimate is linked,
  -- falling back to the GHL "Job Scope" multi-select names when it is not.
  -- Never carries money — see the comment below.
  add column if not exists scope_summary text;

comment on column jobs.client_contact_name is
  'Person at the client (GHL contact firstName + lastName). Separate from client_name because clientLabel() collapses company contacts to the company name.';

comment on column jobs.business_name is
  'GHL contact companyName. Rendered in crew messages only when non-empty and different from client_contact_name.';

comment on column jobs.start_time is
  'Free text, mirroring GHL custom field qJOGxmXtwExCNpoBrp1h (TEXT). Not parsed. Frequently blank — omitted from crew messages when so.';

comment on column jobs.scope_summary is
  'Pre-rendered crew-facing scope. MUST NOT contain pricing: no total bid, quoted price, markup, margin, hours or dump counts. The GHL "Scope Notes" field (PdNTCRzIpYi3IANr71eh) must never be forwarded raw into this column — it carries all of those.';
