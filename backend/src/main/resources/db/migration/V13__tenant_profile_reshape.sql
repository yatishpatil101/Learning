-- V13 Slice 5: reshape tenant_profiles to the profile the product actually collects (spec fix S21).
--
-- V6's tenant_profiles was authored from the original TenantProfile schema: name, occupation,
-- employer, family_size, preferred_localities, budget. The tenant profile the frontend actually
-- ships (pages/consumer/TenantProfile.jsx) asks for name, occupation, monthly income, WHO will
-- live in the home, an earliest move-in date, a prior-landlord reference, and a short
-- introduction. Only `name` and `occupation` were ever in both.
--
-- This is not a naming mismatch that a mapper could paper over. The trust score owners screen on
-- is built from idVerified(30) + occupation(20) + income(15) + priorLandlord(15) + about(10) +
-- occupants(10). Four of those six inputs had no column here, so a server honouring V6 could
-- compute at most 50 out of 100 -- every tenant's score would have halved the moment the UI
-- stopped reading its mock. The columns are the score.
--
-- family_size -> occupants is the load-bearing change. An integer cannot say "Bachelor (Male)",
-- and in Pune that is the attribute owners and societies decide on -- many refuse bachelors
-- outright, and a company lease is a different counterparty again. Storing 3 where the tenant
-- said "Bachelor (Male)" does not lose precision, it loses the fact.
--
-- employer / preferred_localities / budget are dropped rather than left NULL forever: no screen
-- has ever written them, and a column nothing fills is a column the next author has to
-- investigate. income replaces budget -- what a tenant earns is what an owner screens on, and it
-- is what the form asks for.
--
-- Safe to drop destructively: tenant_profiles has no production data (the backend has never
-- served these endpoints) and no table references it.

ALTER TABLE tenant_profiles DROP COLUMN employer;
ALTER TABLE tenant_profiles DROP COLUMN family_size;
ALTER TABLE tenant_profiles DROP COLUMN preferred_localities;
ALTER TABLE tenant_profiles DROP COLUMN budget;

-- Monthly income in whole INR, matching the contract's Money and the rest of the schema's bigint
-- money convention. Nullable: the score rewards supplying it, nothing requires it.
ALTER TABLE tenant_profiles ADD COLUMN income bigint;

-- The occupant type. CHECK-constrained rather than left free text: this is a screening facet, so
-- an unrecognised value would silently drop the profile out of an owner's filter instead of
-- failing loudly. Values match the contract enum exactly.
ALTER TABLE tenant_profiles ADD COLUMN occupants text
    CHECK (occupants IN ('family', 'bachelor_male', 'bachelor_female', 'company_lease'));

-- Earliest date the tenant can move in. Owners match this against a listing's availability.
ALTER TABLE tenant_profiles ADD COLUMN move_in date;

-- Free text on both: a prior-landlord reference is a name and a number as the tenant wrote them,
-- and the introduction is prose. Neither is ever parsed.
ALTER TABLE tenant_profiles ADD COLUMN prior_landlord text;
ALTER TABLE tenant_profiles ADD COLUMN about          text;

-- Verified tenants first, then by score -- the order an owner reviewing applicants wants, and the
-- only ordering these rows are ever read in. tenant_profiles is keyed by user_id, so single-row
-- reads already ride the primary key and need nothing here.
CREATE INDEX idx_tenant_profiles_screening ON tenant_profiles (verified DESC, score DESC);

-- ---------------------------------------------------------------------------------------
-- Redundant tenancy indexes left by V12.
--
-- V12 added idx_tenancies_owner_status (owner_id, status) and idx_tenancies_tenant_status
-- (tenant_id, status). V6's idx_tenancies_owner (owner_id) and idx_tenancies_tenant (tenant_id)
-- are now strict prefixes of those, so Postgres can serve every query the single-column indexes
-- served from the composite ones. Keeping both costs a write amplification on every tenancy
-- insert and update for no read benefit.
DROP INDEX idx_tenancies_owner;
DROP INDEX idx_tenancies_tenant;
