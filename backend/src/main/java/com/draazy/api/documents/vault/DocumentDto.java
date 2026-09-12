package com.draazy.api.documents.vault;

import java.time.Instant;

/**
 * Contract schema {@code Document}.
 *
 * @param url a short-lived signed URL minted at read time — never stored, and not stable between
 *            two reads of the same document
 */
public record DocumentDto(
        String id,
        String propertyId,
        String category,
        String fileName,
        String url,
        Long sizeBytes,
        String mimeType,
        Instant uploadedAt) {
}
