package com.draazy.api.finance.tenancy;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Tenancy reads and the tenant screening profile.
 *
 * <p>No {@code @PreAuthorize}: none of these operations carries {@code x-roles} in the spec, and
 * both tenancy lists are inherently caller-scoped — {@code /me/tenancies} by {@code tenant_id},
 * {@code /tenancies} by {@code owner_id} — so there is no id a caller could supply to reach
 * somebody else's row. The one exception, {@code GET /tenant-profiles/{mobile}}, is guarded by a
 * relationship check in {@link TenantProfileService#getByMobile} that answers 404 for every refusal.
 * {@code POST /tenant-profiles/verified} is the same read reduced to a badge for a whole list; it
 * carries the same relationship check and answers {@code false} for every refusal.
 *
 * <p>There is deliberately no {@code POST} here. See {@link TenancyService}.
 */
@RestController
public class TenancyController {

    private final TenancyService tenancyService;
    private final TenantProfileService profileService;

    public TenancyController(TenancyService tenancyService, TenantProfileService profileService) {
        this.tenancyService = tenancyService;
        this.profileService = profileService;
    }

    /** {@code GET /me/tenancies} (contract {@code myTenancies}) — the homes the caller rents. */
    @GetMapping(Routes.Tenancies.MINE)
    public List<TenancyDto> myTenancies(@CurrentUser AuthPrincipal principal) {
        return tenancyService.myTenancies(principal.userId());
    }

    /** {@code GET /tenancies} (contract {@code ownerTenancies}) — the caller's let listings. */
    @GetMapping(Routes.Tenancies.OWNED)
    public List<TenancyDto> ownerTenancies(@CurrentUser AuthPrincipal principal) {
        return tenancyService.ownerTenancies(principal.userId());
    }

    /** {@code GET /me/tenant-profile} (contract {@code getTenantProfile}). */
    @GetMapping(Routes.Tenancies.MY_PROFILE)
    public TenantProfileDto getMyProfile(@CurrentUser AuthPrincipal principal) {
        return profileService.getMine(principal.userId());
    }

    /** {@code PUT /me/tenant-profile} (contract {@code updateTenantProfile}) — returns the score. */
    @PutMapping(Routes.Tenancies.MY_PROFILE)
    public TenantProfileDto updateMyProfile(@CurrentUser AuthPrincipal principal,
                                            @Valid @RequestBody TenantProfileUpdateRequest body) {
        return profileService.updateMine(principal.userId(), body);
    }

    /** {@code GET /tenant-profiles/{mobile}} (contract {@code getTenantProfileByMobile}). */
    @GetMapping(Routes.Tenancies.PROFILE_BY_MOBILE)
    public TenantProfileDto getProfileByMobile(@CurrentUser AuthPrincipal principal,
                                               @PathVariable("mobile") String mobile) {
        return profileService.getByMobile(principal.userId(), mobile);
    }

    /**
     * {@code POST /tenant-profiles/verified} (contract {@code tenantsVerified}) — the badge, for a
     * whole list at once (tech-debt D114).
     *
     * <p><strong>A {@code POST} that reads nothing and writes nothing.</strong> The method is
     * chosen for where the parameters end up, not for what the operation does: the input is a list
     * of mobile numbers, and a query string carrying them would write the identifier the contact
     * gate exists to protect into access logs, proxy caches, browser history and {@code Referer}
     * headers. A body goes to none of those.
     *
     * <p>Because it is a {@code POST}, {@code WriteRateLimitFilter} counts it against the caller's
     * ordinary write budget without anything being added here — which is the right outcome and the
     * reason that filter matches on method rather than on a list of routes somebody has to
     * remember to extend.
     *
     * <p>Authorisation is exactly {@link TenantProfileService#getByMobile}'s and no wider: an entry
     * answers {@code true} only where that read would have succeeded. See the service.
     */
    @PostMapping(Routes.Tenancies.PROFILES_VERIFIED)
    public List<TenantVerifiedDto> tenantsVerified(@CurrentUser AuthPrincipal principal,
                                                   @Valid @RequestBody TenantVerifiedQuery body) {
        return profileService.verifiedByMobile(principal.userId(), body.mobiles());
    }
}
