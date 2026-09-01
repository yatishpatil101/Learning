package com.punenest.api.engagement.society;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/society-claims} — ops deciding which committees may run their own society page.
 *
 * <p>Reuses the {@code societies:read} / {@code societies:write} atoms that already guard the B2B
 * society pipeline. The two queues are the same job seen from two ends — a lead is a society we want
 * on the platform, a claim is a society that has come to us — and whoever works one works the other.
 * A third atom would mean an existing ops account that can already run the society desk being
 * silently unable to clear this queue.
 *
 * <p>Approving here is what makes the committee a reviewer in
 * {@link SocietyMembershipService#requireReviewer}, so this route is the only way authority over a
 * society page is ever granted.
 */
@RestController
public class SocietyClaimAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String SOCIETIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_READ;

    private static final String SOCIETIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_WRITE;

    private final SocietyClaimService claimService;

    public SocietyClaimAdminController(SocietyClaimService claimService) {
        this.claimService = claimService;
    }

    /** {@code GET /admin/society-claims} — the queue, oldest first. */
    @GetMapping(Routes.SocietyClaims.BASE)
    @PreAuthorize(SOCIETIES_READ)
    public PageResponse<SocietyClaimResponse> queue(@RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(claimService.claimQueue(status, Pageables.unsorted(pageable)), c -> c);
    }

    /** {@code PATCH /admin/society-claims/{id}} — approve or reject. */
    @PatchMapping(Routes.SocietyClaims.BY_ID)
    @PreAuthorize(SOCIETIES_WRITE)
    public SocietyClaimResponse decide(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody SocietyClaimDecisionRequest body) {
        return claimService.decideClaim(id, principal.userId(), body);
    }

    /**
     * {@code GET /admin/society-claims/{id}/certificate} — one short-lived link to the proof.
     *
     * <p>{@code societies:read}, the same atom as the queue, not a third one. Whoever is trusted to
     * work this queue is trusted to look at the evidence in it — a reviewer who can approve a claim
     * but cannot open the certificate is a reviewer approving it blind, which is worse than either.
     *
     * <p>Its own request rather than a field on the queue rows. The queue pages at twenty and an
     * operator opens the certificate on a small minority of them, so signing every row would mint
     * twenty expiring URLs per page view to serve the one that gets clicked — and would put a live
     * capability for twenty people's vault documents into a response body that is rendered, cached
     * by the browser and, on a shared ops machine, sitting in devtools. One click, one URL, one
     * audit row.
     */
    @GetMapping(Routes.SocietyClaims.CERTIFICATE)
    @PreAuthorize(SOCIETIES_READ)
    public SocietyClaimCertificateResponse certificate(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id) {
        return claimService.claimCertificate(id, principal);
    }
}
