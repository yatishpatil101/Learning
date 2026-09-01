-- V124 — the flatmate shortlist.
--
-- `saved_properties` has held the property half of "Saved" since V1. The flatmate half was never
-- given a table: it lived in `puneNestFlatmateSaved`, a localStorage key that also cached the card's
-- title, price and photo at save time. A save therefore belonged to a browser rather than to a
-- person, and the cached card went stale the moment the room's rent changed.
--
-- Deliberately NOT a column on `saved_properties`. A flatmate save points at one of three tables,
-- so it cannot carry `property_id`, and widening that table would mean a nullable FK plus a check
-- constraint to keep exactly one of them set — a shape whose only purpose would be to let two
-- unrelated shortlists share a name.
--
-- No FK on `post_id`, for the same reason: Postgres has no polymorphic reference. Existence is
-- checked in the service before the insert, and a row whose target is later deleted is dropped from
-- the projection rather than returned as a hole — the same contract `SavedPropertyService` states
-- for a hard-deleted property.
CREATE TABLE flatmate_saves (
    user_id    uuid NOT NULL REFERENCES users(id),
    kind       text NOT NULL,
    post_id    uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, kind, post_id),
    CONSTRAINT flatmate_saves_kind_chk CHECK (kind IN ('room', 'group', 'post'))
);

-- The only read pattern: one user's shortlist, newest save first.
--
-- `clock_timestamp()` rather than `now()`: `now()` is the *transaction* timestamp and is constant
-- for its whole duration, so three saves made inside one transaction would tie and the shortlist's
-- order would be whatever the planner returned. This column is an ordering key, so it has to be the
-- wall clock.
CREATE INDEX ix_flatmate_saves_user_created ON flatmate_saves (user_id, created_at DESC);

COMMENT ON TABLE flatmate_saves IS
    'A user''s flatmate shortlist. `kind` names which table `post_id` points at: flatmate_rooms, '
    'flatmate_groups or flatmate_seeker_posts. Hard-deleted like saved_properties (D8.9) — a '
    'shortlist toggle is a preference, not a business record.';
