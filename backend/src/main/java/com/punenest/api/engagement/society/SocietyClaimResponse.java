package com.punenest.api.engagement.society;

import java.time.Instant;
import java.util.UUID;

/**
 * A society claim as the claimant and ops see it (contract {@code SocietyClaim}).
 *
 * <p>Carries the society's slug and name so the ops queue reads as a list of societies rather than
 * a list of ids — the reviewer's first question is always "which building is this".
 *
 * @param registrationNo        what the claimant says the society is registered as, still unchecked
 *                              — this record is the request, not a finding
 * @param certificateDocumentId the vault row holding the scanned certificate, or {@code null} when
 *                              none was offered. Withheld from the public membership read alongside
 *                              the contact fields: it points into the claimant's own document vault,
 *                              and an identifier a stranger cannot dereference today is of no use to
 *                              them and of some use if they ever can
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
        String registrationNo,
        String certificateDocumentId,
        String status,
        Instant createdAt,
        Instant decidedAt) {
}
