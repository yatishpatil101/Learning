package com.draazy.api.engagement.review;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.AlreadyReviewedException;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ReviewNotEligibleException;
import com.draazy.api.common.trust.PropertyExperience;
import com.draazy.api.common.trust.ReviewerStanding;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** Re-derives eligibility server-side, since hiding the button is no control.
 * Moderation is post-hoc: pre-moderation hides an author's review from them and suppresses honest ones. */
@Service
public class ReviewService {

    /** Writer for the {@code categories} column; symmetric with the mapper's reader. */
    private static final ObjectMapper CATEGORIES_JSON = JsonMapper.builder().build();

    /** One decimal place, matching how the UI renders a rating ("4.3") and {@code Society}. */
    private static final int RATING_SCALE = 1;

    private final ReviewRepository reviews;
    private final ReviewMapper mapper;
    private final ReviewTargetKey targetKey;
    private final PropertyRepository properties;
    private final PropertyExperience experience;
    private final UserRepository users;

    public ReviewService(ReviewRepository reviews, ReviewMapper mapper, ReviewTargetKey targetKey,
            PropertyRepository properties, PropertyExperience experience, UserRepository users) {
        this.reviews = reviews;
        this.mapper = mapper;
        this.targetKey = targetKey;
        this.properties = properties;
        this.experience = experience;
        this.users = users;
    }

    // ------------------------------------------------------------------ reads

    /** Unpaged (see {@link ReviewRepository#findPublished(String, String)}); the summary is computed by the database, not from the rows. */
    @Transactional(readOnly = true)
    public ReviewListResponse listForProperty(UUID propertyId) {
        requireReachableProperty(propertyId);
        String targetId = propertyId.toString();
        List<ReviewResponse> rows = withAuthors(reviews.findPublished(ReviewTargetTypes.PROPERTY, targetId));
        return ReviewListResponse.of(new PageImpl<>(rows), summaryOf(ReviewTargetTypes.PROPERTY, targetId));
    }

    /** Reviews of every status for moderators (staff/admin only), paged because no unique index bounds the count, unlike {@link #listForProperty}.
     * {@code status} is one of the {@code ReviewStatuses} values, or null for the whole queue. */
    @Transactional(readOnly = true)
    public Page<ReviewResponse> listForModeration(String status, Pageable pageable) {
        Page<Review> page = reviews.findForModeration(
                status == null || status.isBlank() ? null : status.strip(), pageable);
        Map<UUID, String> names = authorNames(page.getContent());
        /* `toModerationResponse`: the only read of mixed statuses, so rows must carry theirs. */
        return page.map(r -> mapper.toModerationResponse(r, nameOf(names, r)));
    }

    /** {@link ReviewTargetKey#resolve} 404s a target that does not exist, so an unknown locality slug is an error, not a zero-review summary. */
    @Transactional(readOnly = true)
    public ReviewListResponse listForEntity(String entityType, String entityId, Pageable pageable) {
        String key = targetKey.resolve(entityType, entityId);
        Page<Review> page = reviews.findPublished(entityType, key, pageable);
        Map<UUID, String> names = authorNames(page.getContent());
        return ReviewListResponse.of(
                page.map(r -> mapper.toResponse(r, nameOf(names, r))), summaryOf(entityType, key));
    }

    // ----------------------------------------------------------------- writes

    /** Checks run so the caller gets the most specific true reason: listing exists (404), an owner reviewing their own listing is refused, a duplicate is a clean 409 before the write. */
    @Transactional
    public ReviewResponse createForProperty(UUID authorId, UUID propertyId,
            ReviewCreateRequest body) {
        Property property = requireProperty(propertyId);

        if (property.getOwner() != null && authorId.equals(property.getOwner().getId())) {
            throw new ReviewNotEligibleException("You cannot review your own listing");
        }

        ReviewerStanding standing = experience.standingOf(authorId, propertyId);
        if (standing == ReviewerStanding.NONE) {
            throw new ReviewNotEligibleException(
                    "Only someone who has completed a visit to this property, or held a tenancy on "
                            + "it, can review it");
        }

        Review review = persist(authorId, ReviewTargetTypes.PROPERTY, propertyId.toString(), body,
                ReviewContexts.fromStanding(standing));
        return mapper.toResponse(review, displayName(authorId));
    }

    /** No standing check or {@code context} badge: a neighbourhood has no visit or tenancy to evidence. */
    @Transactional
    public ReviewResponse createForEntity(UUID authorId, String entityType, String entityId,
            ReviewCreateRequest body) {
        String key = targetKey.resolve(entityType, entityId);
        Review review = persist(authorId, entityType, key, body, null);
        return mapper.toResponse(review, displayName(authorId));
    }

    // ---------------------------------------------------------------- helpers

    private Review persist(UUID authorId, String targetType, String targetId,
            ReviewCreateRequest body, String context) {
        if (reviews.existsByAuthorIdAndTargetTypeAndTargetId(authorId, targetType, targetId)) {
            throw new AlreadyReviewedException("You have already reviewed this");
        }

        Map<String, Integer> categories;
        try {
            // Other-vocabulary keys are refused, not dropped, which would 201 a review with an empty aspect bar.
            categories = ReviewCategories.validated(targetType, body.categories());
        } catch (IllegalArgumentException rejected) {
            throw new BadRequestException(rejected.getMessage());
        }

        Review review = new Review(targetType, targetId, authorId, body.rating());
        review.setTitle(body.title());
        review.setBody(body.body());
        review.setRecommend(body.recommend());
        review.setContext(context);
        review.setCategories(CATEGORIES_JSON.writeValueAsString(categories));
        // Post-moderation, deliberately. See the class Javadoc.
        review.setStatus(ReviewStatuses.PUBLISHED);
        return reviews.save(review);
    }

    private Property requireProperty(UUID propertyId) {
        return properties.findById(propertyId)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    /** The 404 gate for the anonymous read: applies the public detail route's visibility floor ({@link Property#isDirectlyReachable()}),
     * or a UUID would confirm that a rejected or archived listing is on file. The write path stays unfiltered on purpose. */
    private void requireReachableProperty(UUID propertyId) {
        if (!properties.existsByIdAndArchivedFalseAndStatusIn(
                propertyId, PropertyStatus.DIRECTLY_REACHABLE)) {
            throw NotFoundException.of("Property");
        }
    }

    /** Guarded because the author id is nullable: {@link #authorNames} returns {@code Map.of()} when no row has an author, and an immutable map NPEs on a null key. */
    private String nameOf(Map<UUID, String> names, Review row) {
        return row.getAuthorId() == null ? null : names.get(row.getAuthorId());
    }

    private List<ReviewResponse> withAuthors(List<Review> rows) {
        Map<UUID, String> names = authorNames(rows);
        return rows.stream()
                .map(r -> mapper.toResponse(r, nameOf(names, r)))
                .toList();
    }

    /** One query per page: resolving authors in the row mapping is an N+1 on a public anonymous endpoint. */
    private Map<UUID, String> authorNames(List<Review> rows) {
        Set<UUID> ids = rows.stream()
                .map(Review::getAuthorId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> names = new HashMap<>();
        for (User u : users.findAllById(ids)) {
            names.put(u.getId(), u.getName());
        }
        return names;
    }

    private String displayName(UUID userId) {
        return users.findById(userId).map(User::getName).orElse(null);
    }

    // ------------------------------------------------------- summary helpers

    private ReviewSummaryResponse summaryOf(String targetType, String targetId) {
        ReviewRatingTally tally = reviews.tallyFor(targetType, targetId);
        long total = nonNull(tally.reviewCount());
        return new ReviewSummaryResponse(
                // Null, not 0.0, when nobody has reviewed it — see ReviewSummaryResponse.
                total == 0 ? null : rounded(tally.avgRating()),
                total,
                distributionOf(tally),
                categoryAveragesFor(targetType, targetId));
    }

    /** Always all five buckets, zero-filled once here rather than by every client. */
    private static Map<String, Long> distributionOf(ReviewRatingTally tally) {
        Map<String, Long> stars = new LinkedHashMap<>();
        stars.put("1", nonNull(tally.star1()));
        stars.put("2", nonNull(tally.star2()));
        stars.put("3", nonNull(tally.star3()));
        stars.put("4", nonNull(tally.star4()));
        stars.put("5", nonNull(tally.star5()));
        return stars;
    }

    /** Uses this target kind's vocabulary, the same list {@link #persist} validates against, or the {@code c.key in (:keys)} filter drops aspects. */
    private Map<String, BigDecimal> categoryAveragesFor(String targetType, String targetId) {
        Map<String, BigDecimal> averages = new LinkedHashMap<>();
        for (ReviewCategoryAverage row : reviews.categoryAveragesFor(
                targetType, targetId, ReviewCategories.forTarget(targetType))) {
            if (row.getAverage() != null) {
                averages.put(row.getCategory(),
                        row.getAverage().setScale(RATING_SCALE, RoundingMode.HALF_UP));
            }
        }
        return averages;
    }

    private static BigDecimal rounded(Double average) {
        return average == null ? null
                : BigDecimal.valueOf(average).setScale(RATING_SCALE, RoundingMode.HALF_UP);
    }

    /** {@code count()} cannot be null, but a constructor expression cannot select a primitive. */
    private static long nonNull(Long count) {
        return count == null ? 0L : count;
    }
}
