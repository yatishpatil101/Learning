-- Room outlook is optional and independent of the parent listing; no defaults or backfill.
ALTER TABLE flatmate_rooms
    ADD COLUMN facing text,
    ADD COLUMN overlooking text;