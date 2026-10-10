package com.draazy.api.documents.vault;

import java.time.Instant;

/** File metadata only; the signed URL is minted on open by the {@link DocumentUrl} endpoints. */
public record DocumentSummary(
        String id,
        String category,
        String fileName,
        Long sizeBytes,
        String mimeType,
        Instant uploadedAt) {
}
