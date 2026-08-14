-- Fixups2 for phase_b_estimates_schema, from the final whole-branch review.
-- The estimates-schema and fixups migrations are applied and immutable;
-- corrections land here.

-- (Fix 1) Widen dump_count precision. The golden fixture contains real live
-- dump counts of 0.25, 0.35, and 1.25 loads (estimates 1236, 1131, 1295,
-- 1296) which numeric(5,1) would silently round to one decimal place,
-- re-pricing those estimates. numeric(6,2) preserves two decimal places of
-- fractional dump loads without changing any currently-stored value (all
-- tables are empty).
alter table estimates
  alter column dump_count type numeric(6,2);

alter table estimate_line_items
  alter column dump_count type numeric(6,2);

alter table scope_library
  alter column default_dump_count type numeric(6,2);

-- (Fix 2) Version-chain constraint.
--
-- Writer contract: an insert with version > 1 must supply the parent
-- estimate's estimate_number explicitly (the estimate_number_seq-backed
-- default is only correct for new version-1 rows — a version > 1 row that
-- let the default fire would mint a *new* estimate_number instead of
-- continuing the existing one) and must set supersedes_estimate_id to the
-- id of the row it corrects. A version-1 row has no parent and
-- supersedes_estimate_id is optional (normally null).
alter table estimates
  add constraint version_chain
  check (version = 1 or supersedes_estimate_id is not null);
