package com.draazy.api.common.trust;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * Rating aggregates, for the catalogue surfaces that display them.
 *
 * <p><strong>Why a port, again.</strong> Reviews live in {@code engagement}, which ranks
 * <em>above</em> {@code catalog} in the layering. The society hub needs an average rating, so
 * without an inversion {@code catalog} would import {@code engagement} — the exact upward reference
 * that {@code ArchitectureBoundaryTest} fails the build over, and one that would fuse the
 * catalogue to a feature it is supposed to be independent of. Declaring it here and implementing it
 * in {@code engagement.review} points the arrow the right way, as {@link ContactGate} and
 * {@link PropertyExperience} already do.
 *
 * <p>Deliberately narrow: societies only, because societies are the only catalogue surface whose
 * contract currently carries a rating. When localities grow one, they get a sibling method — not a
 * generic {@code (targetType, targetId)} signature that would drag the reviews vocabulary into the
 * shared kernel and invite every future caller to guess at target keys.
 */
public interface RatingLookup {

    /**
     * Published-review aggregates for a page of societies, in one query.
     *
     * <p>Computed on read and never stored. Slice 7 measured the alternative in this very schema:
     * {@code listing_count} columns that nothing maintained had already drifted away from the truth
     * while still looking authoritative. A rating average has the same failure mode and higher
     * stakes, so the only safe denormalisation is none.
     *
     * @param societyIds the societies on the current page; the query never scans beyond them
     * @return a map keyed by society id. Societies with no published review are <strong>absent</strong>
     *         rather than present with zeroes — "unrated" and "rated zero" are different claims, and
     *         the caller is expected to render the first as a null average
     */
    Map<UUID, Rating> forSocieties(Collection<UUID> societyIds);

    /**
     * One society's aggregate.
     *
     * @param average     mean rating over published reviews
     * @param reviewCount how many reviews that average is over — without it the average is unreadable
     */
    record Rating(BigDecimal average, long reviewCount) {
    }
}
