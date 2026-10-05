-- A group that is still house-hunting states what it wants, not what it pays.
--
-- Until now every group carried one exact `rent`, one `deposit` and one `locality` -- the shape of a
-- household that already holds a flat and is filling seats. Most groups form the other way round:
-- people team up first and then look for a flat together, so the only honest numbers they have are
-- ranges, and the only honest place is a shortlist. `hunting` separates the two; the preference
-- columns below are meaningful only when it is true.
--
-- `rent` stays NOT NULL and, for a hunting group, holds the budget CEILING for the whole flat. That
-- keeps `per_head` (V15, generated from `rent`) answering the board's budget filter and sort for
-- both kinds without a second price column the card and the filter could disagree on.
ALTER TABLE flatmate_groups
    ADD COLUMN hunting      boolean NOT NULL DEFAULT false,
    ADD COLUMN localities   jsonb   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN pref_bhk     jsonb   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN rent_min     bigint  CHECK (rent_min IS NULL OR rent_min >= 0),
    ADD COLUMN deposit_min  bigint  CHECK (deposit_min IS NULL OR deposit_min >= 0),
    ADD COLUMN deposit_max  bigint  CHECK (deposit_max IS NULL OR deposit_max >= 0),
    ADD COLUMN gated_only   boolean NOT NULL DEFAULT false,
    ADD COLUMN bachelors    boolean NOT NULL DEFAULT false,
    ADD COLUMN furnishing   text    CHECK (furnishing IS NULL
                                           OR furnishing IN ('unfurnished','semi','furnished')),
    ADD COLUMN move_in_by   date,
    ADD CONSTRAINT ck_flatmate_groups_pref_bhk
        CHECK (jsonb_typeof(pref_bhk) = 'array' AND pref_bhk <@ '["1","2","3","4"]'::jsonb),
    ADD CONSTRAINT ck_flatmate_groups_rent_range
        CHECK (rent_min IS NULL OR rent_min <= rent),
    ADD CONSTRAINT ck_flatmate_groups_deposit_range
        CHECK (deposit_min IS NULL OR deposit_max IS NULL OR deposit_min <= deposit_max),
    -- A group with an address has found its flat; it cannot also be hunting for one.
    ADD CONSTRAINT ck_flatmate_groups_hunting_unhoused
        CHECK (NOT hunting OR property_id IS NULL);

-- Every existing group names exactly one locality, so its shortlist is that one. The search reads
-- this column for both kinds, which is why it is backfilled rather than left empty.
UPDATE flatmate_groups SET localities = jsonb_build_array(locality);

CREATE INDEX idx_flatmate_groups_localities ON flatmate_groups USING gin (localities jsonb_path_ops);

COMMENT ON COLUMN flatmate_groups.hunting IS
    'True for a group still looking for a flat: it states preferences (ranges, a shortlist) instead '
    'of the terms of a flat it holds. Never true alongside a property_id.';
COMMENT ON COLUMN flatmate_groups.localities IS
    'Where the group would live. A hunting group names up to three; any other group holds its one '
    'locality here. `locality` is the first entry, kept for the single-locality readers.';
COMMENT ON COLUMN flatmate_groups.pref_bhk IS
    'Flat sizes a hunting group would take, as FlatmateVocabulary.BHK tokens (4 means 4+).';
COMMENT ON COLUMN flatmate_groups.rent_min IS
    'Floor of a hunting group''s whole-flat rent budget. The ceiling is `rent`.';
