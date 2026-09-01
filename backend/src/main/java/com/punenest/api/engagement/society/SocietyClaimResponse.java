package com.punenest.api.engagement.society;

import java.time.Instant;
import java.util.UUID;

/**
 * A society claim as the claimant and ops see it (contract {@code SocietyClaim}).
 *
 * <p>Carries the society's slug and name so the ops queue reads as a list of societies rather than
 * a list of ids — the reviewer's first question is always "which building is this".
 */
public record SocietyClaimResponse(
        UUID id,
        String societySlug,
        String societyName,
        String claimantName,
        String claimantMobile,
        String role,
        String email,
        String note,
        String status,
        Instant createdAt,
        Instant decidedAt) {
}
