package com.punenest.api.deals.visit;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * The request body for {@code PATCH /visits/{id}/slot} (rescheduleVisit) — move a live visit to a
 * new slot. Carries only the new instant; the service resets the visit to {@code scheduled} so the
 * other party re-confirms (D87).
 *
 * @param slot the new date/time as a single ISO instant (same shape as {@link VisitCreateRequest})
 */
public record VisitSlotUpdateRequest(
        @NotNull Instant slot) {
}
