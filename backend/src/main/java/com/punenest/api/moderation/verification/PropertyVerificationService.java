package com.punenest.api.moderation.verification;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The owner&lt;-&gt;ops listing verification workflow.
 *
 * <p><strong>Access here is participant-or-staff, not role-based</strong>, and the contract says so:
 * the four thread operations deliberately carry no {@code x-roles} (recorded explicitly in spec fix
 * S28) because the listing owner is one of the two participants. Role-gating the thread would have
 * locked owners out of the conversation about their own listing — the single most user-visible way
 * this slice could have gone wrong. Only {@code verificationDecision}, the checker half of the
 * maker-checker pair, is staff/admin.
 *
 * <p>A caller who is neither participant nor staff gets a <strong>404, not a 403</strong>. A 403
 * would confirm that a listing with that id exists and is under review, which is exactly the fact a
 * competitor would probe for.
 */
@Service
public class PropertyVerificationService {

    /**
     * The checklist a new case starts with, mirroring
     * {@code lib/data/properties-admin.js#defaultDocs}. A rental is a lighter check than a sale
     * because the risk is lighter: a bad tenancy costs a deposit, a bad sale costs a house.
     */
    private static final List<String> RENT_CHECKLIST = List.of(
            "Index II", "Electricity bill", "Aadhaar card");

    private static final List<String> BUY_CHECKLIST = List.of(
            "Ownership proof (Sale deed / Index II)",
            "Property tax receipt",
            "Owner government ID (Aadhaar / PAN)",
            "Society NOC / Maintenance receipt",
            "Encumbrance certificate",
            "Listing photos match the property");

    private static final String DEAL_RENT = "rent";

    private final PropertyReviewRepository reviews;
    private final PropertyRepository properties;
    private final AuditService audit;

    public PropertyVerificationService(PropertyReviewRepository reviews, PropertyRepository properties,
            AuditService audit) {
        this.reviews = reviews;
        this.properties = properties;
        this.audit = audit;
    }

    /** {@code GET /properties/{id}/verification} — the case file, thread included (S34). */
    @Transactional(readOnly = true)
    public PropertyReviewResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        PropertyReview review = reviews.findByPropertyId(property.getId())
                .orElseThrow(() -> new NotFoundException("No verification review for this listing"));
        return toResponse(review, property.getOwner().getId());
    }

    /** {@code GET /admin/property-reviews} — paged verification case queue for staff/admin. */
    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> listCases(Pageable pageable) {
        return reviews.findAllByOrderByUpdatedAtDesc(pageable)
                .map(review -> new PropertyReviewSummary(
                        review.getPropertyId().toString(),
                        review.getStatus(),
                        review.getReviewer(),
                        review.getDecidedAt(),
                        review.getUpdatedAt()));
    }

    /**
     * {@code POST /properties/{id}/verification} — submit the listing for review.
     *
     * <p>Idempotent: re-submitting an existing case returns it rather than creating a second one.
     * {@code property_reviews.property_id} is UNIQUE, so the alternative was a constraint violation
     * on a double-click.
     */
    @Transactional
    public PropertyReviewResponse initiate(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        PropertyReview review = reviews.findByPropertyId(property.getId()).orElseGet(() -> {
            PropertyReview created = new PropertyReview(property.getId());
            checklistFor(property.getDeal()).forEach(created::addChecklistItem);
            // saveAndFlush, not save, for the same reason as addMessage below: the checklist items
            // are transient until insert. Nothing in the response reads their generated fields
            // today, which makes plain save correct only by coincidence — and the coincidence
            // would break the moment a checklist entry gained an id.
            return reviews.saveAndFlush(created);
        });
        return toResponse(review, property.getOwner().getId());
    }

    /** {@code POST /properties/{id}/verification/messages} — either participant posts. */
    @Transactional
    public PropertyReviewResponse addMessage(AuthPrincipal actor, String propertyId, String body) {
        if (body == null || body.isBlank()) {
            throw new BadRequestException("body is required");
        }
        Property property = participantProperty(actor, propertyId);
        PropertyReview review = reviews.findByPropertyId(property.getId())
                .orElseThrow(() -> new NotFoundException("No verification review for this listing"));
        review.addMessage(actor.userId(), body.trim());
        // Flush before mapping. Both id and createdAt are assigned by Hibernate at insert time
        // (@UuidGenerator, @CreationTimestamp), so a response built from the freshly added instance
        // would carry nulls for the two fields the client needs to render and de-duplicate it.
        reviews.saveAndFlush(review);
        return toResponse(review, property.getOwner().getId());
    }

    /**
     * {@code POST /properties/{id}/verification/read} — mark the <em>other</em> side's messages read.
     *
     * <p>Only the other side's: marking your own messages read is meaningless, and doing it would
     * silently clear the unread badge the other participant is waiting on.
     */
    @Transactional
    public void markRead(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        PropertyReview review = reviews.findByPropertyId(property.getId())
                .orElseThrow(() -> new NotFoundException("No verification review for this listing"));
        review.getMessages().stream()
                .filter(message -> !actor.userId().equals(message.getSenderId()))
                .forEach(ReviewMessage::markRead);
    }

    /**
     * {@code POST /properties/{id}/verification/decision} — staff/admin only, the checker half.
     *
     * <p>Writes to <em>both</em> the case file and {@code properties.status}. They are separate
     * columns answering separate questions (see {@link PropertyReview}), so a decision that updated
     * only one would either leave a rejected listing publicly visible or approve a listing with no
     * record of who approved it.
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
            throw new com.punenest.api.common.error.ForbiddenException(
                    "You cannot decide the verification of your own listing");
        }
        PropertyReview review = reviews.findByPropertyId(property.getId())
                .orElseThrow(() -> new NotFoundException("No verification review for this listing"));

        String status = approve ? PropertyStatus.APPROVED : PropertyStatus.REJECTED;
        review.decide(status, actor.userId().toString(), note);
        property.setStatus(status);
        if (approve) {
            property.setFlagReason(null);
        }
        audit.record(actor, "property.verification.decision", "property", propertyId,
                "decision", decision, "note", note,
                "owner", String.valueOf(property.getOwner().getId()));
        return toResponse(review, property.getOwner().getId());
    }

    private static List<String> checklistFor(String deal) {
        return DEAL_RENT.equals(deal) ? RENT_CHECKLIST : BUY_CHECKLIST;
    }

    /** Load the listing and assert the caller is the owner or staff, else 404. */
    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        boolean staff = Roles.Wire.STAFF.equals(actor.role()) || Roles.Wire.ADMIN.equals(actor.role());
        if (!staff && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

    private Property load(String propertyId) {
        return Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private static PropertyReviewResponse toResponse(PropertyReview review, UUID ownerId) {
        return new PropertyReviewResponse(
                review.getPropertyId().toString(),
                review.getStatus(),
                review.getReviewer(),
                review.getChecklist().stream()
                        .map(item -> new PropertyReviewResponse.ChecklistEntry(item.getItem(), item.isPass()))
                        .toList(),
                review.getMessages().stream()
                        .map(message -> new PropertyReviewResponse.MessageEntry(
                                message.getId().toString(),
                                ownerId.equals(message.getSenderId()) ? "owner" : "ops",
                                message.getBody(),
                                message.getCreatedAt(),
                                message.getReadAt() != null))
                        .toList(),
                review.getNotes(),
                review.getDecidedAt());
    }

    /** Paged queue shape for {@code /admin/property-reviews}. */
    public record PropertyReviewSummary(
            String propertyId,
            String status,
            String reviewer,
            Instant decidedAt,
            Instant updatedAt) {
    }
}
