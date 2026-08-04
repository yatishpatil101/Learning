package com.punenest.api.finance.tenancy;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
}
