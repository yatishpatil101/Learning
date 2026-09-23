package com.draazy.api.moderation.property;

import com.draazy.api.catalog.listing.ListingQuota;
import com.draazy.api.catalog.listing.ListingService;
import com.draazy.api.catalog.property.PipelineStage;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
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
    private final PropertyRepository properties;
    private final UserRepository users;
    private final UserService userService;
    private final AuditService audit;

    public OnBehalfListingService(ListingService listings, ListingQuota quota,
            PropertyRepository properties, UserRepository users, UserService userService,
            AuditService audit) {
        this.listings = listings;
        this.quota = quota;
        this.properties = properties;
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

        Property created = listings.createOnBehalf(owner.getId(), body.listing(), body.postedByType());
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

    /** Body of {@code getOwnerListingStanding}; {@code known = false} for a number with no account. */
    public record OwnerListingStanding(String mobile, boolean known, int allowance, long held,
            boolean overAllowance) {
    }

    /** Moves a staff-created listing along either funnel; the vocabularies are disjoint, so the
     * value alone says which column is meant. */
    @Transactional
    public Property advance(AuthPrincipal caller, String propertyId, String stage) {
        if (!PipelineStage.isKnown(stage)) {
            throw new BadRequestException("stage must be one of "
                    + String.join(", ", PipelineStage.ORDER) + " (acquisition) or "
                    + String.join(", ", PipelineStage.HANDBACK_ORDER) + " (hand-back)");
        }
        Property property = Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
        if (!property.isPostedByAdmin()) {
            throw new ConflictException(
                    "This listing was posted by its owner, so it has no hand-back to track");
        }

        String from = PipelineStage.isHandback(stage)
                ? property.getHandbackMilestone()
                : property.getPipelineStage();
        property.moveToStage(stage);
        audit.record(caller, "property.pipeline", "property", propertyId,
                "from", String.valueOf(from), "to", stage,
                "owner", String.valueOf(property.getOwner().getId()));
        return property;
    }
}
