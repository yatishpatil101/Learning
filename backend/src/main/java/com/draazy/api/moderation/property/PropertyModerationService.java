package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.moderation.verification.ApprovalGate;
import com.draazy.api.moderation.verification.PropertyReview;
import com.draazy.api.moderation.verification.PropertyReviewRepository;
import com.draazy.api.moderation.verification.ReviewChecklistItem;
import com.draazy.api.moderation.verification.ReviewReasonCodes;
import com.draazy.api.moderation.verification.VerificationCases;
import com.draazy.api.moderation.signal.ListingSignalService;
import com.draazy.api.security.AuthPrincipal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Every method writes an audit row because one user is changing another's listing.
@Service
public class PropertyModerationService {

    private static final Set<String> SETTABLE = Set.of(
            PropertyStatus.PENDING, PropertyStatus.APPROVED, PropertyStatus.REJECTED);

    private final PropertyRepository properties;
    private final AuditService audit;
    private final Notifier notifier;
    private final PropertyLifecycle lifecycle;
    private final VerificationCases cases;
    private final PropertyReviewRepository reviews;
    private final ListingSignalService signals;

    public PropertyModerationService(PropertyRepository properties, AuditService audit,
            Notifier notifier, PropertyLifecycle lifecycle, VerificationCases cases,
            PropertyReviewRepository reviews, ListingSignalService signals) {
        this.properties = properties;
        this.audit = audit;
        this.notifier = notifier;
        this.lifecycle = lifecycle;
        this.cases = cases;
        this.reviews = reviews;
        this.signals = signals;
    }

    @Transactional
    public Property setStatus(AuthPrincipal actor, String id, String status, String reason,
            String reasonCode, String expectedStatus) {
        if (!SETTABLE.contains(status)) {
            throw new BadRequestException("invalid_status", "status must be one of " + SETTABLE
                    + "; use /flag or /archive for the others");
        }
        Property property = load(id);
        lifecycle.requireChecker(actor, property);
        String from = property.getStatus();
        boolean clearingApprovedRecheck = PropertyStatus.APPROVED.equals(status)
                && PropertyStatus.APPROVED.equals(from) && property.isRecheckPending();
        requireExpected(from, expectedStatus);
        if (PropertyStatus.APPROVED.equals(status)) {
            if (PropertyStatus.REJECTED.equals(from)) {
                throw new ConflictException("second_approver_required",
                        "A final rejection requires a second staff approver to approve.");
            }

            // Before anything is written, so a refusal costs the moderator nothing to retry.
            lifecycle.requireFiled(property);
        } else if (PropertyStatus.REJECTED.equals(status)) {
            ReviewReasonCodes.require("reject", reasonCode, reason);
        }

        if (PropertyStatus.APPROVED.equals(status)) {

            /* Re-listing a home whose deal fell through is an approval, so return the row to the queue first
               and let the verification below be real. An archived listing has its own restore verb. */
            if (!property.isArchived() && (PropertyStatus.SOLD.equals(from) || PropertyStatus.RENTED.equals(from))) {
                lifecycle.reenterPending(actor, property);
            }
            PropertyReview review = cases.ensure(property.getId(), property.getDeal());
            ApprovalGate.require(review);
            if (!clearingApprovedRecheck) {
                requireNoSecondApproverBlock(property);
                if (review.getDecidedAt() == null || !PropertyStatus.APPROVED.equals(review.getStatus())) {
                    review.decide(PropertyStatus.APPROVED, actor.userId().toString(), reason, null);
                    reviews.saveAndFlush(review);
                }
                lifecycle.publish(actor, property);
            }
        } else if (PropertyStatus.REJECTED.equals(status)) {
            String normalizedReason = ReviewReasonCodes.require("reject", reasonCode, reason);
            PropertyReview review = cases.ensure(property.getId(), property.getDeal());
            review.decide(PropertyStatus.REJECTED, actor.userId().toString(), reason, normalizedReason);
            review.addMessage(actor.userId(), rejectionMessage(normalizedReason, reason));
            reviews.saveAndFlush(review);
            property.setStatus(status);
        } else {
            if (property.isArchived() || PropertyStatus.SOLD.equals(property.getStatus())
                    || PropertyStatus.RENTED.equals(property.getStatus())) {
                throw new ConflictException("Restore or reopen this listing first");
            }
            if (PropertyStatus.REJECTED.equals(property.getStatus())) {
                throw new ConflictException("second_approver_required",
                        "A final rejection requires a second staff approver to reopen.");
            }
            lifecycle.reenterPending(actor, property);
        }
        property.clearRecheck();
        audit.record(actor, "property.status", "property", id, "from", from, "to", status,
                "reason", reason, "reasonCode", reasonCode,
                "checklist", checklistSnapshot(property.getId()),
                "owner", String.valueOf(property.getOwner().getId()));

        // Only the two terminal verdicts are announced; a bounce back to `pending` is a queue move.
        // A rejected listing is not publicly viewable, so its link points at the dashboard.
        UUID ownerId = property.getOwner().getId();
        if (PropertyStatus.APPROVED.equals(status) && !clearingApprovedRecheck) {
            notifier.notify(ownerId, "listing.approved",
                    "Your listing is approved",
                    "It is now live and visible to buyers.",
                    "/property/" + property.getId());
        } else if (PropertyStatus.REJECTED.equals(status)) {
            String ownerMessage = ReviewReasonCodes.ownerMessage(reasonCode, reason);
            notifier.notify(ownerId, "listing.rejected",
                    "Your listing was not approved",
                    "A moderator could not approve it: " + ownerMessage,
                    "/dashboard");
        }
        return property;
    }

    // Sets both status and flag_reason: the status delists, the reason is for humans.
    @Transactional
    public Property flag(AuthPrincipal actor, String id, String reason) {
        Property property = load(id);
        lifecycle.requireChecker(actor, property);
        if (PropertyStatus.REJECTED.equals(property.getStatus())) {
            throw new ConflictException("second_approver_required",
                    "A final rejection requires a second staff approver to reopen.");
        }

        String from = property.getStatus();
        property.setStatus(PropertyStatus.FLAGGED);
        property.setFlagReason(reason == null || reason.isBlank() ? "Flagged" : reason);
        audit.record(actor, "property.flag", "property", id, "from", from, "reason", reason,
                "owner", String.valueOf(property.getOwner().getId()));
        return property;
    }

    @Transactional
    public void clearFlag(AuthPrincipal actor, String id) {
        Property property = load(id);
        lifecycle.requireChecker(actor, property);
        if (!PropertyStatus.FLAGGED.equals(property.getStatus())) {
            throw new ConflictException("Listing is not flagged");
        }

        if (property.isArchived() || PropertyStatus.SOLD.equals(property.getStatus())
                || PropertyStatus.RENTED.equals(property.getStatus())) {
            property.setFlagReason(null);
            audit.record(actor, "property.flag.clear", "property", id, "from", property.getStatus(),
                    "owner", String.valueOf(property.getOwner().getId()));
            return;
        }

        String from = property.getStatus();
        property.setFlagReason(null);
        lifecycle.reenterPending(actor, property);
        audit.record(actor, "property.flag.clear", "property", id, "from", from,
                "owner", String.valueOf(property.getOwner().getId()));
    }

    private static void requireExpected(String current, String expected) {
        if (expected != null && !expected.isBlank() && !current.equals(expected)) {
            throw new ConflictException("stale_decision",
                    "Listing status changed; refresh before deciding");
        }
    }

    private static String rejectionMessage(String reasonCode, String note) {
        return "\u26D4 Your property could not be approved.\nReason: "
                + ReviewReasonCodes.ownerMessage(reasonCode, note);
    }

    private Map<String, Boolean> checklistSnapshot(UUID propertyId) {
        return reviews.findByPropertyId(propertyId)
                .map(review -> {
                    Map<String, Boolean> snapshot = new LinkedHashMap<>();
                    for (ReviewChecklistItem item : review.getChecklist()) {
                        snapshot.put(item.getItem(), item.isPass());
                    }
                    return snapshot;
                })
                .orElseGet(Map::of);
    }

    private void requireNoSecondApproverBlock(Property property) {
        if (signals.hasHardSignal(property.getId())) {
            throw new ConflictException("second_approver_required",
                    "A hard broker signal requires a second staff approver.");
        }
    }

    private Property load(String idOrSlug) {
        UUID id = Ids.parseUuid(idOrSlug).orElseGet(() -> properties.findBySlug(idOrSlug)
            .map(Property::getId).orElseThrow(() -> NotFoundException.of("Property")));
        return properties.findForVerificationDecision(id)
            .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
