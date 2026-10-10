package com.draazy.api.catalog.owner;

import com.draazy.api.catalog.property.ListingCounts;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Lives in {@code catalog}, not {@code identity}: {@code catalog} already depends on {@code identity},
 * so needing a live-listing count there would otherwise make the package graph cyclic. */
@Service
public class OwnerProfileService {

    /** Fixed to India, not the server zone: an account created at 04:00 IST on 1 January is last year in UTC. */
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final UserRepository users;
    private final ListingCounts listingCounts;

    public OwnerProfileService(UserRepository users, ListingCounts listingCounts) {
        this.users = users;
        this.listingCounts = listingCounts;
    }

    /** Archived and malformed ids both 404, so a soft-deleted person is unreachable and enumerators learn nothing;
     * no role check, as "owner" is just anyone with listings. */
    @Transactional(readOnly = true)
    public OwnerProfileResponse byId(String id) {
        UUID uuid;
        try {
            uuid = UUID.fromString(id);
        } catch (IllegalArgumentException notAnId) {
            throw NotFoundException.of("Owner");
        }
        User owner = users.findByIdAndArchivedFalse(uuid)
                .orElseThrow(() -> NotFoundException.of("Owner"));
        return new OwnerProfileResponse(
                owner.getName(),
                MobileMask.mask(owner.getMobile()),
                owner.isVerified(),
                owner.getCity(),
                owner.getJoinedAt() == null ? null : owner.getJoinedAt().atZone(IST).getYear(),
                listingCounts.forOwner(uuid));
    }
}
