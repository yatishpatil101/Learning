-- V10 Constrain and populate properties.possession, and make it a first-class search facet.
--
-- The column has existed since V3 as unconstrained, nullable free text, was never written by any code
-- path, and is NULL in every row. Meanwhile the React client has always modelled possession as a
-- three-value enum driving the "Ready to move / New launch / Under construction" filter chips. That
-- divergence only surfaced when the catalogue was pointed at the real API: with no server-side
-- vocabulary and no filter support, selecting "Ready to move" returned zero rows -- a filter that
-- silently returns nothing is worse than a filter that isn't offered at all.
--
-- This migration closes the gap at the layer that can actually guarantee it. Bean Validation rejects a
-- bad value on the API edge, but only a CHECK constraint stops one arriving through a backfill, an ops
-- script, or a future import job. Same posture as properties_furnishing_check directly above it.
--
-- NULL remains legal and means "not stated", which is deliberately distinct from all three states: a
-- listing whose possession nobody recorded must not match a "Ready to move" search. Land and plots sit
-- here permanently -- an empty plot has no construction to be ready or otherwise.

ALTER TABLE properties
    ADD CONSTRAINT properties_possession_check
        CHECK (possession IS NULL OR possession = ANY (ARRAY[
            'ready-to-move'::text,
            'new-launch'::text,
            'under-construction'::text
        ]));

-- Backfill the seeded catalogue so the facet has something to filter. Rules, not randomness, so the
-- result is reproducible and defensible on re-run:
--   * Rentals are let as finished homes -- a tenant cannot move into a building site.
--   * Plots/land keep NULL, per the "not stated is a real state" rule above.
--   * Sale listings are spread across the three states by a deterministic hash of the id, so the
--     distribution is stable across environments instead of shifting with insertion order.
UPDATE properties
SET possession = CASE
    WHEN property_type IN ('Plot', 'Land') THEN NULL
    WHEN deal = 'rent' THEN 'ready-to-move'
    ELSE (ARRAY['ready-to-move', 'under-construction', 'new-launch'])[
        1 + (('x' || substr(md5(id::text), 1, 8))::bit(32)::bigint % 3)
    ]
END
WHERE possession IS NULL;

-- No new index. The public search is already served by the partial idx_properties_search
-- (approved + non-archived); possession is a low-cardinality residual filter that Postgres applies
-- cheaply against that much smaller candidate set. Adding a dedicated index now would be speculative
-- -- revisit when the catalogue is large enough for EXPLAIN to justify it.
