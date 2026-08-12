package com.punenest.api.deals.visit;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.Instant;

/**
 * The request body for both {@code POST /visits} (scheduleVisit) and {@code POST /visit-requests}
 * (requestVisit). Both endpoints create a visit; they differ only in which client calls them
 * (the visitor surface vs. the owner-adjacent surface — D3).
 *
 * @param propertyId the listing to visit (required — spec fix S2)
 * @param slot       the proposed date/time as a single ISO instant (reconciliation item c)
 * @param mode       {@code in-person} or {@code video}; defaults to {@code in-person}
 */
public record VisitCreateRequest(
        @NotBlank String propertyId,
        @NotNull Instant slot,
        @Pattern(regexp = VisitModes.PATTERN) String mode,
        String note) {
}
