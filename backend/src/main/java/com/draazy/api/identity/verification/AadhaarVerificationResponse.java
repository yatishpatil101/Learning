package com.draazy.api.identity.verification;

import java.time.Instant;

/**
 * The caller's opt-in identity badge (contract {@code AadhaarVerification}).
 *
 * <p><strong>Absence never blocks anything</strong> (ADR-019). A user with no verification row gets
 * {@code badge=false, status="none"} and every other field {@code null} — a complete, unremarkable
 * answer, not an error. The client uses it to decide whether to offer the badge prompt, never to
 * decide whether to allow an action.
 *
 * <p>The raw Aadhaar number appears nowhere here, and is never received, stored or logged anywhere in
 * the system: DigiLocker returns only a masked last-4 and a hash.
 *
 * @param source        {@link VerificationSources#DIGILOCKER}, or {@code null} before any attempt
 * @param maskedAadhaar last four digits only, e.g. {@code XXXX XXXX 1234}
 * @param mobileMatch   soft signal (ADR-009a) — whether the Aadhaar-linked mobile matched the account
 *                      mobile. Explicitly nullable and explicitly <em>not</em> a gate at MVP; it is
 *                      recorded so a later risk model can use it, and ignored by every check today
 * @param verifiedAt    when the badge was granted, {@code null} until then
 */
public record AadhaarVerificationResponse(
        boolean badge,
        String status,
        String source,
        String maskedAadhaar,
        Boolean mobileMatch,
        Instant verifiedAt) {

    /**
     * The "never attempted" answer, returned when a user has no verification row at all.
     *
     * <p>Lives here rather than on {@code VerificationMapper} deliberately: MapStruct treats any
     * no-argument method returning the target type as an <em>object factory</em> and silently routes
     * its real mapping through it, which quietly produced an all-empty badge for verified users. The
     * canonical empty shape belongs to the DTO anyway.
     */
    public static AadhaarVerificationResponse none() {
        return new AadhaarVerificationResponse(
                false, VerificationStatuses.NONE, null, null, null, null);
    }
}
