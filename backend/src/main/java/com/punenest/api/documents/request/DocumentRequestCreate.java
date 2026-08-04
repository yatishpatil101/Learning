package com.punenest.api.documents.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Contract schema {@code DocumentRequestCreate}.
 *
 * @param acknowledgedDisclaimer spec fix S35 — the buyer ticking the sensitive-documents
 *                               disclaimer. Boxed rather than primitive so an absent field stays
 *                               absent (defaulting to {@code false}) instead of a missing tick
 *                               silently reading as a deliberate "no".
 */
public record DocumentRequestCreate(
        @NotBlank String propertyId,
        List<@Size(max = 80) String> categories,
        @Size(max = 500) String message,
        Boolean acknowledgedDisclaimer) {
}
