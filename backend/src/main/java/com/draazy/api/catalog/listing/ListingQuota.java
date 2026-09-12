package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.ListingQuotaExhaustedException;
import com.draazy.api.common.trust.ListingAllowanceLookup;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * How many listings an owner may have, and whether they may have another.
 * Ceiling rules and the concierge exemption: docs/flows/consumer/list-property-wizard.md section 9.2.
 */
@Service
public class ListingQuota {

    private final PropertyRepository properties;
    private final ListingAllowanceLookup allowances;

    public ListingQuota(PropertyRepository properties, ListingAllowanceLookup allowances) {
        this.properties = properties;
        this.allowances = allowances;
    }

    /**
     * Refuse a post that would put the owner over their freemium ceiling. Callers must check before
     * anything is loaded or written, so a refused post leaves no half-built row behind.
     */
    public void require(UUID userId) {
        ListingStanding standing = standingFor(userId);
        if (standing.held() >= standing.allowance()) {
            throw new ListingQuotaExhaustedException(
                    "You already have " + standing.held() + " of " + standing.allowance()
                    + " listings live. "
                    + "Take one down, upgrade your plan, or refer an owner to earn another slot.");
        }
    }

    /**
     * How much of their ceiling an owner ({@code userId}, not the caller) is using - the same two
     * numbers {@link #require} refuses on, published so the concierge desk can judge instead.
     */
    @Transactional(readOnly = true)
    public ListingStanding standingFor(UUID userId) {
        return new ListingStanding(allowances.listingAllowance(userId),
                properties.countOccupyingListingSlots(userId, PropertyStatus.OCCUPIES_LISTING_SLOT));
    }

    /**
     * An owner's listing quota: what their plan and referrals permit, and how many listings
     * currently occupy a slot ({@code pending} and {@code approved}).
     */
    public record ListingStanding(int allowance, long held) {

        /** Whether they are past the ceiling — only reachable via the concierge desk. */
        public boolean overAllowance() {
            return held > allowance;
        }
    }
}
