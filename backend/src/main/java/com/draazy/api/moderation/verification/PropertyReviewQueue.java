package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Browsing case files, not working one; role checks happen at the controller boundary.
@Service
public class PropertyReviewQueue {

    private final PropertyReviewRepository reviews;
    private final PropertyRepository properties;

    public PropertyReviewQueue(PropertyReviewRepository reviews, PropertyRepository properties) {
        this.reviews = reviews;
        this.properties = properties;
    }

    // Owner messages the desk has not read; the queue is shared, not per-reader.
    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> awaitingReplies(Pageable pageable) {
        Page<PropertyReview> page = reviews.findAllAwaitingStaff(pageable);
        Map<UUID, Property> listings = propertiesOf(page.getContent());
        return page.map(review -> toSummary(review, listings.get(review.getPropertyId())));
    }

    /** Which of these listings have an owner message the desk has not read. */
    @Transactional(readOnly = true)
    public Set<UUID> awaitingStaff(java.util.Collection<UUID> propertyIds) {
        return propertyIds.isEmpty() ? Set.of()
                : new HashSet<>(reviews.propertyIdsAwaitingStaff(propertyIds));
    }

    @Transactional(readOnly = true)
    public Page<ReviewBadge> listMyCases(AuthPrincipal actor, Pageable pageable) {
        Page<PropertyReview> page = reviews.findAllForOwner(actor.userId(), pageable);
        return page.map(review -> toBadge(review, actor.userId()));
    }

    private static ReviewBadge toBadge(PropertyReview review, UUID ownerId) {
        long unread = review.getMessages().stream()
                .filter(message -> message.getReadAt() == null)
                .filter(message -> !message.isInternal())
                .filter(message -> !ownerId.equals(message.getSenderId()))
                .count();
        ReviewMessage last = lastVisible(review);
        return new ReviewBadge(
                review.getPropertyId().toString(),
                PropertyReviewStatuses.wire(review),
                (int) unread,
                last == null ? review.getCreatedAt() : last.getCreatedAt(),
                review.getReasonCode(),
                showsReason(review) ? review.getNotes() : null,
                last == null ? null : last.getBody());
    }

    private static ReviewMessage lastVisible(PropertyReview review) {
        return review.getMessages().stream().filter(message -> !message.isInternal())
                .max(java.util.Comparator.comparing(ReviewMessage::getCreatedAt)
                        .thenComparing(ReviewMessage::getId)).orElse(null);
    }

    // One query for the page avoids resolving owners inside the map.
    private Map<UUID, Property> propertiesOf(List<PropertyReview> page) {
        List<UUID> ids = page.stream().map(PropertyReview::getPropertyId).toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return properties.findAllById(ids).stream()
            .collect(Collectors.toMap(Property::getId, property -> property));
    }

    private static PropertyReviewSummary toSummary(PropertyReview review, Property property) {
        ReviewMessage last = lastVisible(review);
        return new PropertyReviewSummary(review.getPropertyId().toString(),
                property == null ? null : property.getTitle(), last == null ? null : last.getBody());
    }

    private static boolean showsReason(PropertyReview review) {
        String status = PropertyReviewStatuses.wire(review);
        return PropertyReviewStatuses.NEEDS_INFO.equals(status)
                || PropertyReviewStatuses.REJECTED.equals(status);
    }
}
