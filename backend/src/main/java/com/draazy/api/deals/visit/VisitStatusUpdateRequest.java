package com.draazy.api.deals.visit;

import jakarta.validation.constraints.NotBlank;

/**
 * The request body for {@code PATCH /visit-requests/{id}/status} (updateVisitStatus).
 *
 * @param status the target status (one of {@link VisitStatuses})
 * @param note   optional note (not currently stored on update, but present per the OpenAPI
 *               {@code StatusUpdate} schema)
 */
public record VisitStatusUpdateRequest(
        @NotBlank String status,
        String note) {
}
