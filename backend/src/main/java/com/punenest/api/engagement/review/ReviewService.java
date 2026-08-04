package com.punenest.api.engagement.review;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.AlreadyReviewedException;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.ReviewNotEligibleException;
import com.punenest.api.common.trust.PropertyExperience;
import com.punenest.api.common.trust.ReviewerStanding;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Reviews — reading them, and deciding who has earned the right to write one.
 *
 * <p><strong>The rule this class exists to enforce.</strong> Until now the anti-fake-review check
 * lived in the browser: {@code ReviewsSection.jsx} computes
 * {@code eligible = isIn && !isOwner && (hasCompletedVisit(...) || hasTenancy)} and hides the button
 * when it is false. Hiding a button is not a control. Anyone willing to call the API directly could
 * stack a listing with praise or bury a competitor's, and a marketplace whose ratings can be
 * manufactured has no ratings. The same three conditions are re-derived here, from data the caller
 * cannot influence, and are the only path to a stored row.
 *
 * <p>Property reviews and entity (society / locality / owner) reviews are deliberately asymmetric.
 * A property is something you can visit or live in, so a property review must be evidenced. A
 * locality is not — nobody "completes a visit" to a neighbourhood — so those are gated on
 * authentication and one-per-author alone. Demanding evidence there would mean nobody could ever
 * review a locality, which is not stricter, just broken.
 *
 * <p><strong>Moderation is post-hoc, and that is a decision, not an oversight.</strong> Every review
 * this class writes goes straight to {@link ReviewStatuses#PUBLISHED}; the {@code pending} and
 * {@code rejected} states exist in the vocabulary and the schema, but nothing here writes them.
 * Pre-moderation would mean an author posts a review and cannot see it, which reads as a bug and
 * suppresses honest reviews far more effectively than dishonest ones. The defence against abuse
 * here is the eligibility bar rather than a queue: to plant a review you must first hold a tenancy
 * or complete a visit on that specific property, which is expensive per fake review in a way that
 * creating an account is not. The moderation queue, the take-down path and the
 * {@code archived} column that reviews still lack are owned by the Moderation slice; until it
 * lands, a bad review can only be removed in the database.
 */
@Service
public class ReviewService {

    /** Writer for the {@code categories} column; symmetric with the mapper's reader. */
    private static final ObjectMapper CATEGORIES_JSON = JsonMapper.builder().build();

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

    /**
     * Every published review of one listing, newest first.
     *
     * <p>Unpaged by ruling D8.6 — see {@link ReviewRepository#findPublished(String, String)} for why
     * that is safe here and nowhere else.
     */
    @Transactional(readOnly = true)
    public List<ReviewResponse> listForProperty(UUID propertyId) {
        requireProperty(propertyId);
        return withAuthors(reviews.findPublished(ReviewTargetTypes.PROPERTY, propertyId.toString()));
    }

    /**
     * The moderation queue — reviews of every status, newest first, paged (staff/admin only).
     *
     * <p><strong>Why this exists.</strong> {@code PATCH /reviews/{id}/status} shipped able to take a
     * review down, with nothing able to list one: reviews are post-moderated, so they are published
     * on write, and every other read filters to {@code published}. A moderator could act only on a
     * review they already had the id of — which meant only ones that had been reported. Anything
     * nobody reported was unreachable, and so was the effect of any decision already made.
     *
     * <p>Paged, unlike {@link #listForProperty}. The D8.6 exception that lets a property's reviews
     * go unpaged rests on the per-target UNIQUE index bounding the count; across all targets and all
     * statuses there is no such bound, so this is the ordinary case rather than the exception.
     *
     * @param status one of the {@code ReviewStatuses} values, or null for the whole queue
     */
    @Transactional(readOnly = true)
    public Page<ReviewResponse> listForModeration(String status, Pageable pageable) {
        Page<Review> page = reviews.findForModeration(
                status == null || status.isBlank() ? null : status.strip(), pageable);
        Map<UUID, String> names = authorNames(page.getContent());
        return page.map(r -> mapper.toResponse(r, names.get(r.getAuthorId())));
    }

    /** Published reviews of a society, locality or owner — paged, newest first (spec fix S27). */
    @Transactional(readOnly = true)
    public Page<ReviewResponse> listForEntity(String entityType, String entityId,
            Pageable pageable) {
        String key = targetKey.resolve(entityType, entityId);
        Page<Review> page = reviews.findPublished(entityType, key, pageable);
        Map<UUID, String> names = authorNames(page.getContent());
        return page.map(r -> mapper.toResponse(r, names.get(r.getAuthorId())));
    }

    // ----------------------------------------------------------------- writes

    /**
     * Write a review of a listing, if the caller has actually experienced it.
     *
     * <p>Order of checks matters and is chosen so the caller always gets the most specific true
     * reason: the listing must exist (404) before we can say who owns it; an owner reviewing their
     * own listing is refused before we bother looking for visits; and the duplicate check precedes
     * the write so the common repeat-submit is a clean 409 rather than a constraint violation.
     */
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

    /**
     * Write a review of a society, locality or owner.
     *
     * <p>No standing check and therefore no {@code context} badge: there is no visit or tenancy to
     * evidence against a neighbourhood. Authentication plus one-per-author is the whole guard, and
     * that asymmetry with property reviews is intentional rather than an oversight.
     */
    @Transactional
    public ReviewResponse createForEntity(UUID authorId, String entityType, String entityId,
            ReviewCreateRequest body) {
        String key = targetKey.resolve(entityType, entityId);
        Review review = persist(authorId, entityType, key, body, null);
        return mapper.toResponse(review, displayName(authorId));
    }

    // ---------------------------------------------------------------- helpers

    /**
     * The shared write path: duplicate check, category validation, insert.
     *
     * @param context the derived badge, or null for non-property targets
     */
    private Review persist(UUID authorId, String targetType, String targetId,
            ReviewCreateRequest body, String context) {
        if (reviews.existsByAuthorIdAndTargetTypeAndTargetId(authorId, targetType, targetId)) {
            throw new AlreadyReviewedException("You have already reviewed this");
        }

        Map<String, Integer> categories;
        try {
            categories = ReviewCategories.validated(body.categories());
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

    private List<ReviewResponse> withAuthors(List<Review> rows) {
        Map<UUID, String> names = authorNames(rows);
        return rows.stream().map(r -> mapper.toResponse(r, names.get(r.getAuthorId()))).toList();
    }

    /**
     * Display names for a whole page of reviews in one query.
     *
     * <p>The obvious alternative — resolving the author inside the row mapping — is an N+1 on a
     * public, anonymous endpoint, which is the cheapest denial-of-service a listing page can offer.
     */
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
}
