-- users.listings_count has been declared since V2 and written by nothing. No Java code ever set it,
-- so for every account the application itself created it has read 0 since the beginning -- while the
-- demo seed hardcoded plausible values, which is why dev and e2e never showed the gap.
--
-- ListingService now increments it at the single creation choke point (`createOnBehalf`, which
-- `create` delegates to, so the concierge desk and self-serve both count). That fixes accounts from
-- here on; this backfills the ones already in the table.
--
-- Counts EVERY row, including rejected and archived listings, because that is what this column
-- means: "has this person ever posted", the persona behind exactly three readers -- the referral
-- desk's channel column, the admin directory's listing count, and which plan card Plans.jsx opens
-- on. Nothing gates on it; the owner plan entitlement is a live count via
-- ListingService.standingFor. The live count a visitor could open is a different number and is
-- deliberately never stored -- see PropertyRepository.countByOwnerIdAndStatusAndArchivedFalse and
-- OwnerProfileResponse.listingCount, both of which count at the point of use precisely so the two
-- cannot drift into each other.
--
-- The premise that makes this backfill equal to the counter it seeds: nothing hard-deletes a
-- property. `Property` extends SoftDeleteEntity and there is no `DELETE FROM properties` anywhere,
-- so "rows present now" and "creates ever" are the same number. If a purge job is ever added, this
-- migration quietly stops being equivalent to what ListingService maintains.
--
-- Idempotent: assigns an absolute count rather than adding to what is there, so a re-run is a no-op
-- rather than a doubling. The same two statements close db/seed/R__zz_dev_demo_data.sql, which has
-- to recompute over its own literals; if the definition of this count ever moves, it moves in both.
UPDATE users u
   SET listings_count = c.n
  FROM (SELECT owner_id, count(*) AS n FROM properties GROUP BY owner_id) c
 WHERE c.owner_id = u.id
   AND u.listings_count IS DISTINCT FROM c.n;

-- Owners of nothing. Separate from the join above because an anti-join cannot come from the same
-- FROM clause, and leaving it out would strand any seeded non-zero value on an account with no
-- listings behind it -- the exact disagreement this migration exists to end.
UPDATE users u
   SET listings_count = 0
 WHERE u.listings_count <> 0
   AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.owner_id = u.id);
