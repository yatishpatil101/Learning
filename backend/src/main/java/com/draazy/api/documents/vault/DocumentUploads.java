package com.draazy.api.documents.vault;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.validation.MediaSignatures;
import java.util.Set;

/**
 * What the vault will accept: the media-type allowlist, the size ceiling, and the magic-byte check
 * that decides which of the two claims about a file — the client's or the bytes' — is believed.
 *
 * <p><strong>Allowlist, never a blocklist.</strong> A vault that stores whatever it is handed and
 * serves it back from a Draazy-looking URL is a free hosting service for phishing pages and
 * malware. The set below is what a property document actually is — a scan or a PDF — and anything
 * outside it is refused rather than sanitised.
 *
 * <p><strong>The declared type is a claim; the leading bytes are evidence.</strong> Every upload is
 * checked twice. The declared {@code Content-Type} must be on the allowlist, and the file's own
 * signature must independently resolve to a type on that same allowlist. The two must agree. A
 * {@code text/html} payload sent as {@code application/pdf} passes the first check and fails the
 * second, which is the whole point: before this, the allowlist was enforced entirely against a
 * string the uploader chose.
 *
 * <p><strong>The sniffed type, not the declared one, is what gets persisted and stored.</strong>
 * {@link #validate} returns the type it proved, and the caller writes that to both the object store
 * and the {@code documents} row. The client's string is used to reject and then discarded, so it can
 * never come back out of the vault as a response {@code Content-Type} — which is the header that
 * decides whether a browser renders a file or downloads it.
 *
 * <p><strong>What this deliberately does not do.</strong> It does not parse the file. A real PDF
 * parser or image decoder would be a far larger attack surface than the one it closes, and the
 * threat here is not a malformed-but-genuine PDF — it is a file that is not a PDF at all. Five
 * signatures, read from the first twelve bytes, answer that question completely. Nor does it look at
 * the extension: the filename decides nothing and the storage key is server-minted.
 */
public final class DocumentUploads {

    private DocumentUploads() {
    }

    /** 10 MB. A scanned sale deed is ~2–4 MB; ten is generous without inviting video. */
    public static final long MAX_BYTES = 10L * 1024 * 1024;

    static final String PDF = MediaSignatures.PDF;
    static final String JPEG = MediaSignatures.JPEG;
    static final String PNG = MediaSignatures.PNG;
    static final String HEIC = MediaSignatures.HEIC;
    static final String WEBP = MediaSignatures.WEBP;

    private static final Set<String> ALLOWED = Set.of(PDF, JPEG, PNG, HEIC, WEBP);

    /**
     * Prove an upload is one of the five accepted document types and return that type.
     *
     * <p>The order of the three checks is deliberate. The declared type is rejected first because it
     * is the cheapest answer and the most common mistake. Size comes next, so an oversized file is
     * reported as oversized rather than as whatever its first twelve bytes happen to look like.
     * Sniffing runs last, on a file already known to be small enough to hold in memory.
     *
     * @param contentType the client's declared type; used to reject, never to store
     * @param sizeBytes   the declared size
     * @param content     the file's bytes, needed for the signature check
     * @return the media type proved by the file's own signature — this is what the caller stores
     * @throws UnsupportedMediaTypeException when the declared type is not a document or a scan, when
     *                                       the bytes match no accepted signature, or when the two
     *                                       disagree
     * @throws PayloadTooLargeException      when the file exceeds {@link #MAX_BYTES}
     */
    public static String validate(String contentType, long sizeBytes, byte[] content) {
        String declared = normalise(contentType);
        if (!ALLOWED.contains(declared)) {
            throw new UnsupportedMediaTypeException(
                    "Upload a PDF or an image (JPEG, PNG, HEIC or WebP)");
        }
        if (sizeBytes > MAX_BYTES) {
            throw new PayloadTooLargeException("That file is too large to upload (max 10 MB)");
        }

        String actual = sniff(content);
        if (actual == null) {
            throw new UnsupportedMediaTypeException(
                    "That file is not a PDF or an image. Upload the original scan or photo.");
        }
        if (!actual.equals(declared)) {
            // Naming both types is safe: the uploader supplied the file and already knows what it
            // is. Saying only "rejected" would make an honest mis-declaration — a .jpg saved as PNG
            // by an editor, which browsers do label wrongly — undiagnosable.
            throw new UnsupportedMediaTypeException(
                    "That file is a " + actual + ", not the " + declared + " it claims to be.");
        }
        return actual;
    }

    /**
     * The media type the leading bytes actually describe, or {@code null} for anything unrecognised.
     *
     * <p>The table itself moved to {@link MediaSignatures} when message attachments (D49) needed the
     * identical check from a package the layering forbids importing this one. This stays as the
     * vault's own name for it — the tests that pin the five signatures were written against it, and
     * the indirection costs nothing.
     */
    static String sniff(byte[] b) {
        return MediaSignatures.sniff(b);
    }

    private static String normalise(String contentType) {
        return MediaSignatures.normalise(contentType);
    }

    /**
     * Strip a client filename down to something safe to store and show. The result is never used
     * as a path — the storage key is a server-minted UUID — so this is about not echoing
     * {@code <script>} or a traversal string back into the owner's dashboard, not about path safety.
     */
    public static String safeFileName(String raw) {
        return MediaSignatures.safeFileName(raw, "document");
    }
}
