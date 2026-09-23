-- `flatmate_rooms.home_type_label` was the one flatmate vocabulary column with no CHECK.
--
-- V13 added it as bare text and the room card has rendered it ever since, but no request carried
-- it: the wizard asked "Flat / Independent House / Villa / Row House" and dropped the answer at the
-- browser, so every room posted through it showed a blank where the seed rows show a home type.
-- Two of those four options were the same value anyway -- "Row House" was mapped onto the
-- independent-house token -- so a host picking between them was picking between nothing.
--
-- The request now carries the label and FlatmateVocabulary.HOME_TYPE refuses anything else, which
-- closes the door for new writes. This closes it for the column: a vocabulary enforced only by its
-- writer is a convention, and this one is rendered straight onto an anonymous public card, which is
-- where an unbounded string earns a phone number in it.

-- Anything outside the vocabulary is not a home type, it is a string -- and an unstated home type
-- is already a state the card handles, so NULL is the honest landing place rather than a guess at
-- which of the four was meant.
UPDATE flatmate_rooms
   SET home_type_label = NULL
 WHERE home_type_label IS NOT NULL
   AND home_type_label NOT IN ('Flat', 'Independent House', 'Villa', 'Row House');

ALTER TABLE flatmate_rooms
    ADD CONSTRAINT ck_flatmate_rooms_home_type_label
        CHECK (home_type_label IS NULL
               OR home_type_label IN ('Flat', 'Independent House', 'Villa', 'Row House'));

COMMENT ON COLUMN flatmate_rooms.home_type_label IS
    'What the building is, as the card spells it. Closed vocabulary: FlatmateVocabulary.HOME_TYPE. '
    'NULL is "the host did not say", which is a different answer from any of the four.';
