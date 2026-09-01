package com.punenest.api.catalog.property;

import com.punenest.api.common.trust.OwnerBadgeSink;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The catalogue's side of {@link OwnerBadgeSink}: identity says an owner earned their badge, and
 * this stamps it onto the listings they already hold.
 *
 * <p>Two lines of delegation, and worth its own file: it is the whole reason
 * {@code identity.verification} no longer imports {@code catalog}. The interface lives in the shared
 * kernel, the implementation lives with the table it writes, and the badge back-fill crosses the
 * boundary in the one direction the layering allows.
 *
 * <p>{@code Propagation.MANDATORY} on purpose. This is the second half of a two-write invariant —
 * the user's flag and their listings' denormalised copy must become true together — so being called
 * outside a transaction is a bug in the caller, not a case to handle. Failing loudly beats silently
 * committing half of it and leaving buyers looking at listings that call a verified owner
 * unverified.
 */
@Component
class OwnerBadgePropagator implements OwnerBadgeSink {

    private final PropertyRepository properties;

    OwnerBadgePropagator(PropertyRepository properties) {
        this.properties = properties;
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public int markOwnerVerified(UUID ownerId) {
        return properties.markOwnerVerified(ownerId);
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public int markOwnerUnverified(UUID ownerId) {
        return properties.markOwnerUnverified(ownerId);
    }
}
