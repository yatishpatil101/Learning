package com.punenest.api.provider;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Seam for identity (Aadhaar/DigiLocker) verification (ADR-009). Starting a KYC session returns a
 * hosted {@code verificationUrl} the user completes; the result arrives later via the DigiLocker
 * webhook. Dev returns a deterministic session so the opt-in-badge flow is demoable with no vendor.
 */
public interface KycProvider {

    /** Begin a verification session for a user. */
    KycSession start(String userId);

    /** A started KYC session: a correlation {@code ref}, the hosted URL, and its expiry. */
    record KycSession(String ref, String verificationUrl, Instant expiresAt) {
    }
}

/**
 * Default: deterministic fake session, no external call.
 *
 * <p>Selected by the <em>absence</em> of Cashfree credentials rather than by environment. This seam
 * used to be split on {@code @Profile("prod")}, which meant a developer holding real sandbox keys
 * could never exercise the live path and a production deployment could never fall back to mocks
 * during a vendor outage; see {@link com.punenest.api.provider.cashfree.CashfreeProperties} for why
 * those are separate questions.
 */
@Component
@ConditionalOnProperty(prefix = "punenest.providers.cashfree", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class MockKycProvider implements KycProvider {

    @Override
    public KycSession start(String userId) {
        String ref = "mock_kyc_" + UUID.randomUUID();
        return new KycSession(ref,
                "https://mock.kyc.local/verify/" + ref,
                Instant.now().plus(Duration.ofMinutes(15)));
    }
}
