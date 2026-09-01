-- Meter numbers get a normalised comparison key, so the duplicate probe's precise arm stops
-- missing the collisions it exists to catch.
--
-- WHAT WAS WRONG. V79 introduced `electricity_meter_no` on the reasoning that a meter number,
-- "unlike an address, has one spelling". That is true of the meter and false of the number. It is
-- copied off a bill that prints it in groups, by a human who groups it their own way, so the same
-- MSEDCL consumer number arrives as '170012345678', '1700 1234 5678' and '170-0123-45678'. Both
-- duplicate queries compare with `=`, so those were three different meters.
--
-- The cost landed on the arm that is supposed to be the certain one. An owner who typed their
-- number with spaces in March and without in April was never shown "you already listed this", and
-- two owners fighting over one flat were never flagged to ops -- while the address arm, the one V79
-- calls the weaker signal, went on working. A signal that silently fails is worse than an absent
-- one, because the platform reports no duplicates and everybody believes it.
--
-- WHY A SECOND COLUMN AND NOT A NORMALISED FIRST ONE. The raw column is shown back to the owner,
-- who checks it against a bill with the grouping printed on it. A value that reformats itself
-- between submit and re-read reads as data loss to the one person able to tell us it is wrong. So
-- this follows what V79 already did for `address`: raw column for the human, derived key for the
-- comparison. `MeterKey` is the one derivation, run by the server on every write, never accepted
-- from a client -- a client that picks its own key picks which listings it collides with.
--
-- WHY THE BACKFILL MAY RESTATE THE RULE IN SQL, WHERE V79's COULD NOT. V79 argued at length that
-- `address_key` must not be an expression index, because its normalisation is a word-level filler
-- filter that SQL can only express as an unreadable `replace()` chain or a second definition of the
-- rule. None of that applies here: "strip everything that is not a digit" is one regex, total, and
-- has no vocabulary to drift out of step with. The floor of six digits is restated below and in
-- MeterKey.MIN_DIGITS; it exists because an optional field collects placeholders ('0', 'NA',
-- '1234') and under exact equality every owner who typed the same placeholder collides with every
-- other -- a moderation queue full of manufactured suspicion against honest owners.
ALTER TABLE properties ADD COLUMN electricity_meter_key text;

UPDATE properties
   SET electricity_meter_key = regexp_replace(electricity_meter_no, '\D', '', 'g')
 WHERE electricity_meter_no IS NOT NULL
   AND length(regexp_replace(electricity_meter_no, '\D', '', 'g')) >= 6;

-- Partial for the same reason V79's were: most listings carry no meter, the probe only ever looks
-- for a non-null value, and this indexes exactly the rows that can match.
CREATE INDEX idx_properties_meter_key ON properties (electricity_meter_key)
    WHERE electricity_meter_key IS NOT NULL;

-- The raw column now has no reader. Both duplicate queries moved to the key, and nothing else
-- filters on a meter -- it is returned to its own owner and to nobody else. Dropped on V113's
-- reasoning: an unreferenced index on `properties` is write-time cost on every insert and update,
-- paid forever, for a plan no query can ask for.
DROP INDEX IF EXISTS idx_properties_meter;
