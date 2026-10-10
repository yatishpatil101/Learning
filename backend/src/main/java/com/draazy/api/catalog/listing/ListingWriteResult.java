package com.draazy.api.catalog.listing;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/** The row's identity and the verdict the wizard acts on; the full record is {@code GET /me/listings/{id}}.
 * {@code archived} is sent only by the take-down. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ListingWriteResult(
        String id,
        String slug,
        String status,
        Boolean archived,
        boolean recheckPending,
        String recheckReason,
        Instant recheckRequestedAt) {
}
