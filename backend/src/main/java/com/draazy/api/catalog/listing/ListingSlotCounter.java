package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.trust.ListingSlotLookup;
import java.util.UUID;
import org.springframework.stereotype.Component;

// Its own bean, not ListingQuota: ListingQuota needs billing's allowance, so billing needing it back
// would be a constructor cycle.
@Component
class ListingSlotCounter implements ListingSlotLookup {

    private final PropertyRepository properties;

    ListingSlotCounter(PropertyRepository properties) {
        this.properties = properties;
    }

    @Override
    public long listingSlotsHeld(UUID userId) {
        return properties.countOccupyingListingSlots(userId, PropertyStatus.OCCUPIES_LISTING_SLOT);
    }
}
