package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.ListingProgress;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.HashMap;
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
    private final UserRepository users;

    public PropertyReviewQueue(PropertyReviewRepository reviews, PropertyRepository properties,
            UserRepository users) {
        this.reviews = reviews;
        this.properties = properties;
        this.users = users;
    }

    // unread means owner's unanswered messages, not the reader's inbox; the queue is shared.
    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> listCases(String status, boolean unread, Pageable pageable) {
        Page<PropertyReview> page = unread
                ? reviews.findAllAwaitingStaff(pageable)
                : status == null
                ? reviews.findAllForDesk(pageable)
                : reviews.findAllForDeskByStatus(PropertyReviewStatuses.storedFilter(status), pageable);
        Map<UUID, Property> listings = propertiesOf(page.getContent());
        Map<String, String> names = reviewerNames(page.getContent());
        return page.map(review -> toSummary(review, listings.get(review.getPropertyId()), true,
                names.get(review.getReviewer())));
    }

    @Transactional(readOnly = true)
    public Page<PropertyReviewSummary> listMyCases(AuthPrincipal actor, Pageable pageable) {
        Page<PropertyReview> page = reviews.findAllForOwner(actor.userId(), pageable);
        Map<UUID, Property> listings = propertiesOf(page.getContent());
        return page.map(review -> toSummary(review, listings.get(review.getPropertyId()), false, null));
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

    private Map<String, String> reviewerNames(List<PropertyReview> page) {
        Set<UUID> ids = new HashSet<>();
        for (PropertyReview review : page) {
            try {
                if (review.getReviewer() != null) {
                    ids.add(UUID.fromString(review.getReviewer()));
                }
            } catch (IllegalArgumentException notAUserId) {

            }
        }
        Map<String, String> names = new HashMap<>();
        if (!ids.isEmpty()) {
            for (User u : users.findAllById(ids)) {
                names.put(u.getId().toString(), u.getName());
            }
        }
        return names;
    }

    private static PropertyReviewSummary toSummary(PropertyReview review, Property property, boolean forOps,
            String reviewerName) {
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
                PropertyReviewStatuses.wire(review),
                review.getReviewer(),
                reviewerName,
                (int) unread,
                review.getDecidedAt(),
                forOps ? review.getUpdatedAt() : last == null ? review.getCreatedAt() : last.getCreatedAt(),
                property == null ? null : property.getTitle(), image,
                last == null ? null : last.getBody(), last == null ? null : last.getCreatedAt(),
                review.getReasonCode(),
                showsReason(review) ? review.getNotes() : null,
                property == null ? null : ListingProgress.of(property, forOps));
    }

    private static boolean showsReason(PropertyReview review) {
        String status = PropertyReviewStatuses.wire(review);
        return PropertyReviewStatuses.NEEDS_INFO.equals(status)
                || PropertyReviewStatuses.REJECTED.equals(status);
    }
}
