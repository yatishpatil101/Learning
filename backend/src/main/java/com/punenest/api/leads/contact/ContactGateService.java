package com.punenest.api.leads.contact;

import com.punenest.api.common.trust.ContactGate;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
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
 * {@code approved} ({@link ContactStatuses#revealsContact}), <em>and</em> only when the owner has not
 * opted out of sharing digits at all ({@code users.hide_number}, V31). Anonymous, {@code pending},
 * {@code declined} and {@code none} all mask — the default of this class is to mask.
 *
 * <p><strong>Why {@code hideNumber} is decided here and not in the mapper.</strong>
 * {@code PropertyMapper.toOwner} also holds the owner entity and could read the flag in one line,
 * which is exactly why it must not: there would then be two places that decide a reveal, and the
 * second one is a mapper — where a future field addition looks like formatting work rather than a
 * trust decision. One decision point is the whole point of this class.
 */
@Service
public class ContactGateService implements ContactGate {

    private final ContactRequestRepository contactRequests;
    private final UserRepository users;

    public ContactGateService(ContactRequestRepository contactRequests, UserRepository users) {
        this.contactRequests = contactRequests;
        this.users = users;
    }

    /**
     * {@inheritDoc}
     *
     * <p>Ordered cheapest-first: an anonymous caller and the owner themselves are decided without
     * touching the database at all, which is the overwhelming majority of detail renders. The
     * {@code hideNumber} lookup is last, so it costs a query only on the rare path where a reveal was
     * otherwise about to happen.
     */
    @Override
    @Transactional(readOnly = true)
    public ContactVisibility visibilityFor(UUID viewerId, UUID propertyId, UUID ownerId) {
        if (viewerId == null || propertyId == null || ownerId == null) {
            return ContactVisibility.MASKED;
        }
        // The owner's own number is never hidden from the owner: hideNumber is about who else sees
        // it, and masking a person's own profile would just look like a bug.
        if (viewerId.equals(ownerId)) {
            return ContactVisibility.REVEALED;
        }
        boolean approved = contactRequests.existsByRequesterIdAndPropertyIdAndStatus(
                viewerId, propertyId, ContactRequestStatuses.APPROVED);
        if (!approved) {
            return ContactVisibility.MASKED;
        }
        return ownerHidesNumber(ownerId) ? ContactVisibility.MASKED : ContactVisibility.REVEALED;
    }

    /**
     * Whether this owner has opted out of sharing raw digits (D5).
     *
     * <p>A missing owner row masks. That should be unreachable — the caller just read the listing
     * this id came from — but the fallback of a privacy check has to be the private answer, or the
     * one case nobody anticipated is the one that leaks.
     */
    private boolean ownerHidesNumber(UUID ownerId) {
        return users.findById(ownerId).map(User::isHideNumber).orElse(true);
    }
}
