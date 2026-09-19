package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The owner&lt;-&gt;ops listing verification workflow. Access is participant-or-staff and a stranger
 * gets 404, not 403 — see docs/flows/admin/property-verification.md.
 */
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

    public PropertyVerificationService(PropertyReviewRepository reviews, PropertyRepository properties,
            VerificationCases cases, AccountPermissions permissions, AuditService audit,
            PropertyLifecycle lifecycle, DocumentRepository documents, Notifier notifier) {
        this.reviews = reviews;
        this.properties = properties;
        this.cases = cases;
        this.permissions = permissions;
        this.audit = audit;
        this.lifecycle = lifecycle;
        this.documents = documents;
        this.notifier = notifier;
    }

    /** {@code GET /properties/{id}/verification} — the case file, thread included. */
    @Transactional(readOnly = true)
    public PropertyReviewResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        boolean checker = mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId());
        PropertyReview review = ownerVisibleCase(property, checker);
        return toResponse(review, property, checker);
    }

    /**
     * This listing's case file, or {@code 404} if the caller is its owner and it holds nothing but
     * staff-only notes — closing the duplicate-probe oracle on the read routes. See the flow doc.
     */
    private PropertyReview ownerVisibleCase(Property property, boolean checker) {
        PropertyReview review = requireCase(property);
        if (!checker && review.getReviewer() == null && review.getDecidedAt() == null
                && !review.getMessages().isEmpty()
                && review.getMessages().stream().allMatch(ReviewMessage::isInternal)) {
            throw new NotFoundException("No verification review for this listing");
        }
        return review;
    }

    /**
     * {@code POST /properties/{id}/verification} — submit the listing for review. Idempotent, since
     * {@code property_reviews.property_id} is UNIQUE and a double-click would otherwise violate it.
     */
    @Transactional
    public PropertyReviewResponse initiate(AuthPrincipal actor, String propertyId) {
        Property property = participantPropertyForWrite(actor, propertyId);
        return toResponse(cases.ensure(property.getId(), property.getDeal()),
            property, mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId()));
    }

    /**
     * {@code POST /properties/{id}/verification/messages} — either participant posts. Opens the case
     * rather than demanding one, which is what closes the oracle here — see the flow doc.
     */
    @Transactional
    public PropertyReviewResponse addMessage(AuthPrincipal actor, String propertyId, String body,
            boolean clarificationRequested) {
        if (body == null || body.isBlank()) {
            throw new BadRequestException("body is required");
        }
        Property property = participantPropertyForWrite(actor, propertyId);
        boolean checker = mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId());
        // The rejection tells the owner to reply here to resubmit, so this must reopen the case as well as
        // post to it. The predicate matches `PropertyLifecycle.message` exactly, or the two halves diverge.
        boolean resubmitting = !checker && PropertyStatus.REJECTED.equals(property.getStatus())
                && !property.isArchived() && "owner".equals(property.getLifecycleTrack());
        lifecycle.message(actor, property, clarificationRequested);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        if (resubmitting) {
            review.reopen();
        }
        review.addMessage(actor.userId(), body.trim(), clarificationRequested);
        // Flush before mapping: id and createdAt are assigned at insert time, so a response built
        // from the freshly added instance would carry nulls for the two fields the client needs.
        reviews.saveAndFlush(review);
        return toResponse(review, property, checker);
    }

    /**
     * {@code POST /properties/{id}/verification/read} — mark the <em>other</em> side's messages read,
     * and only ones the caller could have seen. 204 either way; see the flow doc.
     */
    @Transactional
    public void markRead(AuthPrincipal actor, String propertyId) {
        Property property = participantPropertyForWrite(actor, propertyId);
        boolean checker = mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId());
        reviews.findByPropertyId(property.getId()).ifPresent(review -> review.getMessages().stream()
                .filter(message -> checker || !message.isInternal())
                .filter(message -> !actor.userId().equals(message.getSenderId()))
                .forEach(ReviewMessage::markRead));
    }

    /**
     * {@code POST /properties/{id}/verification/decision} — staff/admin only, the checker half. An approval
     * also publishes, in this transaction: a verdict the catalogue does not carry is not a verdict.
     */
    @Transactional
    public PropertyReviewResponse decide(AuthPrincipal actor, String propertyId, String decision,
            String note) {
        return decide(actor, propertyId, decision, note, true);
    }

    private PropertyReviewResponse decide(AuthPrincipal actor, String propertyId, String decision,
            String note, boolean publish) {
        boolean approve = "approve".equals(decision);
        if (!approve && !"reject".equals(decision)) {
            throw new BadRequestException("decision must be approve or reject");
        }
        if (!approve && (note == null || note.isBlank())) {
            throw new BadRequestException("note is required when rejecting");
        }
        Property property = loadForWrite(propertyId);
        lifecycle.requireChecker(actor, property);
        lifecycle.requireActive(property);
        PropertyReview review = requireCase(property);
        if (approve) {
            ApprovalGate.require(review);
            if (publish) {
                // Checked before the verdict is written, not left to `publish` below: the rollback would
                // take the verdict with it and cost the reviewer the whole checklist.
                lifecycle.requireFiled(property);
            }
        }

        String status = approve ? PropertyStatus.APPROVED : PropertyStatus.REJECTED;
        review.decide(status, actor.userId().toString(), note);
        review.addMessage(actor.userId(), decisionMessage(approve, publish, note));
        // The explicit save is load-bearing: the new message is a transient child of a managed
        // collection, so dirty checking alone would leave getId() null for toResponse below.
        reviews.saveAndFlush(review);
        if (approve) {
            lifecycle.verify(actor, property);
            if (publish) {
                lifecycle.publish(actor, property);
            }
        } else {
            property.setStatus(PropertyStatus.REJECTED);
        }
        // A checker has now looked at the listing, which is the whole of what a queued stays-live
        // re-check asked for (Q14) — leaving the row would make "Looks fine" un-reject a rejection.
        property.clearRecheck();
        audit.record(actor, "property.verification.decision", "property", propertyId,
                "decision", decision, "note", note,
                "owner", String.valueOf(property.getOwner().getId()));
        announce(property, approve, publish, note);
        return toResponse(review, property, mayReadNotes(actor));
    }

    /**
     * Tell the owner on both verdicts. {@code published} is a separate question from {@code approve}: a
     * verification that deliberately did not publish must not promise a link that 404s.
     */
    private void announce(Property property, boolean approve, boolean published, String note) {
        if (approve && published) {
            notifier.notify(property.getOwner().getId(), "listing.approved",
                    "Your listing is approved", "It is now live and visible to buyers.",
                    "/property/" + property.getId());
        } else if (approve) {
            notifier.notify(property.getOwner().getId(), "listing.approved",
                    "Your listing is verified", "Verification is recorded. It goes on the site next.",
                    "/dashboard");
        } else {
            notifier.notify(property.getOwner().getId(), "listing.rejected",
                    "Your listing needs changes",
                    "A reviewer could not approve it: " + note.trim(), "/dashboard");
        }
    }

    /**
     * {@code PATCH /properties/{id}/verification/checklist} — staff/admin only, tick or untick one
     * line. Addressed by text, and refuses the listing's own owner; see the flow doc.
     */
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
        line.setPass(pass);
        return toResponse(review, property, mayReadNotes(actor));
    }

    /**
     * The sentence a decision posts into the owner&lt;-&gt;ops thread, in stored English so the thread is the
     * whole record. It must not claim more than happened: a verification that did not publish says so.
     */
    private static String decisionMessage(boolean approve, boolean published, String note) {
        String explanation = note == null ? "" : note.trim();
        if (approve) {
            return (published
                    ? "\u2705 Your property has been verified and is now live."
                    : "\u2705 Your property has been verified.")
                    + (explanation.isEmpty() ? "" : " " + explanation);
        }
        return "\u26D4 Your property could not be approved.\nReason: "
                + (explanation.isEmpty() ? "It did not meet our verification requirements." : explanation)
                + "\nPlease address this and reply here to resubmit.";
    }

    /** Load the listing and assert the caller is the owner or staff, else 404. */
    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        if (!mayReadNotes(actor) && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

    private static boolean isStaff(AuthPrincipal actor) {
        return Roles.Wire.STAFF.equals(actor.role()) || Roles.Wire.ADMIN.equals(actor.role());
    }

    /**
     * Whether staff-only material renders for this caller — the grant, not the role. A bare role test
     * let a revoked {@code properties:read} still read every internal note; see the flow doc.
     */
    private boolean mayReadNotes(AuthPrincipal actor) {
        return isStaff(actor) && permissions.granted(actor, BackOfficePermissions.PROPERTIES_READ);
    }

    /**
     * This listing's case file, or {@code 404} — one definition of the wording for all three routes.
     * Deliberately not where {@link #ownerVisibleCase}'s check lives: same exception, different fact.
     */
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
        return toResponse(review, property, true);
    }

    @Transactional
    public PropertyReviewResponse correct(AuthPrincipal actor, String propertyId, String stage, String reason) {
        Property property = loadForWrite(propertyId);
        if ("verified".equals(stage) && "owner".equals(property.getLifecycleTrack())) {
            lifecycle.requireChecker(actor, property);
            lifecycle.requireActive(property);
            cases.ensure(property.getId(), property.getDeal());
            PropertyReviewResponse response = decide(actor, propertyId, "approve", reason, false);
            audit.record(actor, "property.lifecycle", "property", propertyId, "stage", stage, "reason", reason);
            return response;
        }
        lifecycle.correct(actor, property, stage);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        if (!"live".equals(stage)) {
            review.setStatus(PropertyStatus.PENDING);
        }
        audit.record(actor, "property.lifecycle", "property", propertyId, "stage", stage, "reason", reason);
        return toResponse(review, property, true);
    }

    /**
     * Wire shape of a case file, as the given caller is allowed to see it. The owner gets no
     * checklist until a document exists; staff keep the list, because its emptiness is the finding.
     */
    private PropertyReviewResponse toResponse(PropertyReview review, Property property,
            boolean staff) {
        UUID ownerId = property.getOwner().getId();
        boolean showChecklist = staff || documents.existsByPropertyIdAndServiceRequestIdIsNull(property.getId());
        return new PropertyReviewResponse(
                review.getPropertyId().toString(),
                review.getStatus(),
                review.getReviewer(),
                showChecklist
                        ? review.getChecklist().stream()
                                .map(item -> new PropertyReviewResponse.ChecklistEntry(item.getItem(), item.isPass()))
                                .toList()
                        : List.of(),
                review.getMessages().stream()
                        // The one line keeping the duplicate finding away from the person it is
                        // about (V80) — a filter on the way out, so there is one place to get wrong.
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
                review.getDecidedAt(), property.getLifecycleTrack(), property.getLifecycleStage());
    }
}
