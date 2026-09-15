-- V19 DDL: split the outlook out of `facing`.
--
-- `facing` was collecting two different facts through one control. Four of the wizard's ten options
-- were compass directions (Vastu, which moves offers in this market) and two -- 'Park Facing',
-- 'Road Facing' -- described the view instead. A flat is normally both north-facing AND garden-
-- facing, so the single list forced the owner to drop whichever mattered less, and a buyer
-- filtering on direction could not tell a north-facing flat from one whose owner had chosen to
-- state the park.
--
-- Free text with a size cap rather than an enum, matching `facing` and for the same reason stated
-- on ListingCreate: the wizard's four options are a product decision that will move, and a CHECK
-- here would start rejecting bodies the read path still returns.

ALTER TABLE properties ADD COLUMN overlooking text;

COMMENT ON COLUMN properties.overlooking IS
    'What the home looks out onto -- garden, amenity, parking, main road. NULL = unstated. Distinct from facing, which is the compass direction.';

-- The two outlook values `facing` used to carry move to the column that now means them. Anything
-- else in `facing` is left exactly as it is: the four diagonals the wizard no longer offers are
-- still true statements about those homes, and rewriting them to a neighbouring cardinal would
-- invent a precision the owner never gave.
UPDATE properties
   SET overlooking = CASE facing
                         WHEN 'Park Facing' THEN 'Garden'
                         WHEN 'Road Facing' THEN 'Main Road'
                     END,
       facing = NULL
 WHERE facing IN ('Park Facing', 'Road Facing');
