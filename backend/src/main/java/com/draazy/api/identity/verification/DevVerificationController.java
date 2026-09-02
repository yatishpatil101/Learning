package com.draazy.api.identity.verification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.DevOnly;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A developer affordance, registered only where the {@code dev} profile is named ({@link DevOnly}),
 * that finishes the Aadhaar badge flow without a real DigiLocker webhook.
 *
 * <p><strong>Why this exists (D122).</strong> {@code POST /me/verification/aadhaar} returns a
 * <em>pending</em> handle; the badge is only ever granted by the provider callback at
 * {@code /webhooks/cashfree/digilocker}, which a dev backend never receives. So in http/dev mode a
 * user can start verification but never finish it — the earned-badge state, and everything gated on
 * it (verified-contact-only owners), is undemonstrable. This endpoint synthesizes the success.
 *
 * <p><strong>Why it is safe.</strong> The route exists only where somebody asked for the {@code dev}
 * profile by name, and {@link com.draazy.api.security.DevProfileGuard} kills the boot if that
 * request arrives on something that looks like a deployment. It was previously excluded by a
 * negative profile expression, which registered it under the no-profile default a mis-provisioned
 * container also runs under (D147). It is authenticated and self-scoped (the subject is always the
 * JWT's user), and it does not forge a badge by hand: it drives {@link
 * VerificationService#simulateSuccess}, which runs the real {@code handleWebhook} path, so the same
 * idempotency and one-Aadhaar-one-account dedup a real callback is subject to still apply.
 */
@RestController
@DevOnly
public class DevVerificationController {

    private final VerificationService verificationService;

    public DevVerificationController(VerificationService verificationService) {
        this.verificationService = verificationService;
    }

    /**
     * {@code POST /me/verification/aadhaar/simulate} — grant the caller the badge and return the
     * resulting status, the same shape {@code GET /me/verification/aadhaar} would now answer.
     */
    @PostMapping(Routes.Verification.AADHAAR_SIMULATE)
    public AadhaarVerificationResponse simulateAadhaarSuccess(@CurrentUser AuthPrincipal principal) {
        return verificationService.simulateSuccess(principal.userId());
    }
}
