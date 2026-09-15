package com.draazy.api.identity.verification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Applicant's side of the identity badge (contract tag {@code Verification}). Multipart, not
 * pre-signed: the three sub-MB images must land atomically with consent and claims.
 */
@RestController
public class IdentityVerificationController {

    private final IdentityVerificationService service;

    public IdentityVerificationController(IdentityVerificationService service) {
        this.service = service;
    }

    /** {@code GET /me/verification/identity} (contract {@code getIdentityVerification}). */
    @GetMapping(Routes.Verification.IDENTITY)
    public IdentityVerificationResponse status(@CurrentUser AuthPrincipal principal) {
        return service.status(principal.userId());
    }

    /**
     * {@code POST /me/verification/identity} (contract {@code submitIdentityVerification}) — 202,
     * because acceptance into the queue is not a decision.
     */
    @PostMapping(value = Routes.Verification.IDENTITY, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public IdentityVerificationResponse submit(@CurrentUser AuthPrincipal principal,
            @RequestParam("docType") String docType,
            @RequestParam(value = "consent", defaultValue = "false") boolean consent,
            @RequestParam(value = "claims", required = false) String claims,
            @RequestParam(value = "front", required = false) MultipartFile front,
            @RequestParam(value = "back", required = false) MultipartFile back,
            @RequestParam(value = "selfie", required = false) MultipartFile selfie) {
        return service.submit(principal.userId(), docType, consent, claims, front, back, selfie);
    }
}
