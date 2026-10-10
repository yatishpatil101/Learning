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
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

// Read and decide are split into distinct identity:* atoms for maker-checker permissions.
@RestController
public class IdentityReviewController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String IDENTITY_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_IDENTITY_READ;
    private static final String IDENTITY_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_IDENTITY_WRITE;

    private final IdentityReviewService service;
    private final IdentityReviewQueueService queue;
    private final IdentityReviewClaimService claims;
    private final IdentityQaService qa;

    public IdentityReviewController(IdentityReviewService service, IdentityReviewQueueService queue,
            IdentityReviewClaimService claims, IdentityQaService qa) {
        this.service = service;
        this.queue = queue;
        this.claims = claims;
        this.qa = qa;
    }

    /** {@code GET /moderation/identity-reviews} (contract {@code listIdentityReviews}). */
    @GetMapping(Routes.Moderation.IDENTITY_REVIEWS)
    @PreAuthorize(IDENTITY_READ)
    public PageResponse<IdentityReviewRow> queue(
            @CurrentUser AuthPrincipal principal,
            @RequestParam(required = false, defaultValue = VerificationStatuses.PENDING) String status,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String docType,
            @RequestParam(required = false) String claim,
            @RequestParam(defaultValue = "false") boolean overdue,
            @RequestParam(required = false) String outcome,
            @RequestParam(required = false) String sort,
            @PageableDefault(size = 20) Pageable pageable) {
        var filters = new IdentityReviewQueueService.Filters(status, q, docType, claim, overdue, outcome, sort);
        return PageResponse.of(queue.queue(principal, filters, pageable), dto -> dto);
    }

    @GetMapping(Routes.Moderation.IDENTITY_REVIEW_SUMMARY)
    @PreAuthorize(IDENTITY_READ)
    public IdentityReviewQueueService.Summary summary(@CurrentUser AuthPrincipal principal) {
        return queue.summary(principal);
    }

    @GetMapping(Routes.Moderation.IDENTITY_REVIEW_BY_ID)
    @PreAuthorize(IDENTITY_READ)
    public IdentityReviewResponse detail(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        return service.detail(principal, id);
    }

    /** {@code POST /moderation/identity-reviews/{id}/approve} (contract {@code approveIdentityReview}). */
    @PostMapping(Routes.Moderation.IDENTITY_REVIEW_APPROVE)
    @PreAuthorize(IDENTITY_WRITE)
    public IdentityReviewResponse approve(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody IdentityApproveRequest body) {
        return service.approve(principal, id, body);
    }

    /** {@code POST /moderation/identity-reviews/{id}/reject} (contract {@code rejectIdentityReview}). */
    @PostMapping(Routes.Moderation.IDENTITY_REVIEW_REJECT)
    @PreAuthorize(IDENTITY_WRITE)
    public IdentityReviewResponse reject(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody IdentityRejectRequest body) {
        return service.reject(principal, id, body);
    }

    @PostMapping(Routes.Moderation.IDENTITY_REVIEW_REVOKE)
    @PreAuthorize(IDENTITY_WRITE)
    public IdentityReviewResponse revoke(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody IdentityRevokeRequest body) {
        return service.revoke(principal, id, body);
    }

    @PostMapping(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim")
    @PreAuthorize(IDENTITY_WRITE)
    public IdentityClaimState claim(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        return claims.claim(principal, id);
    }

    @DeleteMapping(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim")
    @PreAuthorize(IDENTITY_WRITE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void releaseClaim(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @RequestParam(defaultValue = "false") boolean force) {
        claims.releaseClaim(principal, id, force);
    }

    @PostMapping(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/qa")
    @PreAuthorize(IDENTITY_WRITE)
    public IdentityReviewResponse qa(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody IdentityQaRequest body) {
        return qa.qa(principal, id, body);
    }
}
