insert into pricing_variables (key, value, description) values
  ('labor_rate_per_hour',   26,     'Standard estimating labor rate. True all-in cost ~ $23.13/hr (DISCOVERY §5) — do NOT correct in isolation; see the four-pads rule.'),
  ('overhead_rate_per_hour',23,     'Overhead allocation per productive hour.'),
  ('dump_rate_per_load',    300,    'PRICING RATE per dump load, not a cost. Median actual cost $65 — the spread is deliberate risk pricing (DISCOVERY §4).'),
  ('cc_fee_rate',           0.035,  'Credit card fee charged on every estimate. Live-verified against all 321 estimates; the Airtable 3% row was never live.'),
  ('default_markup_pct',    25,     'Default cost-plus MARKUP (an entered 25 realises ~19.3% true margin).'),
  ('markup_floor_pct',      15,     'Advisory floor for per-job markup override (realises ~12.6% true margin).');

insert into scope_library (name, default_description, default_labor_hours, default_dump_count, airtable_record_id) values
  ('Flooring Removal', 'Remove existing flooring throughout designated areas. Ensure proper preparation of substrate. Provide dust control and protection of adjacent areas. Haul off all debris and dump.', 6, 1, 'rec0BGZ3OQ32F2FuI'),
  ('Exterior Demo', 'Remove designated exterior materials including siding, stucco, soffit, and fascia as specified. Haul off all debris and dump.', 16, 2, 'rec2SsAO3X5dwvxIg'),
  ('Jobsite Cleanup', 'Final broom-clean of all designated interior and exterior areas. Remove remaining debris and haul off. Leave jobsite in clean condition.', 3, 1, 'rec4SKUFezO7vsCK9'),
  ('Cabinet Removal', 'Remove and save or dispose of cabinets as designated. Ensure proper protection of adjacent surfaces. Haul off all debris and dump.', 4, 1, 'rec7Kgs56UoirhuuD'),
  ('Bathroom Demo', 'Full bathroom demolition including tile, fixtures, vanity, and drywall as designated. Ensure proper protection of adjacent areas. Haul off all debris and dump.', 6, 1, 'rec7PVHoI8KJD98ZC'),
  ('Concrete Demo', 'Break up and remove designated concrete. Haul off all concrete and dump at approved facility.', 8, 2, 'recDFf1ObCR4G0bfy'),
  ('Shed-Structure Removal', 'Demolish and remove designated structure. Haul off all debris and dump.', 6, 1, 'recFaqaGzB5FreUFm'),
  ('Ceiling Demo', 'Remove ceiling material in designated areas. Provide dust control and floor protection throughout. Haul off all debris and dump.', 5, 1, 'recM0XYNnNElcOg0N'),
  ('Stair-Trim Demo', 'Remove stair finishes and trim throughout designated areas. Haul off all debris and dump.', 4, 1, 'recMKBe5wuqdv97Os'),
  ('Pool-Water Feature Demo', 'Demolish and remove designated water feature or pool structure. Haul off all debris and dump at approved facility.', 16, 2, 'recOAeUEmPJfY87rJ'),
  ('Kitchen Demo', 'Remove and haul off all kitchen cabinets, countertops, and backsplash. Ensure proper floor and wall protection throughout. Haul off all debris and dump.', 8, 1, 'recROUVpC6Yhw5tWq'),
  ('Fireplace Demo', 'Demolish designated fireplace and surround. Provide dust control, floor protection, and plastic barriers. Haul off all debris and dump.', 6, 1, 'recSKWDgqmR6FFJc2'),
  ('Junk Removal-Cleanout', 'Remove all designated junk and debris from property. Haul off and dump at approved facility.', 4, 1, 'recYj88oPbfgj7ZQ0'),
  ('Window-Door Removal', 'Remove designated windows and doors. Protect surrounding surfaces. Haul off all debris and dump.', 4, 1, 'receEdjYpgB15PFPs'),
  ('Deck-Patio Removal', 'Remove designated deck or patio structure. Haul off all debris and dump.', 8, 1, 'recnyGG4gTGbV6nTX'),
  ('Carport Removal', 'Remove designated carport structure. Haul off all debris and dump.', 6, 1, 'recra0JwRStTFMIBP'),
  ('Construction Debris Hauling', 'Load and haul off all construction debris from designated areas. Dump at approved facility.', 4, 1, 'recsE1PBOYqAKsTxB'),
  ('Drywall-Wall Demo', 'Remove drywall and framing in designated areas per plans. Ensure proper dust control and protection of adjacent surfaces. Haul off all debris and dump.', 6, 1, 'recv1hBnDrjL1u92v'),
  ('Full House Gut', 'Complete interior demolition down to studs including flooring, walls, ceilings, trim, and fixtures as designated. Provide dust control and floor protection throughout. Haul off all debris and dump.', 40, 4, 'recvnRdWHLQCCJCoL');
