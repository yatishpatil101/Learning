package com.punenest.api.services.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code ServiceRequestCreate}.
 *
 * <p>No {@code status} field, and that is the point of a separate create schema: the workflow starts
 * at {@code new} for everyone. A client that could post {@code status: approved} would skip the
 * entire maker-checker.
 *
 * @param propertyId the listing this is about; optional, because a general legal query has no
 *                   listing — but a request without one cannot later carry documents (see
 *                   {@link ServiceRequestService#addDocument})
 */
public record ServiceRequestCreate(
        @NotBlank @Size(max = 64) String type,
        @Size(max = 64) String propertyId,
        @Size(max = 4000) String details) {
}
