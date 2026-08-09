package com.punenest.api.services.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;

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
 * @param details    the fields the customer filled — property, rent, deposit, scope — as a structured
 *                   object (D119). Stored as-is and echoed back on {@link ServiceRequestDto}, so what
 *                   the form sent is what the tracker reads; optional
 */
public record ServiceRequestCreate(
        @NotBlank @Size(max = 64) String type,
        @Size(max = 64) String propertyId,
        Map<String, Object> details) {
}
