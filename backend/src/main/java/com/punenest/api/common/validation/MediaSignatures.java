package com.punenest.api.common.validation;

import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * What a file's leading bytes actually say it is, independent of what its uploader claimed.
 *
 * <p><strong>Why this is in the kernel.</strong> It was written inside {@code documents.vault} for
 * the document vault, which is a feature context. A second upload surface then needed the identical
 * check — message attachments (D49) — and message attachments live under {@code common}, because
 * they are shared by {@code leads.conversation} (layer 2) and {@code services.support} (layer 3) and
 * the layering forbids either of those importing the other or reaching sideways into
 * {@code documents}. The choice was therefore a second copy of the signature table or one copy in
 * the kernel, and a second copy of a security check is the worse of the two: the day someone adds a
 * signature or fixes a false positive, only one of the copies gets it.
 *
 * <p>{@code DocumentUploads} keeps its own allowlist, size ceiling and error wording and delegates
 * only the sniffing here, so the vault's behaviour is unchanged.
 *
 * <p><strong>What this deliberately does not do.</strong> It does not parse the file. A real PDF
 * parser or image decoder would be a far larger attack surface than the one it closes, and the
 * threat is not a malformed-but-genuine PDF — it is a file that is not a PDF at all. Five
 * signatures, read from the first twelve bytes, answer that question completely. Nor does it look at
 * the extension: the filename decides nothing and the storage key is server-minted.
 */
public final class MediaSignatures {

    private MediaSignatures() {
    }

    public static final String PDF = "application/pdf";
    public static final String JPEG = "image/jpeg";
    public static final String PNG = "image/png";
    public static final String HEIC = "image/heic";
    public static final String WEBP = "image/webp";

    /**
     * ISO base-media brands that mean "this is HEIF-family image data". {@code mif1} and {@code
     * msf1} are the generic image and image-sequence brands that iOS also emits, so a HEIC from a
     * real iPhone does not always carry a {@code heic} brand.
     */
    private static final Set<String> HEIF_BRANDS = Set.of(
            "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1");

    /** Longest prefix any signature needs: {@code RIFF} + 4 size bytes + {@code WEBP}. */
    private static final int SNIFF_BYTES = 12;

    /**
     * The media type the leading bytes actually describe, or {@code null} for anything unrecognised.
     *
     * <p>Unrecognised is the safe default and covers the case that matters: HTML, SVG and scripts
     * have no fixed signature at all, so "no signature" and "not a document" are the same answer.
     */
    public static String sniff(byte[] b) {
        if (b == null || b.length < 4) {
            return null;
        }
        if (starts(b, '%', 'P', 'D', 'F', '-')) {
            return PDF;
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
        if (b.length >= SNIFF_BYTES && ascii(b, 4, 4).equals("ftyp")
                && HEIF_BRANDS.contains(ascii(b, 8, 4))) {
            return HEIC;
        }
        return null;
    }

    /** The bare media type, lower-cased, with any {@code ;charset=…} parameter dropped. */
    public static String normalise(String contentType) {
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
        return new String(b, from, length, StandardCharsets.US_ASCII);
    }

    /**
     * Strip a client filename down to something safe to store and show. The result is never used as
     * a path — every storage key on this platform is a server-minted UUID — so this is about not
     * echoing {@code <script>} or a traversal string back into somebody's dashboard or chat thread,
     * not about path safety.
     *
     * @param fallback what to call a file whose name was blank or absent
     */
    public static String safeFileName(String raw, String fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String base = raw.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        base = base.replaceAll("[^A-Za-z0-9._-]", "_");
        return base.length() > 120 ? base.substring(base.length() - 120) : base;
    }
}
