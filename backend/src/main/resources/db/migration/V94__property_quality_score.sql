-- V94 — the listing quality score becomes a column.
--
-- WHY THIS IS SQL AND NOT JAVA (D26 decision A).
-- The score is 0-100 over fifteen fields that all live on this same row, and its whole purpose is
-- to order search results. An ordering that the browser computes after the fetch cannot be paged:
-- page 2 is a separate query, and a rank the database never saw cannot decide which rows belong on
-- it. So the score has to be reachable from ORDER BY, which leaves three shapes — a stored column
-- maintained by the service on write, a Hibernate @Formula, or this. A generated column wins on the
-- one property that matters over a five-year codebase: it *cannot* go stale. There are eight write
-- paths that touch a scored field (owner create, owner update, admin update, photo upload, photo
-- delete, ownership verification, Aadhaar verification, document count) and a maintained column is
-- only ever one forgotten call away from serving a number that quietly disagrees with the listing
-- under it. Postgres recomputes this on every write, including the ones written years from now by
-- somebody who has never read this file.
--
-- The cost, stated plainly: retuning the weights needs a migration. That is the right trade for a
-- number shown to owners as advice and used to order what buyers see — it should be versioned, and
-- a diff should say when it changed.
--
-- IMMUTABILITY. Every function here is immutable, which Postgres requires: jsonb_array_length,
-- length, and coalesce over plain column references. No now(), no lookups into other tables. That
-- is also why freshness is NOT part of this score even though it ranks alongside it — freshness is
-- a function of the clock, so it can never be a stored column and is derived on read instead.
--
-- THIS IS NOT A LITERAL PORT, AND CANNOT BE. The browser scored four inputs that have no column
-- behind them, because the mock invented them. Each substitution below is deliberate:
--
--   gallery[] / image      -> images jsonb, falling back to cover_image as a single photo.
--   aadhaarVerified (10)   -> DROPPED as a separate term. The server has one identity flag, not
--                             two: properties.owner_verified IS the Aadhaar/DigiLocker result.
--                             The browser was scoring the same fact twice and calling it 20
--                             points. Those 10 points move to ownership_verified, which is a
--                             genuinely distinct and higher-bar signal the server already holds.
--   age (rent 5 / buy 4)   -> NO REFERENT ANYWHERE. There is no age_years column and never was.
--                             Rent recovers its 5 by scoring deposit and possession separately
--                             instead of as one OR'd pair; buy recovers its 4 on total_floors,
--                             a real completeness field of the same character as floor.
--   availableFrom (rent)   -> possession. The server describes timing once.
--   construction (buy)     -> possession. Same field; the browser had two names for it.
--
-- Both deals still total exactly 100.

ALTER TABLE properties
    ADD COLUMN quality_score smallint GENERATED ALWAYS AS (
        LEAST(100,
            -- Photos (25). The single strongest predictor of an enquiry, so it carries the most
            -- weight and rewards the third photo disproportionately. A listing with an empty
            -- images[] but a cover_image counts as one photo, which is what the browser did.
            (CASE
                WHEN jsonb_array_length(COALESCE(images, '[]'::jsonb)) >= 3 THEN 25
                WHEN jsonb_array_length(COALESCE(images, '[]'::jsonb)) = 2 THEN 16
                WHEN jsonb_array_length(COALESCE(images, '[]'::jsonb)) = 1 THEN 8
                WHEN cover_image IS NOT NULL THEN 8
                ELSE 0
            END)

            -- Description (15). Banded by length rather than scored linearly: the difference
            -- between nothing and a sentence is real, the difference between 400 and 500
            -- characters is not.
            + (CASE
                WHEN length(COALESCE(description, '')) >= 200 THEN 15
                WHEN length(COALESCE(description, '')) >= 100 THEN 12
                WHEN length(COALESCE(description, '')) >= 50 THEN 8
                WHEN length(COALESCE(description, '')) > 0 THEN 3
                ELSE 0
            END)

            -- Trust (20). The two deals ask for different evidence, which is the reason this
            -- score is not one formula: a rental is about who the owner is, a sale is about
            -- whether they can prove they own it. See the header for why rent scores
            -- ownership_verified here rather than a second, duplicated identity flag.
            + (CASE WHEN deal = 'rent' THEN
                (CASE WHEN owner_verified THEN 10 ELSE 0 END)
                + (CASE WHEN ownership_verified THEN 10 ELSE 0 END)
              ELSE
                (CASE WHEN ownership_verified THEN 10 ELSE 0 END)
                + (CASE WHEN docs_count >= 3 THEN 10 WHEN docs_count >= 1 THEN 5 ELSE 0 END)
              END)

            -- Completeness (25). The fields a buyer filters on. 'unfurnished' scores less than a
            -- furnished flat not as a judgement on the property but because it is the default a
            -- form leaves behind, so it is weaker evidence that anyone answered the question.
            + (CASE WHEN deal = 'rent' THEN
                (CASE WHEN furnishing IS NULL THEN 0 WHEN furnishing = 'unfurnished' THEN 3 ELSE 5 END)
                + (CASE WHEN facing IS NOT NULL THEN 5 ELSE 0 END)
                + (CASE WHEN floor IS NOT NULL THEN 5 ELSE 0 END)
                + (CASE WHEN possession IS NOT NULL THEN 5 ELSE 0 END)
                + (CASE WHEN deposit IS NOT NULL THEN 5 ELSE 0 END)
              ELSE
                (CASE WHEN furnishing IS NULL THEN 0 WHEN furnishing = 'unfurnished' THEN 2 ELSE 4 END)
                + (CASE WHEN facing IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN floor IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN total_floors IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN area IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN possession IS NOT NULL THEN 5 ELSE 0 END)
              END)

            -- Amenities (15).
            + (CASE
                WHEN jsonb_array_length(COALESCE(amenities, '[]'::jsonb)) >= 5 THEN 15
                WHEN jsonb_array_length(COALESCE(amenities, '[]'::jsonb)) >= 3 THEN 10
                WHEN jsonb_array_length(COALESCE(amenities, '[]'::jsonb)) >= 1 THEN 5
                ELSE 0
            END)
        )
    ) STORED;

COMMENT ON COLUMN properties.quality_score IS
    'Listing completeness, 0-100, generated. Weights: photos 25, description 15, trust 20, '
    'completeness 25, amenities 15. Rent scores owner identity; buy scores ownership evidence. '
    'Retuning requires a migration - see V94 for why that is deliberate.';

-- Ordering index. The public search always pins status and archived, so the score is only ever
-- sorted within that slice; a partial index over exactly that slice is both smaller and the one
-- the planner can actually use for the relevance order.
CREATE INDEX idx_properties_quality_score
    ON properties (quality_score DESC, created_at DESC)
    WHERE archived = false AND status = 'approved';
