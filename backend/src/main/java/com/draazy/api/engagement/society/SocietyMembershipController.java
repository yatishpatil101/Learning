package com.draazy.api.engagement.society;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Authorization depends on a society-claim row, so it cannot live in {@code @PreAuthorize}. */
@RestController
public class SocietyMembershipController {

    private final SocietyMembershipService memberships;

    private final SocietyClaimService claimService;

    private final AccountPermissions permissions;

    public SocietyMembershipController(SocietyMembershipService memberships,
            SocietyClaimService claimService, AccountPermissions permissions) {
        this.memberships = memberships;
        this.claimService = claimService;
        this.permissions = permissions;
    }

    /** Strip client sort because the projection only supports the fixed newest-first order. */
    @GetMapping(Routes.Societies.RESIDENTS_QUEUE)
    public PageResponse<SocietyResidentResponse> queue(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(memberships.queue(slug, status, principal.userId(),
                isStaff(principal), Pageables.unsorted(pageable)), r -> r);
    }

    /** 200 because each person has one standing request; a second call amends it. */
    @PostMapping(Routes.Societies.RESIDENTS)
    public SocietyResidentResponse requestVerification(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @Valid @RequestBody ResidentVerificationRequest body) {
        return memberships.requestVerification(slug, principal.userId(), body);
    }

    /** {@code PATCH /societies/{slug}/residents/{residentId}} — verify or reject. */
    @PatchMapping(Routes.Societies.RESIDENT_BY_ID)
    public SocietyResidentResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @PathVariable UUID residentId,
            @Valid @RequestBody ResidentDecisionRequest body) {
        return memberships.decide(slug, residentId, principal.userId(), canStaffDecide(principal), body);
    }

    @PostMapping(Routes.Societies.CLAIM)
    public SocietyClaimResponse claim(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @Valid @RequestBody SocietyClaimRequest body) {
        return claimService.claim(slug, principal.userId(), body);
    }

    private static boolean isStaff(AuthPrincipal principal) {
        return principal != null
                && Roles.isBackOffice(principal.role());
    }

    private boolean canStaffDecide(AuthPrincipal principal) {
        return isStaff(principal) && permissions.granted(principal, BackOfficePermissions.SOCIETIES_WRITE);
    }
}
