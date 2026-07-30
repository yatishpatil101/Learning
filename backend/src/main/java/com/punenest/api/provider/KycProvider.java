package com.punenest.api.provider;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
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

/** Dev/default: deterministic fake session, no external call. */
@Component
@Profile("!prod")
class MockKycProvider implements KycProvider {

    @Override
    public KycSession start(String userId) {
        String ref = "mock_kyc_" + UUID.randomUUID();
        return new KycSession(ref,
                "https://mock.kyc.local/verify/" + ref,
                Instant.now().plus(Duration.ofMinutes(15)));
    }
}

/** Prod stub: fail until DigiLocker/Cashfree KYC is wired in. */
@Component
@Profile("prod")
class DigilockerKycProvider implements KycProvider {

    @Override
    public KycSession start(String userId) {
        throw new UnsupportedOperationException("KYC provider not configured for prod yet");
    }
}
