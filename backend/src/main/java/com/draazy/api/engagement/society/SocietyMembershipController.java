package com.draazy.api.engagement.society;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
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

/**
 * {@code /societies/{slug}/…} — residency and committee control of one society.
 *
 * <p><strong>Where the authorisation lives.</strong> Not in {@code @PreAuthorize}. The reviewer of a
 * residency request is "platform staff, or the person whose claim on <em>this</em> society was
 * approved", and the second half of that cannot be written as a role expression — it is a fact about
 * a row. So the guard is {@code SocietyMembershipService.requireReviewer}, which takes both, and this
 * controller's job is only to tell it whether the caller is staff.
 *
 * <p>{@link #membership} is public and caller-aware, the same pattern {@code SocietyController} uses:
 * {@code permitAll} does not reject a bearer token, so a signed-in reader gets their own standing and
 * an anonymous one gets the society's public facts.
 */
@RestController
public class SocietyMembershipController {

    private final SocietyMembershipService memberships;

    private final SocietyClaimService claimService;

    public SocietyMembershipController(SocietyMembershipService memberships,
            SocietyClaimService claimService) {
        this.memberships = memberships;
        this.claimService = claimService;
    }

    /** {@code GET /societies/{slug}/membership} — public, caller-aware. */
    @GetMapping(Routes.Societies.MEMBERSHIP)
    public SocietyMembership membership(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug) {
        return memberships.membership(slug, viewerId(principal));
    }

    /**
     * {@code GET /societies/{slug}/residents} — the review queue. Committee or staff.
     *
     * <p>Sort is fixed to newest-first in the query, so a client sort is stripped rather than
     * allowed to produce a second {@code order by} the projection cannot satisfy.
     */
    @GetMapping(Routes.Societies.RESIDENTS_QUEUE)
    public PageResponse<SocietyResidentResponse> queue(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(memberships.queue(slug, status, principal.userId(),
                isStaff(principal), Pageables.unsorted(pageable)), r -> r);
    }

    /**
     * {@code POST /societies/{slug}/residents} — ask to be recognised as a resident.
     *
     * <p>200, not 201, and deliberately so: a person has at most one standing request per society,
     * so a second call amends the first rather than creating a second row. A 201 with a {@code
     * Location} would be a lie the second time and would teach a client to expect two.
     */
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
        return memberships.decide(slug, residentId, principal.userId(), isStaff(principal), body);
    }

    /** {@code POST /societies/{slug}/claim} — claim the society for its committee. 200 for the same reason. */
    @PostMapping(Routes.Societies.CLAIM)
    public SocietyClaimResponse claim(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @Valid @RequestBody SocietyClaimRequest body) {
        return claimService.claim(slug, principal.userId(), body);
    }

    /** Null for an anonymous reader — a legitimate state on {@link #membership}, not a failure. */
    private static UUID viewerId(AuthPrincipal principal) {
        return principal != null ? principal.userId() : null;
    }

    private static boolean isStaff(AuthPrincipal principal) {
        return principal != null
                && (Roles.Wire.STAFF.equals(principal.role()) || Roles.Wire.ADMIN.equals(principal.role()));
    }
}
