package com.draazy.api.finance.tenancy;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

// There is deliberately no `POST` here.
// No role guard: the contract scopes tenancies by the caller, not by role.
@RestController
public class TenancyController {

    private final TenancyService tenancyService;
    private final TenantProfileService profileService;

    public TenancyController(TenancyService tenancyService, TenantProfileService profileService) {
        this.tenancyService = tenancyService;
        this.profileService = profileService;
    }

    @GetMapping(Routes.Tenancies.MINE)
    public List<TenancyDto> myTenancies(@CurrentUser AuthPrincipal principal) {
        return tenancyService.myTenancies(principal.userId());
    }

    @GetMapping(Routes.Tenancies.MY_PROFILE)
    public TenantProfileDto getMyProfile(@CurrentUser AuthPrincipal principal) {
        return profileService.getMine(principal.userId());
    }

    @PutMapping(Routes.Tenancies.MY_PROFILE)
    public TenantProfileDto updateMyProfile(@CurrentUser AuthPrincipal principal,
                                            @Valid @RequestBody TenantProfileUpdateRequest body) {
        return profileService.updateMine(principal.userId(), body);
    }

    // Authorization is the same as `getByMobile`; true means that read would work.
    // POST keeps this lookup inside the ordinary write-rate budget.
    @PostMapping(Routes.Tenancies.PROFILES_VERIFIED)
    public List<TenantVerifiedDto> tenantsVerified(@CurrentUser AuthPrincipal principal,
                                                   @Valid @RequestBody TenantVerifiedQuery body) {
        return profileService.verifiedByMobile(principal.userId(), body.mobiles());
    }
    }
