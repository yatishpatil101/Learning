-- V98 — the property type filter gets a canonical key.
--
-- THE BUG THIS FIXES. `properties.property_type` is free text ("e.g. apartment", per
-- PropertySummary's own javadoc), and the eight filter keys the listings page offers are not the
-- strings it holds. The browser bridged the gap with substring matching over an alias table
-- (`propertyTypes.js` SEARCH_TYPES[].matches), so the "Flat" chip has always meant
-- `flat OR studio OR penthouse`. The server compared for equality. Moving the filter server-side
-- without this column would therefore have silently gutted it — measured against the e2e catalogue:
--
--   chip                shows today                                   exact match would show
--   Flat                32  (flat, studio, penthouse)                 10
--   Independent House    4  (independent house, row house)             0
--   Commercial          12  (six different labels)                     0
--   Farm Land            1  (farm land)                                0
--   Open Plot            6  (open plot, plot)                          5
--   Villa                5                                             5
--
-- Only Villa survived. Every other chip would have returned a confident, wrong, mostly-empty page
-- that looks like "no such stock in Pune" rather than a broken filter.
--
-- WHY A COLUMN AND NOT A QUERY. Three shapes were possible: expand the key into its token list in
-- the browser and send `types=flat,studio,penthouse`; mirror the substring matching server-side with
-- ILIKE; or name the concept once, here. The first two leave the taxonomy as an exact-match
-- allow-list over free text, so the day anyone stores "Apartment" or "1 RK" the listing quietly
-- stops being findable — the same class of defect this migration exists to remove, relocated. This
-- column makes "what kind of property is this" a fact of the row rather than a guess each reader
-- re-derives, and it is indexable, which a substring scan is not.
--
-- WHY GENERATED AND NOT MAINTAINED ON WRITE. Same reasoning as V94's quality_score, and it applies
-- harder here: the write paths that set property_type include owner create, owner update, admin
-- update and the SQL seeds, and a maintained column is one forgotten call away from a listing whose
-- key disagrees with its own label. Postgres recomputes this on every write, including the ones
-- made years from now by somebody who has never read this file. Every function used is immutable
-- (lower, LIKE against constant patterns), which is what a generated column requires.
--
-- ONE KEY PER ROW — A DELIBERATE NARROWING. The browser let a listing match several chips at once;
-- a column holds one value, so the CASE below is ordered and first match wins. This is only
-- observable for a label that spans two families, e.g. "Commercial Plot", which used to appear
-- under both Commercial and Open Plot and now appears under Commercial alone. That is the more
-- honest of the two answers and the ordering is stated rather than incidental.
--
-- UNRECOGNISED LABELS RESOLVE TO NULL, so they match no type filter — exactly what the browser's
-- substring matching already did with them. NULL means "we do not know what this is", which is
-- greppable (see the audit query at the foot of this file) rather than silently misfiled under a
-- default. A type filter narrowing to nothing is the correct response to a label nobody taught us.
--
-- THE TOKENS ARE NOT A LITERAL COPY OF THE BROWSER'S. They are the union of SEARCH_TYPES[].matches
-- and the ALIASES table beside it, which is strictly more than the browser matched on. "Apartment"
-- is the case that matters: ALIASES has always declared it a flat, the substring list never learned
-- it, and the backend's own test fixtures store it — so it matched no chip in either mode. Closing
-- that is a deliberate widening, not an accident of transcription.
--
-- pg / flatmates: the browser matches these two chips on `shareType`, which has no column here at
-- all. Mapping the stored label is still the truthful thing for this column to do, so "PG / Hostel"
-- resolves to 'pg'. The listings page does not filter on it — those two chips deep-link into the
-- dedicated flatmates finder instead — but the data does not lie about itself in the meantime.

ALTER TABLE properties
    ADD COLUMN property_type_key text GENERATED ALWAYS AS (
        CASE
            -- PG first: 'pg / hostel' and 'pg / co-living' are unambiguous, and anchoring the
            -- pattern keeps a bare two-letter token from matching inside an unrelated word.
            WHEN lower(coalesce(property_type, '')) LIKE 'pg%' THEN 'pg'

            -- Commercial before land: "Commercial Plot" is commercial stock first (see the
            -- narrowing note above). Tokens mirror SEARCH_TYPES.commercial.matches exactly.
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

            -- House before flat and villa so the legacy combined label "Villa / House" lands where
            -- the app's own alias table puts it, rather than being captured by the bare '%villa%'
            -- test below. The house tokens are always full phrases, never a bare 'house' — that is
            -- what keeps "Penthouse" out of the Independent House chip.
            WHEN lower(coalesce(property_type, '')) LIKE '%independent house%'
              OR lower(coalesce(property_type, '')) LIKE '%row house%'
              OR lower(coalesce(property_type, '')) LIKE '%villa / house%' THEN 'house'

            -- Flat covers studio and penthouse: one bedroom count, one building, one buyer.
            -- 'apartment' is here on the authority of the app's ALIASES table, which has always
            -- declared it a flat. The browser's substring list never learned it, so a listing
            -- stored as "Apartment" — the very example PropertySummary's javadoc gives — matched no
            -- chip at all. Carrying the alias across is the point of deriving this key rather than
            -- comparing labels: the taxonomy is stated once and new labels join it.
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
    ) STORED;

COMMENT ON COLUMN properties.property_type_key IS
    'Canonical filter key derived from the free-text property_type: pg|commercial|flat|house|villa|farmland|plot, or NULL when the label is unrecognised. Generated — never written directly. Mirrors SEARCH_TYPES in frontend/src/data/propertyTypes.js.';

-- The listings type chip is one of the two or three predicates on nearly every buyer search, and it
-- is always combined with deal + status, so the index leads with those to stay useful for the
-- unfiltered page too. Partial on the public-search floor: moderation queues do not use this facet.
CREATE INDEX idx_properties_type_key
    ON properties (deal, property_type_key)
    WHERE status = 'approved' AND archived = false;

-- AUDIT. Any row this CASE could not classify — expected to be empty, and a non-empty result is a
-- label the taxonomy has not been taught rather than a fault in the query:
--   SELECT DISTINCT property_type FROM properties WHERE property_type_key IS NULL;
