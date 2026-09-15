-- V18 DDL: remove the PG / Hostel vertical.
--
-- A PG was a bed let at a stated occupancy, which is a different product from a flat share (one
-- person's room in someone else's flat). Only `sharing` recorded that occupancy, so with the
-- vertical withdrawn the column has no author and no reader: keeping it would leave a filterable
-- fact the product can no longer state.
--
-- `share_type` is GENERATED from `sharing`, and a generated column cannot be altered in place, so
-- it is dropped ahead of its input and rebuilt on `room` alone. `property_type_key` is rebuilt for
-- the same reason -- its PG branch would otherwise key a listing to a chip that no longer exists,
-- stranding the row in search while its comment still claimed to mirror the app's taxonomy.
--
-- Rebuilding two STORED columns rewrites the table under ACCESS EXCLUSIVE, so this runs in a
-- maintenance window. Both are added in one ALTER TABLE to pay for that rewrite once.

-- Withdraw the PG stock. Archived, not deleted: twenty-seven foreign keys point at a listing and
-- only three cascade, so a delete would abort on the ownership-evidence RESTRICT that V08
-- installed naming this exact statement -- and on the enquiries, deals and saves beside it.
-- Archiving is how this platform has always withdrawn a listing, and every public-search index
-- is floored on `archived = false`, so the rows leave search on this statement.
--
-- Matched on the label as well as the occupancy array because `sharing` was never on
-- ListingCreate: an owner-posted PG carries the empty default, so the array alone would miss
-- every one of them and leave them live but unfilterable once the `pg` key is gone.
UPDATE properties
   SET archived       = true,
       archived_at    = coalesce(archived_at, now()),
       archive_reason = coalesce(archive_reason, 'PG / Hostel vertical withdrawn (V18)'),
       status         = 'archived'
 WHERE room IS NULL
   AND (jsonb_array_length(sharing) > 0
        OR lower(coalesce(property_type, '')) LIKE 'pg%');

-- A PG-labelled listing that also states a room shape is a flat share, and keeps trading as one.
-- Its label has to move with it: no branch below matches 'pg%', so leaving it would key the row
-- to NULL and drop it out of every type chip while it was still live.
UPDATE properties
   SET property_type = 'Flat'
 WHERE room IS NOT NULL
   AND lower(coalesce(property_type, '')) LIKE 'pg%';

-- AUDIT. PG stock that outlived the withdrawal. Expected to be empty.
--   SELECT id, slug, property_type, room, status, archived
--     FROM properties
--    WHERE lower(coalesce(property_type, '')) LIKE 'pg%' AND archived = false;

DROP INDEX IF EXISTS idx_properties_sharing;
DROP INDEX IF EXISTS idx_properties_type_key;

ALTER TABLE properties DROP COLUMN IF EXISTS share_type;
ALTER TABLE properties DROP COLUMN IF EXISTS property_type_key;
ALTER TABLE properties DROP COLUMN IF EXISTS sharing;

-- Unchanged from V04 apart from the dropped PG branch. Tokens mirror SEARCH_TYPES in
-- frontend/src/data/propertyTypes.js, so a listing is filterable by the option it was posted under.
ALTER TABLE properties
    ADD COLUMN property_type_key text GENERATED ALWAYS AS (
        CASE
            -- Commercial before land: "Commercial Plot" is commercial stock first.
            WHEN lower(coalesce(property_type, '')) LIKE '%office%'
              OR lower(coalesce(property_type, '')) LIKE '%shop%'
              OR lower(coalesce(property_type, '')) LIKE '%showroom%'
              OR lower(coalesce(property_type, '')) LIKE '%retail%'
              OR lower(coalesce(property_type, '')) LIKE '%commercial%'
              OR lower(coalesce(property_type, '')) LIKE '%warehouse%'
              OR lower(coalesce(property_type, '')) LIKE '%godown%'
              OR lower(coalesce(property_type, '')) LIKE '%industrial%'
              OR lower(coalesce(property_type, '')) LIKE '%co-working%'
              OR lower(coalesce(property_type, '')) LIKE '%coworking%' THEN 'commercial'

            -- House before flat and villa so the legacy "Villa / House" label lands where the app's
            -- own alias table puts it. Full phrases only, which is what keeps "Penthouse" out.
            WHEN lower(coalesce(property_type, '')) LIKE '%independent house%'
              OR lower(coalesce(property_type, '')) LIKE '%row house%'
              OR lower(coalesce(property_type, '')) LIKE '%villa / house%' THEN 'house'

            -- Flat covers studio, penthouse and the 'apartment' alias: one bedroom count, one
            -- building, one buyer.
            WHEN lower(coalesce(property_type, '')) LIKE '%flat%'
              OR lower(coalesce(property_type, '')) LIKE '%studio%'
              OR lower(coalesce(property_type, '')) LIKE '%penthouse%'
              OR lower(coalesce(property_type, '')) LIKE '%apartment%' THEN 'flat'

            WHEN lower(coalesce(property_type, '')) LIKE '%villa%' THEN 'villa'

            -- Farm land before plot so "Farm Land" cannot be captured by a future plot token.
            WHEN lower(coalesce(property_type, '')) LIKE '%farm land%'
              OR lower(coalesce(property_type, '')) LIKE '%farmland%' THEN 'farmland'

            WHEN lower(coalesce(property_type, '')) LIKE '%open plot%'
              OR lower(coalesce(property_type, '')) LIKE '%plot%' THEN 'plot'

            ELSE NULL
        END
    ) STORED,
    ADD COLUMN share_type text GENERATED ALWAYS AS (
        CASE WHEN room IS NOT NULL THEN 'flatmates' ELSE NULL END
    ) STORED;

-- Recreated verbatim: the type chip is a predicate on nearly every buyer search and is always
-- combined with deal + status, and the index was dropped only because its column was.
CREATE INDEX idx_properties_type_key
    ON properties (deal, property_type_key)
    WHERE status = 'approved' AND archived = false;

COMMENT ON COLUMN properties.property_type_key IS
'Canonical filter key derived from the free-text property_type: commercial|flat|house|villa|farmland|plot, or NULL when the label is unrecognised. Generated -- never written directly. Mirrors SEARCH_TYPES in frontend/src/data/propertyTypes.js.';

COMMENT ON COLUMN properties.share_type IS
'Canonical share kind: flatmates (states a room shape) | NULL (a whole unit). Generated from room -- never written directly, and filter-only: it is not on the wire. The client derives the same value from room for its chips, so a listing with a share_type matches ONLY the Flatmates chip, never Flat/House/Villa.';

