-- V114 — the two detail tiles nobody could ever fill.
--
-- WHAT WAS WRONG. The property detail page has shown a Bathrooms tile and a Parking tile since it
-- was written, and neither had a column. Parking simply rendered "—" for every live listing. The
-- bathroom count was worse: `useProperty` fell back to `Math.max(1, bhkNum - 1)`, so a 3 BHK was
-- reported as having 2 bathrooms — as a fact, in the same tile shape as the price and the carpet
-- area — on the strength of arithmetic rather than anything the owner said. The same expression had
-- been copied into four more components, so the invention was consistent enough to look sourced.
--
-- Inventing a number is worse than omitting one. A blank tile makes a reader ask; a confident wrong
-- tile makes them stop asking, and bathrooms are a real decision input in shared and family rentals.
-- So the fix is not a better guess, it is a column the owner fills in and a page that says nothing
-- when they have not.
--
-- WHY BOTH ARE PLAIN COUNTS. Bathrooms is unambiguous. Parking is the debatable one: `amenities`
-- already carries '2-Wheeler Parking' and '4-Wheeler Parking', so a count is a second source of
-- truth about the same subject. They answer different questions and both get asked — the amenity
-- says a bike can be kept, the count says whether the second car has anywhere to go, and a reader
-- comparing two otherwise identical flats is asking the second. The amenity tokens stay; they are
-- what a PG or an office declares, where a per-listing count is meaningless.
--
-- WHY NOT NULL IS WRONG HERE. Same rule as age_years: NULL means the owner never answered, and 0
-- means they answered "none". A flat with no parking is a real and important answer, and a default
-- of 0 would erase the difference between that and silence for every row already in the table.

ALTER TABLE properties
    -- Full and half bathrooms together, as one count, because that is the only number an Indian
    -- listing quotes and the only one a reader compares. The wizard offers 1..4 with 4 displayed as
    -- "4+", so the stored value is a floor rather than an exact count at the top of the range; the
    -- CHECK stays open-ended anyway because an on-behalf admin post and a villa can both exceed it.
    -- 0 is permitted: a shop, a godown and a plot legitimately have none.
    ADD COLUMN bathrooms integer CHECK (bathrooms >= 0),

    -- Dedicated parking spaces that come with the unit. Not "is there parking in the society" —
    -- that is an amenity — but how many slots this listing conveys, which is what decides a
    -- two-car household. 0 means the owner said none, NULL means they were not asked or skipped.
    ADD COLUMN parking integer CHECK (parking >= 0),

    -- Balconies, for the same reason and with the same history: the floor-plan panel derived it from
    -- `bhk - 1` and printed it in a spec row. The wizard has collected it since it was written.
    ADD COLUMN balconies integer CHECK (balconies >= 0);

COMMENT ON COLUMN properties.bathrooms IS 'Bathroom count. NULL = unstated, 0 = none. 4 is the wizard ceiling and reads as 4+.';
COMMENT ON COLUMN properties.parking   IS 'Dedicated parking slots conveyed with the unit. NULL = unstated, 0 = none. Distinct from the parking amenity tokens.';
COMMENT ON COLUMN properties.balconies IS 'Balcony count. NULL = unstated, 0 = none.';

-- No index on either. Neither is a search facet: nothing in the listings sidebar filters on a
-- bathroom or slot count, so an index would be write cost with no reader. V95's rule applies —
-- a facet earns an index, a detail does not.
