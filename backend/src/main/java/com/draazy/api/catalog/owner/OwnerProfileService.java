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

/**
 * Assembles the public seller card.
 *
 * <p><strong>Why this lives in {@code catalog} and not in {@code identity}.</strong> It reads a
 * user, so the obvious home is beside {@link UserRepository} — but it also needs a live-listing
 * count, and {@code catalog} already depends on {@code identity} (the property mapper reads the
 * owner off every listing). Putting it the other way round would make that arrow point both ways
 * for the sake of one endpoint. The package graph stays acyclic, and the placement happens to be
 * honest as well: this is the seller's page in a marketplace, not an account screen.
 */
@Service
public class OwnerProfileService {

    /**
     * The zone the "member since" year is read in.
     *
     * <p>Fixed to India rather than the server's default, because the answer differs: an account
     * created at 04:00 IST on 1 January is still the previous year in UTC, and a profile that says
     * "member since 2023" to a Pune reader whose confirmation email says 2024 is a small, permanent
     * embarrassment. The platform is single-country, so there is one right answer here.
     */
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final UserRepository users;
    private final ListingCounts listingCounts;

    public OwnerProfileService(UserRepository users, ListingCounts listingCounts) {
        this.users = users;
        this.listingCounts = listingCounts;
    }

    /**
     * One owner's public card, or {@code 404}.
     *
     * <p><strong>An archived account is a 404, not an empty profile.</strong> {@code
     * findByIdAndArchivedFalse} is the same read every other surface uses, and the reason to reuse
     * it rather than filter afterwards is that a soft-deleted person must not remain reachable at a
     * stable public URL — that is the difference between deleting an account and hiding it.
     *
     * <p><strong>A malformed id is also a 404.</strong> The path is a string and the column is a
     * UUID, so a caller can send something that is not an id at all. That is a request for an owner
     * who does not exist, and answering {@code 400} would tell an enumerator that their guess was
     * merely badly formatted rather than wrong — the two should be indistinguishable from outside.
     *
     * <p><strong>No role check.</strong> "Owner" is what the page calls someone who has listings,
     * not a role this platform stores; a buyer who lists their flat next week is the same row. The
     * card is capped so tightly that it says nothing about a person with no listings that it would
     * not say about one with ten, and {@code listingCount} answers zero honestly.
     */
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
                owner.getId().toString(),
                owner.getName(),
                MobileMask.mask(owner.getMobile()),
                owner.isVerified(),
                owner.getCity(),
                owner.getJoinedAt() == null ? null : owner.getJoinedAt().atZone(IST).getYear(),
                listingCounts.forOwner(uuid));
    }
}
