package com.punenest.api.engagement.review;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /reviews/{entityType}/{entityId}} — reviews of a society, locality or owner.
 *
 * <p>A separate controller from {@link PropertyReviewController} because the contract makes these
 * separate resources: {@code entityType} is declared {@code enum: [society, locality, owner]},
 * disjoint from the {@code property} target. They share a table but not a rule — only a property
 * review carries an evidenced badge.
 *
 * <p>Paged, unlike the property list: a popular locality's reviews are bounded only by the number of
 * people living in the city, with no per-author eligibility rule to cap them (api-standards.md §5.1
 * — the test is growth, and this one genuinely grows).
 */
@RestController
public class EntityReviewController {

    private final ReviewService reviewService;

    public EntityReviewController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    /**
     * {@code GET /reviews/{entityType}/{entityId}} (contract {@code listEntityReviews}) — public.
     *
     * <p>The sort is stripped via {@link Pageables#unsorted(Pageable)}: the order here is fixed
     * server-side (newest first, index-backed), and on a {@code security: []} route an unhandled
     * {@code ?sort=} would be a 500 anyone could trigger with a guessed query string.
     */
    @GetMapping(Routes.Reviews.FOR_ENTITY)
    public PageResponse<ReviewResponse> list(@PathVariable String entityType,
            @PathVariable String entityId,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                reviewService.listForEntity(entityType, entityId, Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /** {@code POST /reviews/{entityType}/{entityId}} (contract {@code createEntityReview}) — 201. */
    @PostMapping(Routes.Reviews.FOR_ENTITY)
    @ResponseStatus(HttpStatus.CREATED)
    public ReviewResponse create(@CurrentUser AuthPrincipal principal,
            @PathVariable String entityType,
            @PathVariable String entityId,
            @Valid @RequestBody ReviewCreateRequest body) {
        return reviewService.createForEntity(principal.userId(), entityType, entityId, body);
    }
}
