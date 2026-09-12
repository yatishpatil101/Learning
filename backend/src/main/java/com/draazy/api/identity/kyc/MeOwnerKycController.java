package com.draazy.api.identity.kyc;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** The owner's own KYC record at {@code /me/owner-kyc}. Singular: one per user. */
@RestController
public class MeOwnerKycController {

    private final OwnerKycService kycService;

    public MeOwnerKycController(OwnerKycService kycService) {
        this.kycService = kycService;
    }

    /** {@code GET /me/owner-kyc} (contract {@code getOwnerKyc}). */
    @GetMapping(Routes.MeOwnerKyc.BASE)
    public OwnerKycDto getOwnerKyc(@CurrentUser AuthPrincipal principal) {
        return kycService.get(principal.userId());
    }

    /** {@code PUT /me/owner-kyc} (contract {@code saveOwnerKyc}). */
    @PutMapping(Routes.MeOwnerKyc.BASE)
    public OwnerKycDto saveOwnerKyc(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody OwnerKycUpdateRequest body) {
        return kycService.save(principal.userId(), body);
    }
}
