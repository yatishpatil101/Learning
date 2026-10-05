package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.moderation.signal.ListingSignalService;
import com.draazy.api.security.AuthPrincipal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PropertyVerificationOverrideService {

    private final PropertyRepository properties;
    private final VerificationCases cases;
    private final PropertyReviewRepository reviews;
    private final PropertyOverrideRequestRepository overrideRequests;
    private final PropertyLifecycle lifecycle;
    private final ListingSignalService signals;
    private final AuditService audit;
    private final Notifier notifier;
    private final PropertyVerificationService verification;

    public PropertyVerificationOverrideService(PropertyRepository properties, VerificationCases cases,
            PropertyReviewRepository reviews, PropertyOverrideRequestRepository overrideRequests,
            PropertyLifecycle lifecycle, ListingSignalService signals, AuditService audit,
            Notifier notifier, PropertyVerificationService verification) {
        this.properties = properties;
        this.cases = cases;
        this.reviews = reviews;
        this.overrideRequests = overrideRequests;
        this.lifecycle = lifecycle;
        this.signals = signals;
        this.audit = audit;
        this.notifier = notifier;
        this.verification = verification;
    }

    @Transactional
    public PropertyReviewResponse request(AuthPrincipal actor, String propertyId, String reason) {
        Property property = loadForWrite(propertyId);
        lifecycle.requireChecker(actor, property);
        String action = PropertyStatus.REJECTED.equals(property.getStatus())
                ? PropertyOverrideRequest.REVERSE_REJECT : PropertyOverrideRequest.APPROVE;
        String trimmedReason = validReason(reason);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        if (PropertyOverrideRequest.APPROVE.equals(action)) {
            lifecycle.requireActive(property);
            lifecycle.requireFiled(property);
            ApprovalGate.require(review);
            if (!signals.hasHardSignal(property.getId())) {
                throw new ConflictException("override_not_required",
                        "This listing does not require a second approver.");
            }
        }
        PropertyOverrideRequest request = savePending(property, actor.userId(), action, trimmedReason);
        audit.record(actor, "property.verification.override.requested", "property_override_request",
                request.getId().toString(), "propertyId", property.getId().toString(),
                "action", action, "reason", trimmedReason);
        return verification.get(actor, propertyId);
    }

    @Transactional
    public PropertyReviewResponse approve(AuthPrincipal actor, String propertyId,
            String requestId, String note) {
        PropertyOverrideRequest request = locked(requestId);
        Property property = loadForWrite(propertyId);
        if (!property.getId().equals(request.getPropertyId())) {
            throw NotFoundException.of("Property override request");
        }
        lifecycle.requireChecker(actor, property);
        requirePending(request);
        if (actor.userId().equals(request.getRequestedBy())) {
            throw new ForbiddenException("A second approver must be different from the requester.");
        }
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        if (PropertyOverrideRequest.APPROVE.equals(request.getAction())) {
            approveListing(actor, property, review, note);
        } else {
            reopenFinalReject(actor, property);
        }
        request.approve(actor.userId(), blankToNull(note));
        overrideRequests.saveAndFlush(request);
        audit.record(actor, "property.verification.override.approved", "property_override_request",
                request.getId().toString(), "propertyId", property.getId().toString(),
                "action", request.getAction(), "requestedBy", request.getRequestedBy().toString(),
                "note", note);
        return verification.get(actor, propertyId);
    }

    private void approveListing(AuthPrincipal actor, Property property, PropertyReview review,
            String note) {
        lifecycle.requireActive(property);
        lifecycle.requireFiled(property);
        ApprovalGate.require(review);
        review.decide(PropertyStatus.APPROVED, actor.userId().toString(), null, null);
        if (note != null && !note.isBlank()) {
            review.addInternalNote(note.trim());
        }
        review.addMessage(actor.userId(), decisionMessage());
        lifecycle.publishWithSecondApproval(actor, property);
        reviews.saveAndFlush(review);
        audit.record(actor, "property.verification.decision", "property", property.getId().toString(),
                "decision", PropertyOverrideRequest.APPROVE, "note", note, "reasonCode", null,
                "checklist", checklistSnapshot(review),
                "owner", String.valueOf(property.getOwner().getId()));
        notifier.notify(property.getOwner().getId(), "listing.approved",
                "Your listing is approved", "It is now live and visible to buyers.",
                "/property/" + property.getId());
    }

    private void reopenFinalReject(AuthPrincipal actor, Property property) {
        if (!PropertyStatus.REJECTED.equals(property.getStatus())) {
            throw new ConflictException("stale_decision",
                    "Listing status changed; refresh before deciding");
        }
        lifecycle.reenterPendingAfterSecondApproval(actor, property);
    }

    private PropertyOverrideRequest savePending(Property property, UUID requestedBy,
            String action, String reason) {
        if (overrideRequests.existsByPropertyIdAndActionAndStatus(
                property.getId(), action, PropertyOverrideRequest.PENDING)) {
            throw new ConflictException("override_request_pending",
                    "This listing already has a pending second-approver request.");
        }
        try {
            return overrideRequests.saveAndFlush(new PropertyOverrideRequest(
                    property.getId(), requestedBy, action, reason));
        } catch (DataIntegrityViolationException conflict) {
            throw new ConflictException("override_request_pending",
                    "This listing already has a pending second-approver request.");
        }
    }

    private PropertyOverrideRequest locked(String requestId) {
        UUID id = Ids.parseUuid(requestId).orElseThrow(() -> NotFoundException.of("Property override request"));
        return overrideRequests.findByIdForUpdate(id)
                .orElseThrow(() -> NotFoundException.of("Property override request"));
    }

    private Property loadForWrite(String propertyId) {
        return Ids.parseUuid(propertyId).flatMap(properties::findForVerificationDecision)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private static void requirePending(PropertyOverrideRequest request) {
        if (!request.isPending()) {
            throw new ConflictException("override_request_decided",
                    "This second-approver request is already " + request.getStatus());
        }
    }

    private static String validReason(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.length() < 10 || trimmed.length() > 300) {
            throw new BadRequestException("reason must be 10 to 300 characters after trimming");
        }
        return trimmed;
    }

    private static String decisionMessage() {
        return "\u2705 Your property has been verified and is now live.";
    }

    private static Map<String, Boolean> checklistSnapshot(PropertyReview review) {
        Map<String, Boolean> snapshot = new LinkedHashMap<>();
        for (ReviewChecklistItem item : review.getChecklist()) {
            snapshot.put(item.getItem(), item.isPass());
        }
        return snapshot;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
