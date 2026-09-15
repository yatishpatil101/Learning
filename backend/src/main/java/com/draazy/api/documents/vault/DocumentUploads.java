package com.draazy.api.documents.vault;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.validation.MediaSignatures;
import java.util.Set;

/**
 * Upload gate: allowlist + size ceiling + magic-byte check (declared and sniffed must agree, both
 * on the allowlist). Rationale: docs/system/cross-cutting.md#document-vault-allowlist-sniff-scan-store
 */
public final class DocumentUploads {

    private DocumentUploads() {
    }

    /** Exclusive decimal limit: compression belongs to the browser, not the upload server. */
    public static final long MAX_BYTES = 1_000_000L;

    static final String PDF = MediaSignatures.PDF;
    static final String JPEG = MediaSignatures.JPEG;
    static final String PNG = MediaSignatures.PNG;
    static final String HEIC = MediaSignatures.HEIC;
    private static final Set<String> ALLOWED = Set.of(PDF, JPEG, PNG, HEIC);

    // Check size before sniffing so oversized content is reported as a size error.
    public static String validate(String contentType, long sizeBytes, byte[] content) {
        String declared = switch (MediaSignatures.normalise(contentType)) {
            case "image/jpg" -> JPEG;
            case "image/heif" -> HEIC;
            case String type -> type;
        };
        if (!ALLOWED.contains(declared)) {
            throw new UnsupportedMediaTypeException(
                    "Upload a PDF or an image (JPEG, JPG, PNG, HEIC or HEIF)");
        }
        if (sizeBytes >= MAX_BYTES || (content != null && content.length >= MAX_BYTES)) {
            throw new PayloadTooLargeException("Files must be smaller than 1,000,000 bytes (1 MB)");
        }

        String actual = sniff(content);
        if (actual == null) {
            throw new UnsupportedMediaTypeException(
                    "That file is not a PDF or an image. Upload the original scan or photo.");
        }
        if (!actual.equals(declared)) {
            // The uploader knows the file, so naming both types helps diagnose an honest mismatch.
            throw new UnsupportedMediaTypeException(
                    "That file is a " + actual + ", not the " + declared + " it claims to be.");
        }
        return actual;
    }

    // Restrict this vault without removing formats used by message attachments from the shared detector.
    static String sniff(byte[] b) {
        String type = MediaSignatures.sniff(b);
        return type != null && ALLOWED.contains(type) ? type : null;
    }

    /**
     * Strip a client filename to something safe to store and show. Never used as a path (key is a
     * server-minted UUID); this only stops echoing {@code <script>} back into the dashboard.
     */
    public static String safeFileName(String raw) {
        return MediaSignatures.safeFileName(raw, "document");
    }
}
