package com.draazy.api.catalog.property;

import com.draazy.api.common.trust.OwnerBadgeSink;
import com.draazy.api.common.trust.VerifiedBadgeCopy;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Must run in the caller's transaction so user flag and listing copies flip together. */
@Component
class OwnerBadgePropagator implements OwnerBadgeSink {

    private final PropertyRepository properties;
    private final List<VerifiedBadgeCopy> copies;

    OwnerBadgePropagator(PropertyRepository properties, List<VerifiedBadgeCopy> copies) {
        this.properties = properties;
        this.copies = copies;
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public int markOwnerVerified(UUID ownerId) {
        int listings = properties.markOwnerVerified(ownerId);
        copies.forEach(c -> c.copyBadge(ownerId, true));
        return listings;
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public int markOwnerUnverified(UUID ownerId) {
        int listings = properties.markOwnerUnverified(ownerId);
        copies.forEach(c -> c.copyBadge(ownerId, false));
        return listings;
    }
}
