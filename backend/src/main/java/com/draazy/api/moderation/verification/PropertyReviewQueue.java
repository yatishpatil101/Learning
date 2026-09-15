package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Browsing verification case files, as opposed to working one — a use-case split under
 * package-structure.md §4.1. Neither route re-checks a role; see the flow doc for why.
 */
@Service
public class PropertyReviewQueue {

    private final PropertyReviewRepository reviews;
    private final PropertyRepository properties;

    public PropertyReviewQueue(PropertyReviewRepository reviews, PropertyRepository properties) {
        this.reviews = reviews;
        this.properties = properties;
    }

    /**
     * {@code GET /admin/property-reviews} — paged verification case queue for staff/admin. The unread
     * count is the owner's unanswered messages, not the reader's own inbox: the queue is shared.
     */
    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> listCases(Pageable pageable) {
        Page<PropertyReview> page = reviews.findAllForDesk(pageable);
        Map<UUID, Property> listings = propertiesOf(page.getContent());
        return page.map(review -> toSummary(review, listings.get(review.getPropertyId()), true));
    }

    /**
     * {@code GET /me/property-reviews} — the same queue narrowed to the caller's own listings. Here
     * the unread count is the mirror image: ops messages the owner has not read.
     */
    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> listMyCases(AuthPrincipal actor, Pageable pageable) {
        Page<PropertyReview> page = reviews.findAllForOwner(actor.userId(), pageable);
        Map<UUID, Property> listings = propertiesOf(page.getContent());
        return page.map(review -> toSummary(review, listings.get(review.getPropertyId()), false));
    }

    @Transactional(readOnly = true)
    public long unreadCount(AuthPrincipal actor) {
        return reviews.countUnreadForOwner(actor.userId());
    }

    /**
     * Owner id per case file, resolved in one query for the whole page — doing it inside the
     * {@code map} would be the N+1 this method exists to avoid.
     */
    private Map<UUID, Property> propertiesOf(List<PropertyReview> page) {
        List<UUID> ids = page.stream().map(PropertyReview::getPropertyId).toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return properties.findAllById(ids).stream()
            .collect(Collectors.toMap(Property::getId, property -> property));
    }

    /**
     * @param ownerId the listing's owner, or {@code null} if the listing has since been hard-deleted
     * @param forOps  {@code true} to count the owner's unread messages, {@code false} for ops'
     */
    private static PropertyReviewSummary toSummary(PropertyReview review, Property property, boolean forOps) {
        UUID ownerId = property == null ? null : property.getOwner().getId();
        long unread = ownerId == null ? 0 : review.getMessages().stream()
                .filter(message -> message.getReadAt() == null)
                // An internal note counts for nobody: the owner cannot see it, and the ops badge
                // means "the owner is waiting on a reply".
                .filter(message -> !message.isInternal())
                .filter(message -> ownerId.equals(message.getSenderId()) == forOps)
                .count();
            ReviewMessage last = review.getMessages().stream().filter(message -> !message.isInternal())
                .max(java.util.Comparator.comparing(ReviewMessage::getCreatedAt)
                    .thenComparing(ReviewMessage::getId)).orElse(null);
            String image = property == null ? null : property.getCoverImage();
            if (property != null && (image == null || image.isBlank()) && !property.getImages().isEmpty()) {
                image = property.getImages().getFirst();
            }
        return new PropertyReviewSummary(
                review.getPropertyId().toString(),
                review.getStatus(),
                review.getReviewer(),
                (int) unread,
                review.getDecidedAt(),
                forOps ? review.getUpdatedAt() : last == null ? review.getCreatedAt() : last.getCreatedAt(),
                property == null ? null : property.getTitle(), image,
                last == null ? null : last.getBody(), last == null ? null : last.getCreatedAt(),
                property == null ? null : property.getLifecycleTrack(),
                property == null ? null : property.getLifecycleStage());
    }
}
