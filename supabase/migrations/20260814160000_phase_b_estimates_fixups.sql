-- Fixups for phase_b_estimates_schema, from the Task 3 review.
-- The estimates-schema migration is applied and immutable; corrections land here.

-- (Finding 1, Important) Pin search_path; schema-qualify. Advisor:
-- function_search_path_mutable. Same body, same name — the existing
-- estimates_immutable trigger binding survives CREATE OR REPLACE.
create or replace function public.enforce_estimate_immutability() returns trigger
language plpgsql
set search_path = public
as $$
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

-- (Finding 2, Important, per controller ruling) Immutability stops at the
-- estimates header — extend it. estimate_line_items rows can be freely
-- UPDATEd/DELETEd after insert today, and `delete from estimates` is
-- unguarded and cascades line items away. Versioning creates new rows, so
-- no legitimate edit/delete path exists for either table.

create function public.enforce_estimate_line_item_immutability() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'estimate line items are immutable — write a new version row instead (line item %)',
    coalesce(old.id, new.id);
  return old;
end $$;

create trigger estimate_line_items_immutable
  before update or delete on public.estimate_line_items
  for each row execute function public.enforce_estimate_line_item_immutability();

create function public.enforce_estimate_no_delete() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'estimates are immutable — write a new version row instead (estimate %)', old.estimate_number;
  return old;
end $$;

create trigger estimates_no_delete
  before delete on public.estimates
  for each row execute function public.enforce_estimate_no_delete();
