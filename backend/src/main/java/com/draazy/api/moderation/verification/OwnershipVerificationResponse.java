package com.draazy.api.moderation.verification;

import java.time.Instant;
import java.util.List;

/**
 * The ownership gate for one listing (D190/Q15) — the case file behind the
 * <strong>Ownership Verified</strong> badge.
 *
 * <p>{@code missingKinds} is the reason the badge is not granted, and it is the field that makes
 * this worth returning at all. Ops working a queue needs "waiting on identity" rather than "not
 * verified", and an owner told only that their listing is unverified has no idea what to send.
 *
 * <p>{@code verifiedUntil} is {@code null} in two very different situations — never verified, and
 * verified on documents that do not expire — so it is read together with {@code verified} rather
 * than alone.
 */
public record OwnershipVerificationResponse(
        String propertyId,
        boolean verified,
        Instant verifiedAt,
        Instant verifiedUntil,
        List<String> missingKinds,
        List<Evidence> evidence) {

    /**
     * One recorded document.
     *
     * @param subjectName whose identity the document is, on the two doc types that name a person
     *                    (D202). Staff-only, and null on every other kind
     * @param current whether it still proves what it proves, as at the moment this was read — an
     *                expired row stays in the list because the case file is a history, not a
     *                snapshot
     */
    public record Evidence(
            String id,
            String docType,
            String kind,
            String documentId,
            String subjectName,
            Instant issuedAt,
            Instant expiresAt,
            boolean current) {
    }
}
