package com.draazy.api.identity.verification;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Staff queue for identity cases (contract tag {@code Moderation}, {@code x-roles} staff/admin).
 * Read and decide are split into distinct {@code identity:*} atoms.
 */
@RestController
public class IdentityReviewController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String IDENTITY_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_IDENTITY_READ;
    private static final String IDENTITY_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_IDENTITY_WRITE;

    private final IdentityReviewService service;

    public IdentityReviewController(IdentityReviewService service) {
        this.service = service;
    }

    /** {@code GET /moderation/identity-reviews} (contract {@code listIdentityReviews}). */
    @GetMapping(Routes.Moderation.IDENTITY_REVIEWS)
    @PreAuthorize(IDENTITY_READ)
    public PageResponse<IdentityReviewResponse> queue(
            @RequestParam(required = false, defaultValue = VerificationStatuses.PENDING) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.queue(status, pageable), dto -> dto);
    }

    /** {@code GET /moderation/identity-reviews/{id}} (contract {@code getIdentityReview}). */
    @GetMapping(Routes.Moderation.IDENTITY_REVIEW_BY_ID)
    @PreAuthorize(IDENTITY_READ)
    public IdentityReviewResponse detail(@PathVariable UUID id) {
        return service.detail(id);
    }

    /** {@code POST /moderation/identity-reviews/{id}/approve} (contract {@code approveIdentityReview}). */
    @PostMapping(Routes.Moderation.IDENTITY_REVIEW_APPROVE)
    @PreAuthorize(IDENTITY_WRITE)
    public IdentityReviewResponse approve(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody IdentityApproveRequest body) {
        return service.approve(principal.userId(), id, body);
    }

    /** {@code POST /moderation/identity-reviews/{id}/reject} (contract {@code rejectIdentityReview}). */
    @PostMapping(Routes.Moderation.IDENTITY_REVIEW_REJECT)
    @PreAuthorize(IDENTITY_WRITE)
    public IdentityReviewResponse reject(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody IdentityRejectRequest body) {
        return service.reject(principal.userId(), id, body);
    }
}
