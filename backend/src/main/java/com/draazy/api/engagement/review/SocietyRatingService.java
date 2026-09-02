package com.draazy.api.engagement.review;

import com.draazy.api.common.trust.RatingLookup;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@link RatingLookup} adapter — society rating aggregates, computed from published reviews.
 *
 * <p>This is what finally fills the seam slice 7 left open. {@code SocietyDetailResponse} documents
 * that its {@code avgRating} was returned null on purpose, because nothing had yet decided whether a
 * society review keys on the society's id or its slug, and an aggregate computed against a guessed
 * key "would produce a number that looks authoritative and silently becomes wrong". {@link
 * ReviewTargetKey} made that decision — the id — and this class is the aggregate it unblocks.
 */
@Service
public class SocietyRatingService implements RatingLookup {

    /** One decimal place, matching how the UI renders a rating ("4.3"). */
    private static final int SCALE = 1;

    private final ReviewRepository reviews;

    public SocietyRatingService(ReviewRepository reviews) {
        this.reviews = reviews;
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, Rating> forSocieties(Collection<UUID> societyIds) {
        if (societyIds == null || societyIds.isEmpty()) {
            // An empty IN () is not valid SQL, and asking anyway is a wasted round trip.
            return Map.of();
        }
        Map<String, UUID> byKey = new HashMap<>();
        for (UUID id : societyIds) {
            byKey.put(id.toString(), id);
        }

        Map<UUID, Rating> out = new HashMap<>();
        for (Object[] row : reviews.aggregateFor(ReviewTargetTypes.SOCIETY, byKey.keySet())) {
            UUID id = byKey.get((String) row[0]);
            if (id == null) {
                continue;
            }
            BigDecimal average = BigDecimal.valueOf(((Number) row[1]).doubleValue())
                    .setScale(SCALE, RoundingMode.HALF_UP);
            out.put(id, new Rating(average, ((Number) row[2]).longValue()));
        }
        return out;
    }
}
