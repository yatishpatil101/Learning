package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
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

    public PropertyVerificationService(PropertyReviewRepository reviews, PropertyRepository properties,
            VerificationCases cases, AccountPermissions permissions, AuditService audit) {
        this.reviews = reviews;
        this.properties = properties;
        this.cases = cases;
        this.permissions = permissions;
        this.audit = audit;
    }

    /** {@code GET /properties/{id}/verification} — the case file, thread included. */
    @Transactional(readOnly = true)
    public PropertyReviewResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        boolean checker = mayReadNotes(actor);
        PropertyReview review = ownerVisibleCase(property, checker);
        return toResponse(review, property.getOwner().getId(), checker);
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
        Property property = participantProperty(actor, propertyId);
        return toResponse(cases.ensure(property.getId(), property.getDeal()),
                property.getOwner().getId(), mayReadNotes(actor));
    }

    /**
     * {@code POST /properties/{id}/verification/messages} — either participant posts. Opens the case
     * rather than demanding one, which is what closes the oracle here — see the flow doc.
     */
    @Transactional
    public PropertyReviewResponse addMessage(AuthPrincipal actor, String propertyId, String body) {
        if (body == null || body.isBlank()) {
            throw new BadRequestException("body is required");
        }
        Property property = participantProperty(actor, propertyId);
        boolean checker = mayReadNotes(actor);
        PropertyReview review = cases.ensure(property.getId(), property.getDeal());
        review.addMessage(actor.userId(), body.trim());
        // Flush before mapping: id and createdAt are assigned at insert time, so a response built
        // from the freshly added instance would carry nulls for the two fields the client needs.
        reviews.saveAndFlush(review);
        return toResponse(review, property.getOwner().getId(), checker);
    }

    /**
     * {@code POST /properties/{id}/verification/read} — mark the <em>other</em> side's messages read,
     * and only ones the caller could have seen. 204 either way; see the flow doc.
     */
    @Transactional
    public void markRead(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        boolean checker = mayReadNotes(actor);
        reviews.findByPropertyId(property.getId()).ifPresent(review -> review.getMessages().stream()
                .filter(message -> checker || !message.isInternal())
                .filter(message -> !actor.userId().equals(message.getSenderId()))
                .forEach(ReviewMessage::markRead));
    }

    /**
     * {@code POST /properties/{id}/verification/decision} — staff/admin only, the checker half. Writes
     * to three places, each answering what the other two cannot; see the flow doc.
     */
    @Transactional
    public PropertyReviewResponse decide(AuthPrincipal actor, String propertyId, String decision,
            String note) {
        boolean approve = "approve".equals(decision);
        if (!approve && !"reject".equals(decision)) {
            throw new BadRequestException("decision must be approve or reject");
        }
        Property property = load(propertyId);
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException(
                    "You cannot decide the verification of your own listing");
        }
        PropertyReview review = requireCase(property);

        String status = approve ? PropertyStatus.APPROVED : PropertyStatus.REJECTED;
        review.decide(status, actor.userId().toString(), note);
        review.addMessage(actor.userId(), decisionMessage(approve, note));
        // The explicit save is load-bearing: the new message is a transient child of a managed
        // collection, so dirty checking alone would leave getId() null for toResponse below.
        reviews.saveAndFlush(review);
        property.setStatus(status);
        if (approve) {
            property.setFlagReason(null);
        }
        // A checker has now looked at the listing, which is the whole of what a queued stays-live
        // re-check asked for (Q14) — leaving the row would make "Looks fine" un-reject a rejection.
        property.clearRecheck();
        audit.record(actor, "property.verification.decision", "property", propertyId,
                "decision", decision, "note", note,
                "owner", String.valueOf(property.getOwner().getId()));
        return toResponse(review, property.getOwner().getId(), mayReadNotes(actor));
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
        Property property = load(propertyId);
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException(
                    "You cannot check off the verification of your own listing");
        }
        PropertyReview review = requireCase(property);
        ReviewChecklistItem line = review.getChecklist().stream()
                .filter(entry -> entry.getItem().equals(item))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("No such checklist item"));
        line.setPass(pass);
        return toResponse(review, property.getOwner().getId(), mayReadNotes(actor));
    }

    /**
     * The sentence a decision posts into the owner&lt;-&gt;ops thread. Composed and persisted here, in
     * stored English, so the thread is the complete record of the decision — see the flow doc.
     */
    private static String decisionMessage(boolean approve, String note) {
        boolean explained = note != null && !note.isBlank();
        if (approve) {
            return "\u2705 Your property has been verified and approved."
                    + (explained ? " " + note.trim() : " It is now live on Draazy.");
        }
        return "\u26D4 Your property could not be approved.\nReason: "
                + (explained ? note.trim() : "It did not meet our verification requirements.")
                + "\nPlease address this and reply here to resubmit.";
    }

    /** Load the listing and assert the caller is the owner or staff, else 404. */
    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        if (!isStaff(actor) && !actor.userId().equals(property.getOwner().getId())) {
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

    private static PropertyReviewResponse toResponse(PropertyReview review, UUID ownerId,
            boolean staff) {
        return new PropertyReviewResponse(
                review.getPropertyId().toString(),
                review.getStatus(),
                review.getReviewer(),
                review.getChecklist().stream()
                        .map(item -> new PropertyReviewResponse.ChecklistEntry(item.getItem(), item.isPass()))
                        .toList(),
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
                                message.isInternal()))
                        .toList(),
                review.getNotes(),
                review.getDecidedAt());
    }
}
