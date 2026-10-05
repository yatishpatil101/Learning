package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.ListingQuotaExhaustedException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.trust.ListingAllowanceLookup;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ListingQuota {

    private static final Duration PACE_WINDOW = Duration.ofDays(1);

    private final PropertyRepository properties;
    private final ListingAllowanceLookup allowances;
    private final int maxPostsPerDay;

    public ListingQuota(PropertyRepository properties, ListingAllowanceLookup allowances,
            @Value("${draazy.listings.max-posts-per-day:3}") int maxPostsPerDay) {
        this.properties = properties;
        this.allowances = allowances;
        this.maxPostsPerDay = maxPostsPerDay;
    }

    public void requirePace(UUID userId) {
        if (properties.countPostedSince(userId, Instant.now().minus(PACE_WINDOW)) >= maxPostsPerDay) {
            throw new RateLimitedException("You can post up to " + maxPostsPerDay
                    + " new listings a day. Please try again tomorrow.", (int) PACE_WINDOW.toSeconds());
        }
    }

    /** Refuse a post that would put the owner over their freemium ceiling. Callers must check before
     * anything is loaded or written, so a refused post leaves no half-built row behind. */
    public void require(UUID userId) {
        ListingStanding standing = standingFor(userId);
        if (standing.held() >= standing.allowance()) {
            throw new ListingQuotaExhaustedException(
                    "You already have " + standing.held() + " of " + standing.allowance()
                    + " listings live. "
                    + "Take one down, upgrade your plan, or refer an owner to earn another slot.");
        }
    }

    /** How much of their ceiling an owner ({@code userId}, not the caller) is using - the same two
     * numbers {@link #require} refuses on, published so the concierge desk can judge instead. */
    @Transactional(readOnly = true)
    public ListingStanding standingFor(UUID userId) {
        return new ListingStanding(allowances.listingAllowance(userId),
                properties.countOccupyingListingSlots(userId, PropertyStatus.OCCUPIES_LISTING_SLOT));
    }

    public record ListingStanding(int allowance, long held) {

        public boolean overAllowance() {
            return held > allowance;
        }
    }
}
