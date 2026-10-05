package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.trust.ListingCaseNotes;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

// Catalog reaches this through ListingCaseNotes because it may not import moderation.
@Service
public class VerificationCases implements ListingCaseNotes {

    // Rental has a lighter checklist because tenancy risk is lighter than sale risk.
    static final List<String> CHECKLIST = List.of(
            "Photos are real and match the listing",
            "Not a duplicate of another listing",
            "Details and location look right");

    private final PropertyReviewRepository reviews;
    private final AuditService audit;

    public VerificationCases(PropertyReviewRepository reviews, AuditService audit) {
        this.reviews = reviews;
        this.audit = audit;
    }

    // MANDATORY keeps case creation in the write that justified it and holds the lock.
    @Transactional(propagation = Propagation.MANDATORY)
    public PropertyReview ensure(UUID propertyId, String deal) {
        Optional<PropertyReview> existing = reviews.findByPropertyId(propertyId);
        if (existing.isPresent()) {
            PropertyReview review = existing.get();
            reconcilePendingChecklist(review);
            return review;
        }
        reviews.lockCaseFileFor(propertyId);
        return reviews.findByPropertyId(propertyId).orElseGet(() -> {
            PropertyReview created = new PropertyReview(propertyId);
            CHECKLIST.forEach(created::addChecklistItem);

            // saveAndFlush, not save: the checklist items are transient until insert, so plain save is
            // correct only until a checklist entry gains a generated id.
            return reviews.saveAndFlush(created);
        });
    }

    @EventListener
    @Transactional(propagation = Propagation.MANDATORY)
    public void resetOnReentry(PropertyLifecycle.ReviewReentered event) {
        reviews.findByPropertyId(event.propertyId()).ifPresent(review -> {
            review.reopen();
            reconcilePendingChecklist(review);
            audit.record(event.actorId(), event.actorRole(), "property.verification.checklist.reset",
                    "property", event.propertyId().toString(), null, "{}");
        });
    }

    // Opens the case if absent because a note with nowhere to land warns nobody.
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void post(UUID propertyId, String deal, String body) {
        write(propertyId, deal, body, false);
    }

    // Staff-only because duplicate notes would otherwise reveal pending rows to owners.
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

    static List<ReviewChecklistItem> ordered(PropertyReview review) {
        return review.getChecklist().stream()
                .sorted(Comparator.comparingInt(item -> CHECKLIST.indexOf(item.getItem())))
                .toList();
    }

    private static void reconcilePendingChecklist(PropertyReview review) {
        List<String> items = review.getChecklist().stream().map(ReviewChecklistItem::getItem).toList();

        if ((review.getDecidedAt() != null && !PropertyReviewStatuses.NEEDS_INFO.equals(review.getStatus()))
                || (items.size() == CHECKLIST.size() && Set.copyOf(items).equals(Set.copyOf(CHECKLIST)))) {
            return;
        }
        review.getChecklist().clear();
        CHECKLIST.forEach(review::addChecklistItem);
    }
}
