package com.draazy.api.catalog.photo;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.validation.MediaSignatures;
import java.util.Set;

/**
 * What the world-readable photo bucket accepts: raster images only, a size ceiling, and a magic-byte
 * check, because active content served from our CDN is stored XSS. docs/system/cross-cutting.md#87-uploads.
 */
public final class PhotoUploads {

    private PhotoUploads() {
    }

    /** Exclusive decimal limit: compression belongs to the browser, not the upload server. */
    public static final long MAX_BYTES = 1_000_000L;

    private static final Set<String> ALLOWED =
            Set.of(MediaSignatures.JPEG, MediaSignatures.PNG, MediaSignatures.HEIC);

    // Check size before sniffing so oversized content is reported as a size error.
    public static String validate(String contentType, long sizeBytes, byte[] content) {
        String declared = family(MediaSignatures.normalise(contentType));
        if (!ALLOWED.contains(declared)) {
            throw new UnsupportedMediaTypeException(
                    "Upload a photo (JPEG, JPG, PNG, HEIC or HEIF)");
        }
        if (sizeBytes >= MAX_BYTES || (content != null && content.length >= MAX_BYTES)) {
            throw new PayloadTooLargeException("Photos must be smaller than 1,000,000 bytes (1 MB)");
        }

        String actual = sniff(content);
        if (actual == null) {
            throw new UnsupportedMediaTypeException(
                    "That file is not a photo. Upload the original image, not a document or a link.");
        }
        // Aliases may agree, but PNG bytes labelled JPEG must never acquire the client's type.
        if (!actual.equals(declared)) {
            throw new UnsupportedMediaTypeException(
                    "That file is a " + actual + ", not the " + declared + " it claims to be.");
        }
        return actual;
    }

    // The shared detector also recognises private-document and messaging formats; this bucket does not.
    static String sniff(byte[] b) {
        String type = MediaSignatures.sniff(b);
        return type != null && ALLOWED.contains(type) ? type : null;
    }

    // Browsers use both spellings for the same image family.
    private static String family(String declared) {
        return switch (declared) {
            case "image/jpg" -> MediaSignatures.JPEG;
            case "image/heif" -> MediaSignatures.HEIC;
            default -> declared;
        };
    }
}
