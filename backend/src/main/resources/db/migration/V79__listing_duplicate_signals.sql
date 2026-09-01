-- The two signals that let the server notice one unit listed twice by two different owners.
--
-- WHAT THIS IS FOR. Two owners listing the same flat is the oldest fraud on an Indian property
-- marketplace: a broker who does not hold the mandate posts the unit anyway, takes the enquiries,
-- and collects a visit fee for a home they cannot let. The consumer submit form has flagged this
-- since it was written -- and, like the user review flag in V77, it flagged it into the browser's
-- own copy of the database, so the warning existed only on the machine of the person who happened
-- to trigger it and was gone on reload. Ops, who are the only people who can act on it, never saw
-- one. This is that capability made real, and the columns are what a rule can actually match on.
--
-- WHY TWO SIGNALS AND NOT ONE. They fail in opposite directions, which is why keeping both is not
-- redundancy.
--
--   * `electricity_meter_no` is the precise one. A meter serves exactly one unit, the number is on
--     a bill every owner has to hand, and unlike an address it has one spelling. When it is present
--     on both sides a match is close to certain. It is optional and always will be: an owner in a
--     society with a single bulk meter has nothing to type, and refusing their listing over it
--     would punish the honest for their building's wiring.
--
--   * `address_key` is the one that fires when the meter is absent, which is most of the time. Pune
--     addresses are unstandardised to the point of comedy -- "Flat 402, B Wing, Rohan Nilay, Baner"
--     and "B-402 Rohan Nilay, Baner, Pune 411045" are the same doorway -- so the raw `address`
--     column matches nothing useful. This holds a normalised form: casefolded, punctuation dropped,
--     whitespace collapsed, and the filler words ("flat", "no", "wing", "apt", ...) removed, so the
--     two strings above collapse to the same key. Derived and written by the server on every listing
--     write, never accepted from the client -- a client-supplied key is a client-chosen collision.
--
-- WHY THE KEY IS A STORED COLUMN AND NOT AN EXPRESSION INDEX. The normalisation is a word-level
-- filter, not a regex: it strips a vocabulary of filler tokens. Expressing that in SQL would mean
-- either a chain of nested `replace()` calls that nobody can read or maintain, or an IMMUTABLE
-- PL/pgSQL function that becomes a second definition of the rule -- and the moment the Java and the
-- SQL disagree about whether "bldg" is filler, the index silently stops matching the query. One
-- definition, in Java, written to a column.
--
-- WHY NEITHER COLUMN IS UNIQUE. The whole point is that a collision is *suspicious*, not
-- impossible. Two owners legitimately share an address key when a bungalow is split into two
-- tenancies, when a society reuses flat numbers across wings the address does not name, and every
-- time the normaliser is a little too eager. A UNIQUE constraint would turn every one of those into
-- a listing the owner simply cannot create, with a database error for an explanation. The rule that
-- reads these columns opens a verification case and tells ops; a human decides.
--
-- WHY THE INDEXES ARE PARTIAL. Both columns are null for a large share of rows -- meter especially,
-- address for any listing that never filled it in -- and the duplicate probe only ever looks for a
-- non-null value. `WHERE ... IS NOT NULL` indexes exactly the rows that can match.

ALTER TABLE properties ADD COLUMN electricity_meter_no text;
ALTER TABLE properties ADD COLUMN address_key          text;

CREATE INDEX idx_properties_meter ON properties (electricity_meter_no)
    WHERE electricity_meter_no IS NOT NULL;

-- Locality-scoped: the key alone is not selective enough ("a 101" repeats across Pune), and every
-- query that uses it pairs the two.
CREATE INDEX idx_properties_address_key ON properties (locality_slug, address_key)
    WHERE address_key IS NOT NULL;

-- The society branch of the rule matches on (society, floor, bhk). Society alone is already indexed
-- for the society hub; this covers the narrower probe without a second scan of a large society.
CREATE INDEX idx_properties_society_unit ON properties (society_id, floor, bhk)
    WHERE society_id IS NOT NULL;
