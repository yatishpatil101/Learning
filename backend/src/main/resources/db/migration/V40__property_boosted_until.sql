-- ============================================================================================
-- V40__property_boosted_until.sql — make a paid boost actually influence ranking (tech-debt D59).
--
-- THE GAP
-- -------
-- An owner could buy a boost pack, the money settled, `boosts` recorded an `active` row with a
-- start and end — and nothing anywhere read it. `BoostService.listForListing` says so out loud:
-- "a boost does not yet influence ranking". The public search ordered by `created_at DESC` and had
-- no idea the boosts table existed. We were charging for a promotion that did not promote.
--
-- THE FIX
-- -------
-- A denormalized `boosted_until` column mirrors the end of the listing's newest active promotion
-- window onto the property, so the catalogue read path can rank promoted listings first WITHOUT a
-- join into billing and without an N+1 per search row. This is the same read-side-mirror shape as
-- `deal_status` in V37 (D110), for the same reason: `billing.boost` already depends on `catalog`
-- (BoostService reads PropertyRepository), so a catalogue read of the boosts table would invert
-- that dependency and close a package cycle. BoostService writes this column in the same
-- transaction as every activation.
--
-- WHY IT IS NOT SWEPT BACK TO NULL
-- --------------------------------
-- A past value means "the window closed", and it is left in place rather than nulled by a job.
-- The ranking predicate therefore compares `boosted_until > now()` instead of trusting a nullable
-- flag to be current, which means correctness does not depend on a sweeper having run recently.
-- It also keeps "when did this listing last run a promotion" answerable from the catalogue row.
--
-- WHY NULLABLE RATHER THAN NOT NULL DEFAULT
-- -----------------------------------------
-- Most listings have never been boosted, and NULL says exactly that. A sentinel epoch default
-- would make "never promoted" and "promoted long ago" indistinguishable, and would bloat the
-- partial index below from the small promoted set to every row in the table.
-- ============================================================================================

alter table properties
    add column boosted_until timestamptz;

comment on column properties.boosted_until is
    'Read-side mirror (D59) of the end of this listing''s newest active boost window. Written by '
    'BoostService in the same transaction as activation. NULL = never boosted; a past value = the '
    'window has closed. Ranking compares against now(), so stale values are harmless.';

-- Serves "which listings are currently promoted" (ops/reporting and the mirror's own maintenance).
-- Partial, because the promoted set is a small fraction of the catalogue and the NULL majority is
-- never the answer to that question.
create index idx_properties_boosted_until
    on properties (boosted_until desc)
    where boosted_until is not null;
