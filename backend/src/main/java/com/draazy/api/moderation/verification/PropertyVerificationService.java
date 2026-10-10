package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.ListingProgress;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.moderation.signal.ListingSignalService;
import com.draazy.api.moderation.signal.ListingSignals;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Strangers get 404, not 403, so verification cases do not become an oracle.
@Service
public class PropertyVerificationService {

    private final PropertyReviewRepository reviews;
    private final PropertyRepository properties;
    private final VerificationCases cases;
    private final AccountPermissions permissions;
    private final AuditService audit;
    private final PropertyLifecycle lifecycle;
    private final DocumentRepository documents;
    private final Notifier notifier;
    private final ListingSignalService signals;
    private final PropertyOverrideRequestRepository overrideRequests;

    public PropertyVerificationService(PropertyReviewRepository reviews, PropertyRepository properties,
            VerificationCases cases, AccountPermissions permissions, AuditService audit,
            PropertyLifecycle lifecycle, DocumentRepository documents, Notifier notifier,
            ListingSignalService signals, PropertyOverrideRequestRepository overrideRequests) {
        this.reviews = reviews;
        this.properties = properties;
        this.cases = cases;
        this.permissions = permissions;
        this.audit = audit;
        this.lifecycle = lifecycle;
        this.documents = documents;
        this.notifier = notifier;
        this.signals = signals;
        this.overrideRequests = overrideRequests;
    }

    @Transactional(readOnly = true)
    public PropertyReviewResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        boolean checker = mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId());
        PropertyReview review = ownerVisibleCase(property, checker);
        return toResponse(review, property, checker);
    }

    // Owners cannot see a case containing only staff-only notes; that closes the probe oracle.
    private PropertyReview ownerVisibleCase(Property property, boolean checker) {
        PropertyReview review = requireCase(property);
        if (!checker && review.getReviewer() == null && review.getDecidedAt() == null
                && !review.getMessages().isEmpty()
                && review.getMessages().stream().allMatch(ReviewMessage::isInternal)) {
            throw new NotFoundException("No verification review for this listing");
        }
        return review;
    }

    // Idempotent because property_reviews.property_id is UNIQUE.
    @Transactional
    public PropertyReviewResponse initiate(AuthPrincipal actor, String propertyId, boolean markRead) {
        Property property = participantPropertyForWrite(actor, propertyId);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        if (markRead) {
            markOthersRead(actor, property, review);
        }
        return toResponse(review,
            property, mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId()));
    }

    // Opens the case instead of requiring one, closing the oracle on message routes.
    @Transactional
    public PropertyReviewResponse addMessage(AuthPrincipal actor, String propertyId, String body,
            boolean clarificationRequested) {
        if (body == null || body.isBlank()) {
            throw new BadRequestException("body is required");
        }
        Property property = participantPropertyForWrite(actor, propertyId);
        boolean checker = mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId());
        if (clarificationRequested && checker) {
            return decide(actor, propertyId, "needs_info", body.trim(), "other", null);
        }
        boolean resubmitting = !checker && PropertyStatus.PENDING.equals(property.getStatus())
                && property.isAwaitingOwnerInfo() && !property.isArchived();
        lifecycle.message(actor, property, clarificationRequested);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        if (resubmitting) {
            review.reopen();
        }
        review.addMessage(actor.userId(), body.trim(), clarificationRequested);

        reviews.saveAndFlush(review);
        return toResponse(review, property, checker);
    }

    // Marks only the other side's messages the caller could have seen.
    @Transactional
    public void markRead(AuthPrincipal actor, String propertyId) {
        Property property = participantPropertyForWrite(actor, propertyId);
        reviews.findByPropertyId(property.getId())
                .ifPresent(review -> markOthersRead(actor, property, review));
    }

    private void markOthersRead(AuthPrincipal actor, Property property, PropertyReview review) {
        boolean checker = mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId());
        review.getMessages().stream()
                .filter(message -> checker || !message.isInternal())
                .filter(message -> !actor.userId().equals(message.getSenderId()))
                .forEach(ReviewMessage::markRead);
    }

    // Approval also publishes in this transaction; a catalogue-missing verdict is no verdict.
    @Transactional
    public PropertyReviewResponse decide(AuthPrincipal actor, String propertyId, String decision,
            String note, String reasonCode, String expectedStatus) {
        boolean approve = "approve".equals(decision);
        boolean needsInfo = "needs_info".equals(decision);
        boolean reject = "reject".equals(decision);
        if (!approve && !needsInfo && !reject) {
            throw new BadRequestException("decision must be approve, needs_info or reject");
        }
        String normalizedReason = ReviewReasonCodes.require(decision, reasonCode, note);
        Property property = loadForWrite(propertyId);
        lifecycle.requireChecker(actor, property);
        lifecycle.requireActive(property);
        PropertyReview review = requireCase(property);
        requireExpected(property.getStatus(), PropertyReviewStatuses.wire(review), expectedStatus);
        boolean publishingVerifiedApproval = approve
                && PropertyStatus.APPROVED.equals(review.getStatus())
                && !PropertyStatus.APPROVED.equals(property.getStatus());
        if (review.getDecidedAt() != null && !property.isRecheckPending() && !publishingVerifiedApproval
                && !PropertyReviewStatuses.NEEDS_INFO.equals(review.getStatus())) {
            throw new ConflictException("stale_decision",
                    "Listing status changed; refresh before deciding");
        }
        if (approve) {
            ApprovalGate.require(review);
            requireNoSecondApproverBlock(property);

                // Checked before the verdict is written, not left to `publish` below: the rollback would
                // take the verdict with it and cost the reviewer the whole checklist.
            lifecycle.requireFiled(property);
        }

        if (needsInfo) {
            lifecycle.message(actor, property, true);
            String body = ReviewReasonCodes.ownerMessage(normalizedReason, note);
            review.decide(PropertyReviewStatuses.NEEDS_INFO, actor.userId().toString(), note, normalizedReason);
            review.addMessage(actor.userId(), body, true);
        } else if (approve) {
            lifecycle.publish(actor, property);
            review.decide(PropertyStatus.APPROVED, actor.userId().toString(), note, null);
            review.addMessage(actor.userId(), decisionMessage(true, note));
        } else {
            review.decide(PropertyStatus.REJECTED, actor.userId().toString(), note, normalizedReason);
            review.addMessage(actor.userId(), decisionMessage(false,
                    ReviewReasonCodes.ownerMessage(normalizedReason, note)));
            property.setStatus(PropertyStatus.REJECTED);
        }
        reviews.saveAndFlush(review);
        property.clearRecheck();
        audit.record(actor, "property.verification.decision", "property", propertyId,
                "decision", decision, "note", note, "reasonCode", normalizedReason,
                "checklist", checklistSnapshot(review),
                "owner", String.valueOf(property.getOwner().getId()));
        announce(property, decision, normalizedReason, note);
        return toResponse(review, property, mayReadNotes(actor));
    }

    private void announce(Property property, String decision, String reasonCode, String note) {
        if ("approve".equals(decision)) {
            notifier.notify(property.getOwner().getId(), "listing.approved",
                    "Your listing is approved", "It is now live and visible to buyers.",
                    "/property/" + property.getId());
        } else if ("needs_info".equals(decision)) {
            notifier.notify(property.getOwner().getId(), "listing.needs_info", "Your listing needs info",
                    ReviewReasonCodes.ownerMessage(reasonCode, note), "/dashboard?review=" + property.getId());
        } else {
            notifier.notify(property.getOwner().getId(), "listing.rejected",
                    "Your listing was not approved",
                    "A reviewer could not approve it: "
                            + ReviewReasonCodes.ownerMessage(reasonCode, note), "/dashboard");
        }
    }

    // Addressed by text and refuses the listing owner; see the flow doc.
    @Transactional
    public PropertyReviewResponse setChecklistItem(AuthPrincipal actor, String propertyId, String item,
            boolean pass) {
        if (item == null || item.isBlank()) {
            throw new BadRequestException("item is required");
        }
        Property property = loadForWrite(propertyId);
        lifecycle.requireChecker(actor, property);
        PropertyReview review = requireCase(property);
        ReviewChecklistItem line = review.getChecklist().stream()
                .filter(entry -> entry.getItem().equals(item))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("No such checklist item"));
        line.mark(pass, actor.userId());
        audit.record(actor, "property.verification.checklist", "property", propertyId,
                "item", item, "pass", pass);
        return toResponse(review, property, mayReadNotes(actor));
    }

    private static String decisionMessage(boolean approve, String note) {
        String explanation = note == null ? "" : note.trim();
        if (approve) {
            return "\u2705 Your property has been verified and is now live."
                    + (explanation.isEmpty() ? "" : " " + explanation);
        }
        return "\u26D4 Your property could not be approved.\nReason: "
                + (explanation.isEmpty() ? "It did not meet our verification requirements." : explanation);
    }

    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        if (!mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

    private static boolean isStaff(AuthPrincipal actor) {
        return Roles.isBackOffice(actor.role());
    }

    // Grant, not role, controls staff-only material.
    private boolean mayReadNotes(AuthPrincipal actor) {
        return isStaff(actor) && permissions.granted(actor, BackOfficePermissions.PROPERTIES_READ);
    }

    private PropertyReview requireCase(Property property) {
        return reviews.findByPropertyId(property.getId())
                .orElseThrow(() -> new NotFoundException("No verification review for this listing"));
    }

    private Property load(String propertyId) {
        return Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private Property loadForWrite(String propertyId) {
        return Ids.parseUuid(propertyId).flatMap(properties::findForVerificationDecision)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private Property participantPropertyForWrite(AuthPrincipal actor, String propertyId) {
        Property property = loadForWrite(propertyId);
        if (!mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

    @Transactional
    public PropertyReviewResponse start(AuthPrincipal actor, String propertyId) {
        Property property = loadForWrite(propertyId);
        lifecycle.start(actor, property);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        review.begin(actor.userId().toString());
        audit.record(actor, "property.verification.start", "property", propertyId);
        return toResponse(review, property, mayReadNotes(actor));
    }

    // Owners get no checklist until a document exists; staff keep it because emptiness matters.
    private PropertyReviewResponse toResponse(PropertyReview review, Property property,
            boolean staff) {
        UUID ownerId = property.getOwner().getId();
        boolean showChecklist = staff || documents.existsByPropertyIdAndServiceRequestIdIsNull(property.getId());
        ListingSignals listingSignals = staff
                ? signals.forProperties(List.of(property)).getOrDefault(property.getId(), ListingSignals.NONE)
                : null;
        return new PropertyReviewResponse(
                review.getPropertyId().toString(),
                PropertyReviewStatuses.wire(review),
                review.getReviewer(),
                showChecklist
                        ? VerificationCases.ordered(review).stream()
                                .map(item -> new PropertyReviewResponse.ChecklistEntry(item.getItem(), item.isPass()))
                                .toList()
                        : List.of(),
                review.getMessages().stream()

                        // The one line keeping the duplicate finding away from the person it is
                        // about — a filter on the way out, so there is one place to get wrong.
                        .filter(message -> staff || !message.isInternal())
                        .map(message -> new PropertyReviewResponse.MessageEntry(
                                message.getId().toString(),
                                ownerId.equals(message.getSenderId()) ? "owner" : "ops",
                                message.getBody(),
                                message.getCreatedAt(),
                                message.getReadAt() != null,
                                message.isInternal(), message.isClarificationRequested()))
                        .toList(),
                review.getNotes(),
                review.getReasonCode(),
                showsReason(review) ? review.getNotes() : null,
                staff ? pendingOverride(property.getId()) : null,
                listingSignals,
                review.getDecidedAt(), ListingProgress.of(property, staff));
    }

    private PropertyReviewResponse.OverrideRequest pendingOverride(UUID propertyId) {
        return overrideRequests.findFirstByPropertyIdAndStatusOrderByCreatedAtDesc(
                        propertyId, PropertyOverrideRequest.PENDING)
                .map(request -> new PropertyReviewResponse.OverrideRequest(
                        request.getId().toString(),
                        request.getRequestedBy().toString(),
                        request.getReason(),
                        request.getCreatedAt()))
                .orElse(null);
    }

    private void requireNoSecondApproverBlock(Property property) {
        if (signals.hasHardSignal(property.getId())) {
            throw new ConflictException("second_approver_required",
                    "A hard broker signal requires a second staff approver.");
        }
    }

    private static void requireExpected(String current, String wireStatus, String expected) {
        if (expected != null && !expected.isBlank()
                && !current.equals(expected) && !wireStatus.equals(expected)) {
            throw new ConflictException("stale_decision",
                    "Listing status changed; refresh before deciding");
        }
    }

    private static Map<String, Boolean> checklistSnapshot(PropertyReview review) {
        Map<String, Boolean> snapshot = new LinkedHashMap<>();
        for (ReviewChecklistItem item : review.getChecklist()) {
            snapshot.put(item.getItem(), item.isPass());
        }
        return snapshot;
    }

    private static boolean showsReason(PropertyReview review) {
        String status = PropertyReviewStatuses.wire(review);
        return PropertyReviewStatuses.NEEDS_INFO.equals(status)
                || PropertyReviewStatuses.REJECTED.equals(status);
    }
}
