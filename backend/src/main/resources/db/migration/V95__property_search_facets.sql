-- V95 — the six listing facets the browser invented.
--
-- WHAT WAS WRONG. The listings page has filtered on landUse, ageYears, room, tenants, availableFrom
-- and pets since it was written, and not one of them had a column. They worked because the mock
-- store made them up. Against the live API the http mapper never produces these fields, so the
-- filter compares a selected value against `undefined` and every listing falls out: picking "pets
-- allowed", or a tenant type, or a land use, returned an empty page. Silently. The mock hid a
-- live-mode dead end for the entire life of the feature.
--
-- WHY COLUMNS AND NOT DELETION (D26 decision B). These are not decorative. Land zoning decides
-- whether a plot is even legal for the buyer's purpose; tenant preference is the single most
-- common reason a rental enquiry is wasted on both sides; pets is a hard yes/no that a tenant
-- should never have to ask about twice. They are worth having for real, which means the owner has
-- to be able to declare them and the query has to be able to filter on them.
--
-- WHY THIS BLOCKS PAGINATION. Filtering cannot be split. If even one facet stays in the browser,
-- the server hands back page N and the client thins it after arrival -- so the page is short, the
-- total is wrong, and rows the reader should have seen were never requested. Correct paging needs
-- every predicate in the same query, which is why these six had to land before the search moves.

ALTER TABLE properties
    -- Zoning for open plots and farm land, which are sold by permitted use rather than by
    -- bedrooms. Mirrors the "Post a property" plotZoneOptions so a plot is searchable by exactly
    -- the zoning its owner declared. NULL for everything that is a building.
    ADD COLUMN land_use text
        CHECK (land_use IN ('residential', 'commercial', 'industrial', 'agricultural', 'mixed')),

    -- Age of the construction in years. NULL means unstated, which is NOT the same as zero -- a
    -- new launch is 0, an owner who never answered is NULL, and a range filter must not treat the
    -- second as the first. There is deliberately no upper bound: Pune has Peth houses older than
    -- any ceiling worth hard-coding, and the filter's own 25 is a "25+" open top.
    ADD COLUMN age_years integer CHECK (age_years >= 0),

    -- Flatmate room shape: a private room in a shared flat, or a bed in a shared room. Only
    -- meaningful for flatmate listings; NULL everywhere else.
    ADD COLUMN room text CHECK (room IN ('single', 'shared')),

    -- Who the owner will rent to. A set, not a single value -- "family or company, no bachelors"
    -- is the common Pune position and cannot be expressed as one enum. jsonb array of the same
    -- four tokens the filter offers; an empty array means "no stated preference", which the query
    -- must read as "matches every tenant filter" rather than "matches none".
    ADD COLUMN tenants jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- How soon the tenant can move in, as a bucket rather than a date. The filter is cumulative:
    -- asking for "within 30 days" must also return 'now' and '15'. Buckets keep that honest
    -- without a date that goes stale the moment nobody edits the listing.
    ADD COLUMN available_from text CHECK (available_from IN ('now', '15', '30')),

    -- Hard yes/no. NOT NULL with a false default because "unstated" and "no" mean the same thing
    -- to a tenant with a dog -- they will not risk it either way -- so an extra NULL state would
    -- buy nothing and complicate every predicate.
    ADD COLUMN pets boolean NOT NULL DEFAULT false,

    -- PG / hostel occupancy: how many people to a room. A set, because one PG almost always offers
    -- several -- a single room, a double, a triple -- at different rents, and a listing that could
    -- only claim one occupancy would have to be posted three times.
    --
    -- Its own column rather than the amenity list it was being read out of. The client's
    -- `offersSharing()` inferred occupancy from amenity tokens, which meant the filter was matching
    -- on a field nobody fills in for that purpose: an honest PG that listed 'wifi' and 'meals' but
    -- not an occupancy-shaped amenity simply disappeared from the sharing filter. Occupancy is a
    -- property of the room, not a facility offered with it.
    ADD COLUMN sharing jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN properties.land_use     IS 'Permitted zoning for plots/farm land. NULL for buildings.';
COMMENT ON COLUMN properties.age_years    IS 'Construction age in years. NULL = unstated, 0 = new. No upper bound.';
COMMENT ON COLUMN properties.room         IS 'Flatmate room shape: single (private) or shared (per bed).';
COMMENT ON COLUMN properties.tenants      IS 'Accepted tenant types. Empty array = no stated preference = matches any filter.';
COMMENT ON COLUMN properties.available_from IS 'Move-in bucket: now | 15 | 30. Cumulative when filtered.';
COMMENT ON COLUMN properties.pets         IS 'Pets allowed. false also covers unstated.';
COMMENT ON COLUMN properties.sharing      IS 'PG occupancy options: single|double|triple|four|five. Empty = not a PG.';

-- Only the two jsonb facets earn an index. They are the ones queried by containment rather than
-- equality, and a btree cannot serve jsonb @>. The other five are low-cardinality booleans and
-- small enums over a table the public search has already narrowed to approved-and-not-archived; a
-- btree on a column with five distinct values is one the planner will decline to use, so adding
-- them would cost write throughput and buy nothing.
CREATE INDEX idx_properties_tenants ON properties USING gin (tenants jsonb_path_ops);
CREATE INDEX idx_properties_sharing ON properties USING gin (sharing jsonb_path_ops);
