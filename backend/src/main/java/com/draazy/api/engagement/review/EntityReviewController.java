package com.draazy.api.engagement.review;

import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
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

/** Separate from {@link PropertyReviewController} because the contract splits these resources;
 * paged since locality reviews are unbounded (api-standards.md §5.1). */
@RestController
public class EntityReviewController {

    private final ReviewService reviewService;

    public EntityReviewController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    /** Sort stripped via {@link Pageables#unsorted(Pageable)}: {@code ?sort=} on a public route would 500. */
    @GetMapping(Routes.Reviews.FOR_ENTITY)
    public ReviewListResponse list(@PathVariable String entityType,
            @PathVariable String entityId,
            @PageableDefault(size = 20) Pageable pageable) {
        return reviewService.listForEntity(entityType, entityId, Pageables.unsorted(pageable));
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
