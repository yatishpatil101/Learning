package com.draazy.api.engagement.review;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Read is public ({@code security: []}), write is authenticated; {@code SecurityConfig} permits by method. */
@RestController
public class PropertyReviewController {

    private final ReviewService reviewService;

    public PropertyReviewController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    /** Unpaged because the list is structurally bounded; carries the rating summary over every published review. */
    @GetMapping(Routes.Reviews.FOR_PROPERTY)
    public ReviewListResponse list(@PathVariable UUID propId) {
        return reviewService.listForProperty(propId);
    }

    /** {@code POST /properties/{propId}/reviews} (contract {@code createReview}) — 201. */
    @PostMapping(Routes.Reviews.FOR_PROPERTY)
    @ResponseStatus(HttpStatus.CREATED)
    public ReviewResponse create(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID propId,
            @Valid @RequestBody ReviewCreateRequest body) {
        return reviewService.createForProperty(principal.userId(), propId, body);
    }
}
