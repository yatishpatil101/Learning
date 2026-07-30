package com.punenest.api.leads.contact;

import com.punenest.api.common.trust.ContactGate;
import com.punenest.api.common.trust.ContactVisibility;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The contacts feature's implementation of the shared-kernel {@link ContactGate} port — the seam that
 * lets {@code catalog} mask or reveal an owner mobile without importing this package
 * ({@code package-structure.md} §5; see the slice-3 cross-context decision).
 *
 * <p>Deliberately tiny and dependency-free apart from its own repository: it is called on every
 * authenticated property-detail render, so it must be one indexed existence check, and it must be
 * readable end-to-end in one screen because it is the last line of defence on the reveal.
 *
 * <p><strong>Invariant:</strong> the raw mobile is revealed only at gate status {@code owner} or
 * {@code approved} ({@link ContactStatuses#revealsContact}). Anonymous, {@code pending},
 * {@code declined} and {@code none} all mask — the default of this class is to mask.
 */
@Service
public class ContactGateService implements ContactGate {

    private final ContactRequestRepository contactRequests;

    public ContactGateService(ContactRequestRepository contactRequests) {
        this.contactRequests = contactRequests;
    }

    /**
     * {@inheritDoc}
     *
     * <p>Ordered cheapest-first: an anonymous caller and the owner themselves are decided without
     * touching the database at all, which is the overwhelming majority of detail renders.
     */
    @Override
    @Transactional(readOnly = true)
    public ContactVisibility visibilityFor(UUID viewerId, UUID propertyId, UUID ownerId) {
        if (viewerId == null || propertyId == null || ownerId == null) {
            return ContactVisibility.MASKED;
        }
        if (viewerId.equals(ownerId)) {
            return ContactVisibility.REVEALED;
        }
        boolean approved = contactRequests.existsByRequesterIdAndPropertyIdAndStatus(
                viewerId, propertyId, ContactRequestStatuses.APPROVED);
        return approved ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }
}
