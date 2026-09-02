package com.draazy.api.identity.verification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The caller's own identity badge at {@code /me/verification/aadhaar} (contract tag
 * {@code Moderation}): read it, or start the DigiLocker consent flow.
 *
 * <p>Authenticated (default-deny posture) and self-scoped — the subject is always the JWT's user, so
 * there is no id to tamper with and no way to read or start a verification for anyone else.
 *
 * <p>No role guard: the badge is open to every signed-in user by design. It is opt-in, additive, and
 * gates nothing (ADR-019).
 */
@RestController
public class VerificationController {

    private final VerificationService verificationService;

    public VerificationController(VerificationService verificationService) {
        this.verificationService = verificationService;
    }

    /**
     * {@code GET /me/verification/aadhaar} (contract {@code getAadhaarStatus}) — the caller's badge.
     * Always {@code 200}: a user who has never verified gets {@code badge=false, status="none"}.
     */
    @GetMapping(Routes.Verification.AADHAAR)
    public AadhaarVerificationResponse getAadhaarStatus(@CurrentUser AuthPrincipal principal) {
        return verificationService.status(principal.userId());
    }

    /**
     * {@code POST /me/verification/aadhaar} (contract {@code submitAadhaar}) — start the DigiLocker
     * consent flow.
     *
     * <p>{@code 202 Accepted}, not {@code 201}: nothing is verified yet. The client redirects the user
     * to {@code verificationUrl} and the badge appears only once the webhook lands.
     *
     * <p>The body is optional and carries at most a {@code redirectUrl}; it is accepted so the
     * contract's {@link KycStartRequest} is honoured, and deliberately unused today because the mock
     * and prod-stub providers both manage their own return URL. Notably it carries no Aadhaar number —
     * we never receive one.
     *
     * @throws com.draazy.api.common.error.AadhaarAlreadyRegisteredException {@code 409} when this
     *         caller's previous attempt collided with an identity already linked to another account
     */
    @PostMapping(Routes.Verification.AADHAAR)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public KycStartResponse submitAadhaar(@CurrentUser AuthPrincipal principal,
            @RequestBody(required = false) KycStartRequest body) {
        return verificationService.start(principal.userId());
    }
}
