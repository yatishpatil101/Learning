package com.draazy.api.moderation.property;

import com.draazy.api.catalog.listing.ListingQuota;
import com.draazy.api.catalog.listing.ListingService;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserService;
import com.draazy.api.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Posting a listing on an owner's behalf. Attribution is the whole feature, which is why it is a
 * separate route rather than a flag. */
@Service
public class OnBehalfListingService {

    private final ListingService listings;
    private final ListingQuota quota;
    private final UserRepository users;
    private final UserService userService;
    private final AuditService audit;

    public OnBehalfListingService(ListingService listings, ListingQuota quota,
            UserRepository users, UserService userService, AuditService audit) {
        this.listings = listings;
        this.quota = quota;
        this.users = users;
        this.userService = userService;
        this.audit = audit;
    }

    /** Two audit rows, since "operator X created a listing owned by Y" is a statement neither row
     * makes on its own. */
    @Transactional
    public Property create(AuthPrincipal caller, OnBehalfListingRequest body) {
        User owner = users.findByMobile(body.ownerMobile()).orElse(null);
        boolean provisioned = owner == null;
        if (provisioned) {
            owner = userService.provisionForStaff(body.ownerMobile(), body.ownerName());
            audit.record(caller, "user.provision_on_behalf", "user", owner.getId().toString(),
                    "mobile", body.ownerMobile());
        }

        Property created = listings.createOnBehalf(owner.getId(), body.listing(), owner.getId(), caller.userId());

        // The one creation path producing a listing its owner has never seen, so the only one that
        // owes anybody a hand-over.
        created.markPostedOnBehalf(caller.userId().toString());

        audit.record(caller, "property.create_on_behalf", "property", created.getId().toString(),
                "ownerId", owner.getId().toString(),
                "ownerMobile", body.ownerMobile(),
                "ownerProvisioned", String.valueOf(provisioned));
        return created;
    }

    /** The desk is exempt from the ceiling, not blind to it, so the numbers are published and the
     * upgrade conversation is left with the operator. */
    @Transactional(readOnly = true)
    public OwnerListingStanding standingFor(String mobile) {
        String digits = mobile == null ? "" : mobile.replaceAll("\\D", "");
        if (digits.length() != 10) {
            throw new BadRequestException("mobile must be a 10-digit number");
        }
        return users.findByMobile(digits)
                .map(owner -> {
                    ListingQuota.ListingStanding standing = quota.standingFor(owner.getId());
                    return new OwnerListingStanding(digits, true, standing.allowance(),
                            standing.held(), standing.overAllowance());
                })
                .orElseGet(() -> new OwnerListingStanding(digits, false, 0, 0, false));
    }

    public record OwnerListingStanding(String mobile, boolean known, int allowance, long held,
            boolean overAllowance) {
    }
}
