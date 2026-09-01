-- V100 — canonical share-type key, so the type chips can exclude shares server-side.
--
-- WHAT WAS WRONG. `property_type_key` (V98) answers "what kind of building is this", which is not
-- quite what the type chips ask. A PG posted with property_type "Flat" keys as `flat`, so once
-- filtering moved to the database a Flat search started returning PG buildings and shared rooms.
-- The browser never did that: `matchBuyType`/`matchRentType` bail out on a listing carrying a
-- shareType, so a share only ever matched the PG or Flatmates chip. That rule had nowhere to live
-- server-side, because PG-ness is not written down anywhere as a value — it is *implied* by two
-- other columns, `sharing` (occupancy options, V95) and `room` (flatmate room shape, V95).
--
-- WHY A COLUMN AND NOT A PREDICATE. The implication could be spelled out in every query instead:
-- `jsonb_array_length(sharing) = 0 AND room IS NULL`. That is the same rule copied into each place
-- that filters by type, counts a facet, or ranks — and the last audit found exactly that class of
-- copy drifting (the ownership-verification lapse honoured by the filter but not the ranking).
-- Naming it once means the definition of "this is a share" has one home.
--
-- GENERATED, for the same reason V94/V98/V99 are: `sharing` and `room` are set on several write
-- paths, and a trigger or an application-side mirror is one chance to drift per path. A generated
-- column cannot disagree with its inputs.
--
-- NO INDEX. Unlike V98/V99 this column is NULL for the overwhelming majority of rows, and the
-- dominant read is `share_type IS NULL` — the ordinary Flat/House/Villa search. An index whose
-- entries are almost all one value, and whose selective case is the one nobody filters on, would
-- cost every write and be ignored by the planner. The type-key index still carries these queries.

ALTER TABLE properties
    ADD COLUMN share_type text GENERATED ALWAYS AS (
        CASE
            WHEN jsonb_array_length(sharing) > 0 THEN 'pg'
            WHEN room IS NOT NULL THEN 'flatmates'
            ELSE NULL
        END
    ) STORED;

COMMENT ON COLUMN properties.share_type IS 'Canonical share kind: pg (offers occupancy options) | flatmates (states a room shape) | NULL (a whole unit). Derived from sharing and room. Mirrors the shareType the API returns and the shareType the listings chips match on; a listing with a share_type matches ONLY the PG or Flatmates chip, never Flat/House/Villa.';

-- Audit: shares whose property_type would otherwise have put them under a whole-unit chip.
-- Expect these to be exactly the rows the browser was already hiding from those chips.
--
-- SELECT share_type, property_type_key, count(*)
--   FROM properties
--  WHERE share_type IS NOT NULL
--  GROUP BY 1, 2
--  ORDER BY 1, 2;
