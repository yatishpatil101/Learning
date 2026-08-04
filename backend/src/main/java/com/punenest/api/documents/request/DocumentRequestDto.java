package com.punenest.api.documents.request;

import java.time.Instant;
import java.util.List;

/**
 * Contract schema {@code DocumentRequest} — the owner's inbox row.
 *
 * @param requester   the asking buyer, mobile always masked (this surface never reveals a number;
 *                    the contact gate is the only place that does)
 * @param shareToken  present only once granted. Owner-facing by contract, so the owner can resend
 *                    the link they issued
 * @param expiresAt   spec fix S37 — when the grant lapses; {@code null} until granted
 */
public record DocumentRequestDto(
        String id,
        String propertyId,
        Party requester,
        List<String> categories,
        String status,
        String shareToken,
        Instant expiresAt,
        boolean acknowledgedDisclaimer,
        Instant createdAt) {

    /** Contract schema {@code Party}, projected for this surface. */
    public record Party(String id, String name, String mobile, String role) {
    }
}
