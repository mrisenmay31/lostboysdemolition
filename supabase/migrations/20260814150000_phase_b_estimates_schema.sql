-- Phase B slice 1: canonical estimating schema.
-- Estimates are immutable versioned snapshots (BUILD_PLAN.md design decision 1):
-- computed + input columns are frozen by trigger; a correction is a NEW version row.

create table scope_library (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_description text not null default '',
  default_labor_hours numeric(6,2) not null,
  default_dump_count numeric(5,1) not null,
  default_materials_cost numeric(10,2),  -- NULL until Phase G seeds it from actuals
  job_type_applicability text[] not null default '{Residential,Commercial}',
  active boolean not null default true,
  airtable_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pricing_variables (
  key text primary key,
  value numeric(10,4) not null,
  description text not null default '',
  effective_from date not null default current_date,
  updated_at timestamptz not null default now()
);

create sequence estimate_number_seq start 1400;  -- 1001–1321 reserved for Airtable history

create type estimate_status as enum
  ('draft','sent','accepted','declined','superseded','historical');

create table estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number int not null default nextval('estimate_number_seq'),
  version int not null default 1,
  supersedes_estimate_id uuid references estimates(id),
  status estimate_status not null default 'draft',
  -- context (free text mirrors today's reality; job link set at promotion)
  job_number text references jobs(job_number),
  job_name text,
  client_name text,
  client_type text check (client_type in ('Contractor','Homeowner')),
  client_email text,
  client_phone text,
  job_address text,
  city text,
  job_type text check (job_type in ('Residential','Commercial')),
  estimate_date date not null default current_date,
  job_details text,
  -- inputs (what the estimator chose)
  labor_method text not null check (labor_method in ('total_hours','days_employees')),
  total_job_hours numeric(7,2),
  days_at_job numeric(5,2),
  num_employees numeric(5,2),
  dump_count numeric(5,1) not null default 0,       -- fractional allowed (0.5 live)
  job_specific_costs numeric(10,2) not null default 0,
  markup_pct numeric(5,2) not null,                 -- cost-plus MARKUP, not margin
  -- rate snapshot (so historical estimates stay reproducible if rates change)
  labor_rate numeric(6,2) not null,
  overhead_rate numeric(6,2) not null,
  dump_rate numeric(6,2) not null,
  cc_fee_rate numeric(6,4) not null,
  -- engine outputs (written by computeEstimate, never hand-edited)
  labor_cost numeric(12,2) not null,
  dump_fees numeric(12,2) not null,
  total_direct numeric(12,2) not null,
  overhead numeric(12,2) not null,
  profit numeric(12,2) not null,
  cc_fee numeric(12,2) not null,
  total_bid numeric(12,2) not null,
  true_margin_pct numeric(5,2) not null,
  -- what was ACTUALLY quoted, when it differs from the calculation
  -- (live finding: Dane discounted a $41,038.43 calc to $39,000 with no field to record it)
  quoted_price numeric(12,2),
  quote_override_reason text,
  source text not null default 'app' check (source in ('app','airtable_backfill')),
  airtable_estimate_id int,
  created_at timestamptz not null default now(),
  unique (estimate_number, version),
  constraint labor_method_fields check (
    (labor_method = 'total_hours' and total_job_hours is not null)
    or
    (labor_method = 'days_employees' and days_at_job is not null and num_employees is not null)
  )
);

create table estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  scope_library_id uuid references scope_library(id),
  name text not null,                    -- snapshot of the Scope Library name (controlled vocabulary)
  description text not null default '',
  labor_hours numeric(7,2) not null default 0,
  dump_count numeric(5,1) not null default 0,
  materials_cost numeric(10,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Immutability: after insert, only status / quoted_price / quote_override_reason /
-- job_number may change. Anything else must be a new version row.
create function enforce_estimate_immutability() returns trigger
language plpgsql as $$
begin
  if new.id                    is distinct from old.id
    or new.estimate_number     is distinct from old.estimate_number
    or new.version             is distinct from old.version
    or new.supersedes_estimate_id is distinct from old.supersedes_estimate_id
    or new.job_name            is distinct from old.job_name
    or new.client_name         is distinct from old.client_name
    or new.client_type         is distinct from old.client_type
    or new.client_email        is distinct from old.client_email
    or new.client_phone        is distinct from old.client_phone
    or new.job_address         is distinct from old.job_address
    or new.city                is distinct from old.city
    or new.job_type            is distinct from old.job_type
    or new.estimate_date       is distinct from old.estimate_date
    or new.job_details         is distinct from old.job_details
    or new.labor_method        is distinct from old.labor_method
    or new.total_job_hours     is distinct from old.total_job_hours
    or new.days_at_job         is distinct from old.days_at_job
    or new.num_employees       is distinct from old.num_employees
    or new.dump_count          is distinct from old.dump_count
    or new.job_specific_costs  is distinct from old.job_specific_costs
    or new.markup_pct          is distinct from old.markup_pct
    or new.labor_rate          is distinct from old.labor_rate
    or new.overhead_rate       is distinct from old.overhead_rate
    or new.dump_rate           is distinct from old.dump_rate
    or new.cc_fee_rate         is distinct from old.cc_fee_rate
    or new.labor_cost          is distinct from old.labor_cost
    or new.dump_fees           is distinct from old.dump_fees
    or new.total_direct        is distinct from old.total_direct
    or new.overhead            is distinct from old.overhead
    or new.profit              is distinct from old.profit
    or new.cc_fee              is distinct from old.cc_fee
    or new.total_bid           is distinct from old.total_bid
    or new.true_margin_pct     is distinct from old.true_margin_pct
    or new.source              is distinct from old.source
    or new.airtable_estimate_id is distinct from old.airtable_estimate_id
    or new.created_at          is distinct from old.created_at
  then
    raise exception 'estimates are immutable — write a new version row instead (estimate %)', old.estimate_number;
  end if;
  return new;
end $$;

create trigger estimates_immutable
  before update on estimates
  for each row execute function enforce_estimate_immutability();

-- RLS posture: enabled, no policies (service_role bypasses; anon denied).
alter table scope_library enable row level security;
alter table pricing_variables enable row level security;
alter table estimates enable row level security;
alter table estimate_line_items enable row level security;

create index estimates_job_number_idx on estimates (job_number);
create index estimates_status_idx on estimates (status);
create index estimate_line_items_estimate_idx on estimate_line_items (estimate_id);
