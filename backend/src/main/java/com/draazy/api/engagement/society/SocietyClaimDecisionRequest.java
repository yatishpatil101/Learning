package com.draazy.api.engagement.society;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Ops deciding a society claim (contract {@code SocietyClaimDecision}).
 *
 * <p>Separate from {@code ResidentDecisionRequest} despite the identical shape, because the accepted
 * vocabularies differ — a claim is {@code approved}, a residency is {@code verified} — and one DTO
 * would have to document both and validate neither.
 */
public record SocietyClaimDecisionRequest(
        @NotBlank @Size(max = 16) String status,
        @Size(max = 500) String note) {
}
