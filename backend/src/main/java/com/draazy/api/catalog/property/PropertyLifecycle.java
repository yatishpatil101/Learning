package com.draazy.api.catalog.property;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

@Component
public class PropertyLifecycle {
    private final AccountPermissions permissions;
    private final ApplicationEventPublisher events;
    private final PropertyPublicationGate publicationGate;

    public PropertyLifecycle(AccountPermissions permissions, ApplicationEventPublisher events,
            PropertyPublicationGate publicationGate) {
        this.permissions = permissions;
        this.events = events;
        this.publicationGate = publicationGate;
    }

    public void requireChecker(AuthPrincipal actor, Property property) {
        if (!permissions.granted(actor, BackOfficePermissions.PROPERTIES_READ)
                || (!permissions.granted(actor, BackOfficePermissions.PROPERTIES_MODERATE)
                && !permissions.granted(actor, BackOfficePermissions.PROPERTIES_VERIFY))) {
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

    /** Every locality-keyed read skips a null slug, so a listing published without one is unreachable. Called
     * by both approve routes before either writes, so a rollback cannot cost a reviewer their verdict. */
    public void requireFiled(Property property) {
        if (property.getLocalitySlug() == null || property.getLocalitySlug().isBlank()) {
            throw new ConflictException("This listing has no locality, so approving it would"
                    + " publish it out of locality search, its locality page, saved-search alerts"
                    + " and the society join. Ask the owner to pick the locality from the"
                    + " suggestions (they typed '" + property.getLocality() + "').");
        }
    }

    public void publish(AuthPrincipal actor, Property property) {
        publish(actor, property, false);
    }

    public void publishWithSecondApproval(AuthPrincipal actor, Property property) {
        publish(actor, property, true);
    }

    private void publish(AuthPrincipal actor, Property property, boolean secondApprovalSatisfied) {
        requireChecker(actor, property);
        requireActive(property);
        requireFiled(property);
        if (!PropertyStatus.APPROVED.equals(property.getStatus()) && property.awaitsOwnerConfirmation()) {
            throw new ConflictException("owner_not_confirmed",
                    "The owner has not confirmed this listing yet. Send the claim link and wait for them to confirm.");
        }
        publicationGate.requirePublishable(actor, property, secondApprovalSatisfied);
        property.setStatus(PropertyStatus.APPROVED);
        property.setFlagReason(null);
        property.clearRecheck();
        events.publishEvent(new PropertyPublished(property.getId()));
    }

    public void start(AuthPrincipal actor, Property property) {
        requireChecker(actor, property);
        requireActive(property);
        if (PropertyStatus.PENDING.equals(property.getStatus())) {
            property.startReview();
        }
    }

    public void message(AuthPrincipal actor, Property property, boolean clarification) {
        boolean owner = actor.userId().equals(property.getOwner().getId());
        if (clarification) {
            requireChecker(actor, property);
            requireActive(property);
            if (PropertyStatus.APPROVED.equals(property.getStatus())) {
                throw new ConflictException("Clarification requires an unpublished listing");
            }
            reenterPending(actor, property);
            property.requestInfo();
        } else if (owner && property.isAwaitingOwnerInfo()
                && PropertyStatus.PENDING.equals(property.getStatus()) && !property.isArchived()) {
            property.provideInfo();
            publishReentry(actor, property);
        }
    }

    public void reenterPending(AuthPrincipal actor, Property property) {
        if (PropertyStatus.REJECTED.equals(property.getStatus())) {
            throw new ConflictException("second_approver_required",
                    "A final rejection requires a second staff approver to reopen.");
        }
        reenterPendingAfterSecondApproval(actor, property);
    }

    public void reenterPendingAfterSecondApproval(AuthPrincipal actor, Property property) {
            // The rejection told the owner to reply here to resubmit, and this is the only route out of
            // REJECTED that needs no moderator. Owner-track only: "in_review" is not in the staff vocabulary.
        property.revertToPending();
        publishReentry(actor, property);
    }

    private void publishReentry(AuthPrincipal actor, Property property) {
        events.publishEvent(new ReviewReentered(property.getId(), actor.userId().toString(), actor.role()));
    }

    public record ReviewReentered(UUID propertyId, String actorId, String actorRole) {
    }
}
