package com.draazy.api.leads.contact;

import com.draazy.api.common.trust.ContactGate;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.identity.user.UserRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ContactGateService implements ContactGate {

    private final ContactRequestRepository contactRequests;
    private final UserRepository users;

    public ContactGateService(ContactRequestRepository contactRequests, UserRepository users) {
        this.contactRequests = contactRequests;
        this.users = users;
    }

    // Owners see their own number; every other viewer gets the masked form.
    @Override
    public ContactVisibility visibilityFor(UUID viewerId, UUID propertyId, UUID ownerId) {
        if (viewerId != null && viewerId.equals(ownerId)) {
            return ContactVisibility.REVEALED;
        }
        if (viewerId == null || propertyId == null || ownerId == null) {
            return ContactVisibility.MASKED;
        }
        boolean ownerHidesNumber = users.findById(ownerId).map(u -> u.isHideNumber()).orElse(true);
        boolean viewerApproved = contactRequests.existsByRequesterIdAndPropertyIdAndStatus(
                viewerId, propertyId, ContactRequestStatuses.APPROVED);
        return visibilityForKnownStatus(viewerId, ownerId, ownerHidesNumber, viewerApproved);
    }

    public ContactVisibility visibilityForKnownStatus(UUID viewerId, UUID ownerId,
            boolean ownerHidesNumber, boolean viewerApproved) {
        if (viewerId == null || ownerId == null) {
            return ContactVisibility.MASKED;
        }
        if (viewerId.equals(ownerId)) {
            return ContactVisibility.REVEALED;
        }
        return viewerApproved && !ownerHidesNumber
                ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }

    public ContactVisibility approvedRequesterVisibility(UUID ownerId, UUID requesterId,
            boolean requesterApproved) {
        if (ownerId == null || requesterId == null) {
            return ContactVisibility.MASKED;
        }
        return ownerId.equals(requesterId) || requesterApproved
                ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }
}
