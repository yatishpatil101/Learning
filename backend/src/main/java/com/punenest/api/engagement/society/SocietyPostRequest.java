package com.punenest.api.engagement.society;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Ask a question, or answer one.
 *
 * <p>One record for both because the payload genuinely is the same — a body and nothing else — and
 * the two vocabularies do not differ the way {@code SocietyClaimDecision} and
 * {@code ResidentDecision} do. Splitting it would produce two identical schemas whose only
 * distinguishing feature was their names.
 *
 * <p>600 characters is the limit the hub's composer has always enforced client-side. It is here so
 * that a caller which is not the hub gets the same answer rather than a 500 from a column that has
 * no length in the first place.
 */
public record SocietyPostRequest(
        @NotBlank @Size(max = 600) String body) {
}
