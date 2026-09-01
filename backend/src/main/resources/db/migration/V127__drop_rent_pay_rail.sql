-- Withdraw the online rent-collection rail.
--
-- PuneNest never shipped rent collection: there is no gateway account configured to receive a
-- tenant's rent, no payout mechanism to remit it to the landlord, and no reconciliation. What
-- existed was scaffolding — three tables, four endpoints and a webhook branch — kept alive by
-- fixtures and by nothing else. `/pay-rent` is now a static "coming soon" page with no server
-- behind it, so the scaffolding is removed rather than left as a half-built money path that the
-- next reader has to prove is inert.
--
-- Why a drop and not an archive. These tables hold no production data: no environment has ever
-- taken a rupee of rent through them, so there is nothing to preserve and nothing to migrate.
-- Leaving them empty would be worse than dropping them — an empty `rent_payments` reads to an
-- operator as "no rent was collected this month", which is a claim about trading, when the truth
-- is that the product does not exist.
--
--   rent_payments   — one billed or settled rent instalment, child of `tenancies`
--   rent_mandates   — the tenant's standing instruction to auto-debit, child of `tenancies`
--   payout_accounts — where a landlord's remittance would have gone; nothing ever wrote one
--
-- `tenancies` is the PARENT of the first two and stays: a tenancy is a lettings fact (who lives
-- where, on what term) and it backs My Rental, the tenant profile and the owner's own rent-receipt
-- log, none of which move money. Dropping only the children is what keeps that distinction intact.
--
-- CASCADE is here for the indexes and constraints declared on these tables in V14 and V46, not to
-- reach anything outside them: nothing else in the schema references these three.
DROP TABLE IF EXISTS rent_payments CASCADE;
DROP TABLE IF EXISTS rent_mandates CASCADE;
DROP TABLE IF EXISTS payout_accounts CASCADE;

-- The convenience fee that priced a rent payment. Published on /pricing until this release; with
-- no rent rail there is nothing for it to be a percentage of, and a fee quoted for a product that
-- cannot be bought is a promise the platform cannot keep. Removed from the seed block in
-- R__seed_reference_data.sql as well, but that file only INSERTs on a fresh row — an environment
-- seeded before this release still carries the key, so it is stripped here too.
UPDATE settings
   SET value = value - 'rentPayPercent'
 WHERE key = 'fees';
