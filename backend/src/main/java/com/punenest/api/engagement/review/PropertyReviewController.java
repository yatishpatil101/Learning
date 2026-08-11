package com.punenest.api.engagement.review;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /properties/{propId}/reviews} — ratings and reviews of one listing.
 *
 * <p>The read is public ({@code security: []}): reviews are precisely what an anonymous visitor is
 * weighing before they will consider signing up, so putting them behind a login would defeat their
 * purpose. The write is authenticated <em>and</em> evidenced — see {@link ReviewService} for the
 * eligibility rule, which is the reason this endpoint exists at all rather than the frontend
 * continuing to keep reviews in {@code localStorage}.
 *
 * <p>Note that GET and POST share a path but not a security posture, which is why
 * {@code SecurityConfig} permits this route by method rather than by path.
 */
@RestController
public class PropertyReviewController {

    private final ReviewService reviewService;

    public PropertyReviewController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    /**
     * {@code GET /properties/{propId}/reviews} (contract {@code listReviews}) — public, newest
     * first, and a bare array by ruling D8.6: the list is structurally bounded, and the property
     * page computes its own rating summary, distribution and per-category averages from it.
     */
    @GetMapping(Routes.Reviews.FOR_PROPERTY)
    public List<ReviewResponse> list(@PathVariable UUID propId) {
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

    /**
     * {@code GET /properties/{propId}/reviews/summary} (contract {@code getReviewSummary}) —
     * public, and the same three numbers the property page has always drawn, now computed by the
     * database (D79).
     *
     * <p>Purely additive. {@link #list} is untouched: still a bare array, still unpaged, still
     * everything. What this removes is the <em>dependency</em> between those two facts — the star
     * average, the 1–5 distribution and the per-aspect averages were correct only because the array
     * was complete, so paging the list at any point in the future would have left three visible
     * numbers describing page one while looking exactly as authoritative as before.
     */
    @GetMapping(Routes.Reviews.SUMMARY_FOR_PROPERTY)
    public ReviewSummaryResponse summary(@PathVariable UUID propId) {
        return reviewService.summaryForProperty(propId);
    }
}
