package com.draazy.api.moderation.review;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.engagement.review.Review;
import com.draazy.api.engagement.review.ReviewRepository;
import com.draazy.api.engagement.review.ReviewResponse;
import com.draazy.api.engagement.review.ReviewService;
import com.draazy.api.engagement.review.ReviewStatuses;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.Set;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code PATCH /reviews/{id}/status} (contract {@code setReviewStatus}, added by spec fix S31).
 *
 * <p><strong>Why this endpoint had to be added to the contract.</strong> {@code POST /reports}
 * accepts {@code targetType: review}, so the platform invited users to report reviews — and then
 * offered no verb capable of acting on one. An abuse queue that can only accumulate is not a
 * moderation system; it is a complaints box.
 *
 * <p><strong>Why no new column was needed.</strong> {@code reviews.status} already carries
 * moderation state, and every read path filters {@code status = 'published'} —
 * <em>including {@code ReviewRepository.aggregateFor}, which computes the rating average</em>. So
 * setting {@code rejected} removes a defamatory review both from the listing page and from the score
 * it moved, in one write. Adding an {@code archived} column (as slice 8 assumed would be needed)
 * would have created a second, weaker notion of "taken down" that the aggregate did not honour —
 * the review would vanish from the page while still dragging the society's rating down.
 *
 * <p>Controller and service are one class here. The behaviour is a single guarded state transition
 * with no orchestration, and splitting it across two files would add indirection without adding a
 * seam anything could use.
 */
@RestController
public class ReviewModerationController {

    /** A moderator may publish or reject. {@code pending} is the intake state, not a decision. */
    private static final Set<String> SETTABLE = Set.of(ReviewStatuses.PUBLISHED, ReviewStatuses.REJECTED);

    private final ReviewRepository reviews;
    private final ReviewService reviewService;
    private final AuditService audit;

    public ReviewModerationController(ReviewRepository reviews, ReviewService reviewService,
            AuditService audit) {
        this.reviews = reviews;
        this.reviewService = reviewService;
        this.audit = audit;
    }

    /**
     * {@code GET /admin/reviews} (contract {@code listReviewsForModeration}) — the queue.
     *
     * <p>The read that {@link #setStatus} needed and did not have. Reviews are post-moderated, so
     * there is no "pending" backlog by default — the useful filters are {@code rejected} (what has
     * been taken down) and no filter at all (everything, newest first, which is how a moderator
     * finds a review nobody has reported yet).
     *
     * <p>Delegates to {@link ReviewService} rather than reading the repository here: author names
     * have to be resolved in one query for the whole page, and that batching already exists there.
     * Reproducing it would be an N+1 waiting to be reintroduced.
     */
    @GetMapping(Routes.Moderation.ADMIN_REVIEWS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_PROPERTIES_READ)
    public PageResponse<ReviewResponse> queue(
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(reviewService.listForModeration(status, pageable), r -> r);
    }

    @PatchMapping(Routes.Moderation.REVIEW_STATUS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE)
    @Transactional
    public void setStatus(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody StatusRequest body) {
        if (!SETTABLE.contains(body.status())) {
            throw new BadRequestException("status must be one of " + SETTABLE);
        }
        Review review = load(id);
        String from = review.getStatus();
        review.setStatus(body.status());
        audit.record(principal, "review.status", "review", id,
                "from", from, "to", body.status(), "reason", body.reason());
    }

    private Review load(String id) {
        return Ids.parseUuid(id)
                .flatMap(reviews::findById)
                .orElseThrow(() -> NotFoundException.of("Review"));
    }

    /** Body of {@code setReviewStatus} (schema {@code ReviewStatusUpdate}). */
    public record StatusRequest(@NotBlank String status, String reason) {
    }
}
