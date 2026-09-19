package com.draazy.api.moderation.verification;

import com.draazy.api.common.trust.ListingCaseNotes;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Opens verification case files, and is the one way anything outside this slice speaks to a listing's owner.
 * Reached through {@link ListingCaseNotes} because {@code catalog} may not import {@code moderation}.
 */
@Service
public class VerificationCases implements ListingCaseNotes {

    /**
     * The checklist a new case starts with. A rental is a lighter check than a sale because the risk
     * is lighter: a bad tenancy costs a deposit, a bad sale costs a house.
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

    public VerificationCases(PropertyReviewRepository reviews) {
        this.reviews = reviews;
    }

    /**
     * This listing's case file, opened with its checklist if absent. Read-then-lock because the property id
     * is UNIQUE; {@code MANDATORY} so the row commits with the write that justified it and holds the lock.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public PropertyReview ensure(UUID propertyId, String deal) {
        Optional<PropertyReview> existing = reviews.findByPropertyId(propertyId);
        if (existing.isPresent()) {
            return existing.get();
        }
        reviews.lockCaseFileFor(propertyId);
        return reviews.findByPropertyId(propertyId).orElseGet(() -> {
            PropertyReview created = new PropertyReview(propertyId);
            checklistFor(deal).forEach(created::addChecklistItem);
            // saveAndFlush, not save: the checklist items are transient until insert, so plain save is
            // correct only until a checklist entry gains a generated id.
            return reviews.saveAndFlush(created);
        });
    }

    /**
     * Close a file whose verdict was reached elsewhere, so it stops reading {@code pending} beside a live
     * listing. Creates nothing, leaves the checklist blank, and skips a file that already agrees.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordExternalDecision(UUID propertyId, String status, String reviewer, String reason) {
        reviews.findByPropertyId(propertyId)
                .filter(review -> review.getDecidedAt() == null || !status.equals(review.getStatus()))
                .ifPresent(review -> review.decide(status, reviewer,
                        "Decided from the moderation queue, without the document checklist."
                                + (reason == null || reason.isBlank() ? "" : " " + reason.trim())));
    }

    /**
     * Post a platform note, opening the case file if absent: the file is the ops work item, so a note with
     * nowhere to land warns nobody. {@code MANDATORY} must stay here, as the call below self-invokes.
     */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void post(UUID propertyId, String deal, String body) {
        write(propertyId, deal, body, false);
    }

    /**
     * The staff-only half: the duplicate probe names another listing, so an owner who could read it would
     * have an oracle for pending rows. The re-post guard matters because the probe re-runs on every edit.
     */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void postInternalOnce(UUID propertyId, String deal, String body) {
        PropertyReview review = ensure(propertyId, deal);
        boolean alreadySaid = review.getMessages().stream()
                .anyMatch(message -> message.isInternal() && message.getBody().equals(body));
        if (!alreadySaid) {
            write(propertyId, deal, body, true);
        }
    }

    private void write(UUID propertyId, String deal, String body, boolean internal) {
        PropertyReview review = ensure(propertyId, deal);
        if (internal) {
            review.addInternalNote(body);
        } else {
            review.addMessage(null, body);
        }
        // saveAndFlush: a new message is a transient child of a managed collection, so deferring the
        // persist to commit leaves its id and timestamp null for readers in the same transaction.
        reviews.saveAndFlush(review);
    }

    private static List<String> checklistFor(String deal) {
        return DEAL_RENT.equals(deal) ? RENT_CHECKLIST : BUY_CHECKLIST;
    }
}
