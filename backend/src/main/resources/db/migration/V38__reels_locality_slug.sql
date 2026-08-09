-- V38 — reels get a locality slug, so the feed filter joins the same locality vocabulary as
-- everything else.
--
-- Why. reels.locality is a display caption ("Koregaon Park") and the feed filtered on it
-- case-insensitively. Every other locality reference in the system keys on a slug
-- ("koregaon-park") and resolves the display name for rendering — Property carries both
-- `locality` and `locality_slug` for exactly this reason. Once the frontend runs against the API
-- it will send the slug it already holds, and a slug would never match the stored display label.
-- So reels adopt the same dual shape: the caption stays a display label (the clip must keep saying
-- what it said when it was filmed), and a new slug column carries the filter key.
--
-- The backfill maps each existing reel to its slug by joining the curated `localities` table on
-- name rather than hardcoding a mapping here — the localities table is the authority for that
-- pairing, so a reel captioned with a name that table knows gets the right slug, and one that does
-- not is left NULL (honest: it simply will not appear in a slug-filtered feed) rather than guessed.

ALTER TABLE reels ADD COLUMN locality_slug text;

UPDATE reels r
SET locality_slug = l.slug
FROM localities l
WHERE lower(r.locality) = lower(l.name)
  AND r.locality_slug IS NULL;

CREATE INDEX idx_reels_locality_slug ON reels (locality_slug);
