package com.punenest.api.catalog.photo;

import com.punenest.api.common.error.PayloadTooLargeException;
import com.punenest.api.common.error.UnsupportedMediaTypeException;
import java.util.Set;

/**
 * What the public photo bucket will accept: an image-only allowlist, a size ceiling, and the
 * magic-byte check that decides whether a file's declared type or its actual bytes are believed.
 *
 * <p><strong>Why a separate validator from {@code DocumentUploads}.</strong> The two guard opposite
 * kinds of object. A document is private — stored behind a signed URL — so the vault can afford to
 * accept PDFs. A photo is <em>world-readable</em>: {@link PhotoService} routes it through
 * {@code storePublic} to a CDN URL that anyone can open with no signature. That raises the stakes on
 * exactly one thing — active content. An SVG or an HTML file served from a PuneNest-looking CDN
 * origin is stored XSS, so this allowlist is raster images only: no PDF, and above all no SVG, which
 * is XML the browser will execute. Sharing {@code DocumentUploads} would mean either widening the
 * document allowlist or narrowing the photo one at every call site; a small, honest duplication of
 * five signatures is safer than coupling the KYC path to the photo path.
 *
 * <p><strong>The declared type is a claim; the leading bytes are evidence.</strong> The declared
 * {@code Content-Type} must be on the allowlist, and the file's own signature must independently
 * resolve to the <em>same image family</em>. A {@code text/html} payload sent as {@code image/png}
 * passes the first check and fails the second. The stored content type is the one the bytes prove,
 * never the one the client sent, so a mislabelled file can never come back out of the CDN with a
 * {@code Content-Type} that makes a browser render it as something dangerous.
 *
 * <p><strong>What this deliberately does not do.</strong> It does not decode the image. The threat
 * is a file that is not an image at all — HTML, SVG, a script — and five signatures read from the
 * first twelve bytes answer that completely. A malformed-but-genuine JPEG is a decoder problem the
 * CDN, not this gate, is responsible for.
 */
public final class PhotoUploads {

    private PhotoUploads() {
    }

    /** 5 MB — matching the front-end's own photo cap; a listing photo is ~1–3 MB. */
    public static final long MAX_BYTES = 5L * 1024 * 1024;

    static final String JPEG = "image/jpeg";
    static final String PNG = "image/png";
    static final String WEBP = "image/webp";
    static final String HEIC = "image/heic";
    static final String AVIF = "image/avif";

    /**
     * Declared types the browser is allowed to send. {@code image/heif} is accepted as an alias of
     * {@code image/heic} because iOS and some browsers label the same HEIF-family bytes either way;
     * both normalise to the {@link #HEIC} family below.
     */
    private static final Set<String> ALLOWED_DECLARED =
            Set.of(JPEG, PNG, WEBP, HEIC, "image/heif", AVIF);

    /**
     * ISO base-media brands that mean "HEIF-family image". {@code mif1}/{@code msf1} are the generic
     * image and image-sequence brands iOS also emits, so a real iPhone HEIC does not always carry a
     * {@code heic} brand.
     */
    private static final Set<String> HEIF_BRANDS = Set.of(
            "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1");

    /** ISO base-media brands that mean "AVIF image" (still image and image sequence). */
    private static final Set<String> AVIF_BRANDS = Set.of("avif", "avis");

    /** Longest prefix any signature needs: {@code RIFF} + 4 size bytes + {@code WEBP}. */
    private static final int SNIFF_BYTES = 12;

    /**
     * Prove an upload is one of the five accepted image types and return that type.
     *
     * <p>The order of the three checks is deliberate: the declared type is rejected first because it
     * is the cheapest answer and the most common mistake; size next, so an oversized file is
     * reported as oversized rather than as whatever its first bytes look like; sniffing last, on a
     * file already known small enough to hold in memory.
     *
     * @param contentType the client's declared type; used to reject, never to store
     * @param sizeBytes   the declared size
     * @param content     the file's bytes, needed for the signature check
     * @return the media type proved by the file's own signature — this is what the caller stores
     * @throws UnsupportedMediaTypeException when the declared type is not an accepted image, when
     *                                       the bytes match no accepted signature, or when the two
     *                                       describe different image families
     * @throws PayloadTooLargeException      when the file exceeds {@link #MAX_BYTES}
     */
    public static String validate(String contentType, long sizeBytes, byte[] content) {
        String declared = normalise(contentType);
        if (!ALLOWED_DECLARED.contains(declared)) {
            throw new UnsupportedMediaTypeException(
                    "Upload a photo (JPEG, PNG, WebP, HEIC or AVIF)");
        }
        if (sizeBytes > MAX_BYTES) {
            throw new PayloadTooLargeException("That photo is too large to upload (max 5 MB)");
        }

        String actual = sniff(content);
        if (actual == null) {
            throw new UnsupportedMediaTypeException(
                    "That file is not a photo. Upload the original image, not a document or a link.");
        }
        // Family-level agreement, not string equality: image/heif and image/heic are the same
        // family, so requiring an exact match would reject a genuine iPhone photo whose browser
        // labelled it the other way. What must not differ is the family itself — PNG bytes sent as
        // image/jpeg is the mismatch this catches.
        if (!actual.equals(family(declared))) {
            throw new UnsupportedMediaTypeException(
                    "That file is a " + actual + ", not the " + declared + " it claims to be.");
        }
        return actual;
    }

    /**
     * The image type the leading bytes actually describe, or {@code null} for anything unrecognised.
     *
     * <p>Unrecognised is the safe default and covers the case that matters: HTML, SVG and scripts
     * have no fixed binary signature, so "no signature" and "not a photo" are the same answer — and
     * that is exactly what keeps executable markup out of the public bucket.
     */
    static String sniff(byte[] b) {
        if (b == null || b.length < 4) {
            return null;
        }
        // SOI marker plus the first byte of the next segment; two bytes alone collide too easily.
        if (matches(b, 0xFF, 0xD8, 0xFF)) {
            return JPEG;
        }
        if (matches(b, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) {
            return PNG;
        }
        if (b.length >= SNIFF_BYTES && starts(b, 'R', 'I', 'F', 'F') && ascii(b, 8, 4).equals("WEBP")) {
            return WEBP;
        }
        // ISO base media: [4-byte box size][ftyp][4-byte brand]. The size prefix is why the brand
        // sits at offset 8 rather than at the start of the file.
        if (b.length >= SNIFF_BYTES && ascii(b, 4, 4).equals("ftyp")) {
            String brand = ascii(b, 8, 4);
            if (HEIF_BRANDS.contains(brand)) {
                return HEIC;
            }
            if (AVIF_BRANDS.contains(brand)) {
                return AVIF;
            }
        }
        return null;
    }

    /** Collapse a declared type onto the canonical family the sniffer returns. */
    private static String family(String declared) {
        return "image/heif".equals(declared) ? HEIC : declared;
    }

    private static String normalise(String contentType) {
        return contentType == null ? "" : contentType.split(";", 2)[0].trim().toLowerCase();
    }

    private static boolean starts(byte[] b, char... chars) {
        if (b.length < chars.length) {
            return false;
        }
        for (int i = 0; i < chars.length; i++) {
            if (b[i] != (byte) chars[i]) {
                return false;
            }
        }
        return true;
    }

    private static boolean matches(byte[] b, int... unsigned) {
        if (b.length < unsigned.length) {
            return false;
        }
        for (int i = 0; i < unsigned.length; i++) {
            if ((b[i] & 0xFF) != unsigned[i]) {
                return false;
            }
        }
        return true;
    }

    private static String ascii(byte[] b, int from, int length) {
        return new String(b, from, length, java.nio.charset.StandardCharsets.US_ASCII);
    }
}
