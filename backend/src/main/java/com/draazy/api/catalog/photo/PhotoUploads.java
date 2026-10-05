package com.draazy.api.catalog.photo;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.validation.MediaSignatures;
import com.draazy.api.common.web.Routes;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.Set;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

/** What the world-readable photo bucket accepts: raster images only, a size ceiling, and a magic-byte
 * check, because active content served from our CDN is stored XSS. docs/system/cross-cutting.md#87-uploads. */
public final class PhotoUploads {

    private PhotoUploads() {
    }

    /** Exclusive decimal limit: compression belongs to the browser, not the upload server. */
    public static final long MAX_BYTES = Routes.MePhotos.MAX_FILE_BYTES;

    static final int MAX_EDGE = 10_000;
    static final long MAX_PIXELS = 40_000_000L;

    private static final Set<String> ALLOWED = Set.of(MediaSignatures.JPEG, MediaSignatures.PNG);

    // Check size before sniffing so oversized content is reported as a size error.
    public static String validate(String contentType, long sizeBytes, byte[] content) {
        return validate(contentType, sizeBytes, content, MAX_BYTES - 1,
                "Photos must be smaller than 1,000,000 bytes (1 MB)");
    }

    public static String validate(String contentType, long sizeBytes, byte[] content,
            long maxBytes, String sizeMessage) {
        String declared = family(MediaSignatures.normalise(contentType));
        if (!ALLOWED.contains(declared)) {
            throw new UnsupportedMediaTypeException("Upload a photo (JPEG, JPG or PNG)");
        }
        if (sizeBytes > maxBytes || (content != null && content.length > maxBytes)) {
            throw new PayloadTooLargeException(sizeMessage);
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
        requireSaneCanvas(content);
        return actual;
    }

    private static void requireSaneCanvas(byte[] content) {
        long[] size = declaredSize(content);
        if (size != null && (size[0] > MAX_EDGE || size[1] > MAX_EDGE || size[0] * size[1] > MAX_PIXELS)) {
            throw new PayloadTooLargeException(
                    "Photos can be at most 10,000 pixels on a side and 40 megapixels in all.");
        }
    }

    private static long[] declaredSize(byte[] content) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(content))) {
            Iterator<ImageReader> readers = in == null ? null : ImageIO.getImageReaders(in);
            if (readers == null || !readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                return new long[] {reader.getWidth(0), reader.getHeight(0)};
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    // The shared detector also recognises private-document and messaging formats; this bucket does not.
    static String sniff(byte[] b) {
        String type = MediaSignatures.sniff(b);
        return type != null && ALLOWED.contains(type) ? type : null;
    }

    private static String family(String declared) {
        return "image/jpg".equals(declared) ? MediaSignatures.JPEG : declared;
    }
}
