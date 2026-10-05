-- The host's own headline for the card. Nullable: posts made before it existed keep the derived
-- headline (society for a room, name for a seeker) that the client already falls back to.
ALTER TABLE flatmate_rooms ADD COLUMN title text CHECK (title IS NULL OR char_length(title) <= 120);
ALTER TABLE flatmate_seeker_posts ADD COLUMN title text CHECK (title IS NULL OR char_length(title) <= 120);
