package com.punenest.api.engagement.society;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A committee asking to administer its society page (contract {@code SocietyClaimRequest}).
 *
 * <p>{@code role} is free text and not an enum. Committee titles in Pune are not a closed set —
 * secretary, chairman, treasurer, managing committee member, "building in-charge" — and a dropdown
 * that omits the caller's actual title teaches them to pick the nearest wrong one, which is worse
 * for the ops reviewer than the free text would have been.
 *
 * <p>{@code registrationNo} and {@code certificateDocumentId} are the proof an operator actually
 * decides on, and both are optional for the same reason: a committee that cannot lay hands on its
 * certificate this afternoon must still be able to reach us. Requiring either would trade a thin
 * queue for no queue.
 *
 * @param registrationNo        the society's Maharashtra registration number, as printed. Length-
 *                              capped and otherwise unconstrained — the format varies by registrar,
 *                              and a pattern would reject correct numbers and teach the claimant to
 *                              type something false to get past it
 * @param certificateDocumentId a row in the caller's <em>own</em> personal document vault holding
 *                              the scanned certificate. An id rather than the bytes: the file is
 *                              uploaded through the vault like every other paper on the platform,
 *                              so the claim points at it instead of inventing a second place for
 *                              stored files to live
 */
public record SocietyClaimRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 80) String role,
        @Email @Size(max = 160) String email,
        @Size(max = 500) String note,
        @Size(max = 80) String registrationNo,
        String certificateDocumentId) {
}
