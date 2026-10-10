package com.draazy.api.moderation.review;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.engagement.review.Review;
import com.draazy.api.engagement.review.ReviewModerationRow;
import com.draazy.api.engagement.review.ReviewRepository;
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

/** Setting {@code rejected} on {@code reviews.status} removes a review from the page and from the rating aggregate
 * in one write; a separate archived column would leave it dragging the score down. */
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

    /** Delegates to {@link ReviewService} so author names are resolved in one batched query per page,
     * not one per row. */
    @GetMapping(Routes.Moderation.ADMIN_REVIEWS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.MANAGER + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_REVIEWS_READ)
    public PageResponse<ReviewModerationRow> queue(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "false") boolean counts,
            @PageableDefault(size = 20) Pageable pageable) {
        PageResponse<ReviewModerationRow> page = PageResponse.of(
                reviewService.listForModeration(status, q, Pageables.unsorted(pageable)), r -> r);
        return counts ? page.withCounts(reviewService.moderationCounts()) : page;
    }

    @PatchMapping(Routes.Moderation.REVIEW_STATUS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_REVIEWS_WRITE)
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
