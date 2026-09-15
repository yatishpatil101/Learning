package com.draazy.api.catalog.property;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Catalog mechanics shared by moderation and owner actions, without a reverse dependency. */
@Component
public class PropertyLifecycle {
    private static final Set<String> OWNER = Set.of("submitted", "in_review", "clarification", "verified", "live");
    private static final Set<String> STAFF = Set.of("link_sent", "opened", "photos_docs", "live");
    private final AccountPermissions permissions;

    public PropertyLifecycle(AccountPermissions permissions) {
        this.permissions = permissions;
    }

    public void requireChecker(AuthPrincipal actor, Property property) {
        if (!permissions.granted(actor, BackOfficePermissions.PROPERTIES_READ)
                || !permissions.granted(actor, BackOfficePermissions.PROPERTIES_WRITE)) {
            throw new ForbiddenException("Property review permission is required");
        }
        if (actor.userId().equals(property.getOwner().getId())
                || actor.userId().toString().equals(property.getPostedByStaff())) {
            throw new ForbiddenException("You cannot approve or review your own listing");
        }
    }

    public void requireActive(Property property) {
        if (property.isArchived() || (!PropertyStatus.PENDING.equals(property.getStatus())
                && !PropertyStatus.APPROVED.equals(property.getStatus()))) {
            throw new ConflictException("Restore or resolve this listing's status before changing its lifecycle");
        }
    }

    public void verify(AuthPrincipal actor, Property property) {
        requireChecker(actor, property);
        requireActive(property);
        property.recordLifecycleVerification();
    }

    public void publish(AuthPrincipal actor, Property property, boolean requireVerification) {
        requireChecker(actor, property);
        if (requireVerification) {
            requireActive(property);
        } else if (property.isArchived() || PropertyStatus.SOLD.equals(property.getStatus())
                || PropertyStatus.RENTED.equals(property.getStatus())) {
            throw new ConflictException("Restore or reopen this listing before publishing it");
        }
        if (property.getLocalitySlug() == null || property.getLocalitySlug().isBlank()) {
            throw new ConflictException("Assign a locality before publishing this listing");
        }
        if (requireVerification && !PropertyStatus.APPROVED.equals(property.getStatus())
                && property.getLifecycleVerifiedAt() == null) {
            throw new ConflictException("Verify this listing before publishing it");
        }
        property.setStatus(PropertyStatus.APPROVED);
        property.setFlagReason(null);
        property.clearRecheck();
    }

    public void correct(AuthPrincipal actor, Property property, String stage) {
        requireChecker(actor, property);
        requireActive(property);
        Set<String> allowed = "staff".equals(property.getLifecycleTrack()) ? STAFF : OWNER;
        if (stage == null || !allowed.contains(stage)) {
            throw new BadRequestException("Invalid lifecycleStage for " + property.getLifecycleTrack() + " track");
        }
        if ("live".equals(stage)) {
            publish(actor, property, true);
        } else if ("verified".equals(stage)) {
            verify(actor, property);
        } else {
            property.revertToPending();
            property.recordLifecycleStage(stage);
        }
    }

    public void start(AuthPrincipal actor, Property property) {
        requireChecker(actor, property);
        requireActive(property);
        if ("submitted".equals(property.getLifecycleStage())) {
            property.recordLifecycleStage("in_review");
        }
    }

    public void message(AuthPrincipal actor, Property property, boolean clarification) {
        boolean owner = actor.userId().equals(property.getOwner().getId());
        if (clarification) {
            requireChecker(actor, property);
            requireActive(property);
            if (!"owner".equals(property.getLifecycleTrack())
                    || PropertyStatus.APPROVED.equals(property.getStatus())) {
                throw new ConflictException("Clarification requires an unpublished owner-track listing");
            }
            property.revertToPending();
            property.recordLifecycleStage("clarification");
        } else if (owner && "clarification".equals(property.getLifecycleStage())
                && PropertyStatus.PENDING.equals(property.getStatus()) && !property.isArchived()) {
            property.recordLifecycleStage("in_review");
        }
    }
}