package com.punenest.api.provider.cashfree;

import com.punenest.api.provider.KycProvider;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * {@link KycProvider} backed by Cashfree Secure ID's DigiLocker flow — the real implementation of the
 * Aadhaar badge slice 3 shipped against a mock.
 *
 * <p>The flow is three-legged and this class owns only the first leg. {@code POST
 * /verification/digilocker} returns a consent URL, valid ten minutes, that the user opens; they log
 * in to DigiLocker with their Aadhaar and OTP and approve sharing. The <em>result</em> never comes
 * back on this call — it arrives later as a {@code DIGILOCKER_VERIFICATION_*} webhook, which is why
 * {@link KycProvider.KycSession#ref()} matters: it is the {@code verification_id} we chose, and the
 * only thing tying that webhook back to a PuneNest user. Secure ID has no polling endpoint, so
 * losing the ref means losing the verification.
 *
 * <p>Only wired when {@code punenest.providers.cashfree.enabled=true}; otherwise {@code
 * MockKycProvider} stands in and the badge flow is fully demoable with no vendor account.
 *
 * <p><strong>Unverified against a live account.</strong> PuneNest has no Cashfree credentials yet, so
 * the request and response field names here follow the published Secure ID contract but have never
 * been exercised. They must be confirmed against the sandbox before this flag is turned on — and note
 * that Cashfree's own documentation warns the DigiLocker sandbox requires a <em>real</em> Aadhaar
 * number, so there is no synthetic happy path to test with either.
 */
@Component
@ConditionalOnProperty(prefix = "punenest.providers.cashfree", name = "enabled", havingValue = "true")
class CashfreeKycProvider implements KycProvider {

    /** Secure ID is versioned separately from the Payment Gateway. */
    private static final String API_VERSION = "2024-12-01";

    /**
     * The consent URL Cashfree issues is valid for ten minutes. Reported as-is rather than padded:
     * telling the UI a session lives longer than it does produces a user staring at a dead link.
     */
    private static final Duration LINK_TTL = Duration.ofMinutes(10);

    private final CashfreeClient cashfree;
    private final String redirectUrl;

    CashfreeKycProvider(
            CashfreeClient cashfree,
            @org.springframework.beans.factory.annotation.Value(
                    "${punenest.providers.cashfree.kyc-redirect-url:https://punenest.in/verify/complete}")
            String redirectUrl) {
        this.cashfree = cashfree;
        this.redirectUrl = redirectUrl;
    }

    @Override
    public KycSession start(String userId) {
        // Our own id, not Cashfree's: it is echoed back on the webhook and is how the callback finds
        // the user again. A UUID rather than the user id itself so a leaked or logged verification id
        // is not also a user identifier.
        String verificationId = "pn_" + UUID.randomUUID();

        DigilockerResponse response = cashfree.post(
                "/verification/digilocker",
                API_VERSION,
                CashfreeClient.json(
                        "verification_id", verificationId,
                        // Aadhaar alone: the badge asserts identity, and asking for documents the
                        // product does not use would be collecting PII we have no reason to hold.
                        "document_requested", List.of("AADHAAR"),
                        "redirect_url", redirectUrl),
                DigilockerResponse.class);

        if (response == null || response.url() == null) {
            throw new CashfreeClient.CashfreeException(
                    "Cashfree returned no DigiLocker consent URL", null);
        }
        return new KycSession(verificationId, response.url(), Instant.now().plus(LINK_TTL));
    }

    /**
     * The subset of Cashfree's reply we use. Unknown fields are ignored by Jackson's default
     * behaviour on records, so the vendor adding one does not break the boot.
     */
    record DigilockerResponse(String verification_id, String reference_id, String url, String status) {
    }
}
