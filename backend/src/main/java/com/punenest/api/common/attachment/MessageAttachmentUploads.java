package com.punenest.api.common.attachment;

import com.punenest.api.common.error.PayloadTooLargeException;
import com.punenest.api.common.error.UnsupportedMediaTypeException;
import com.punenest.api.common.validation.MediaSignatures;
import java.util.Set;

/**
 * What may be attached to a message, and how big (D49).
 *
 * <p><strong>Why its own ceilings rather than the vault's.</strong> The document vault takes 10 MB
 * because it takes agreements and scans, which are genuinely that size and are uploaded once by an
 * owner onto their own listing. A chat attachment is a photo of a leaking tap sent to a stranger
 * mid-negotiation, and both surfaces that accept one are reachable by any authenticated user with a
 * thread. The write is therefore cheaper to abuse and the legitimate payload is smaller, so the cap
 * is smaller too.
 *
 * <p><strong>Why the count caps matter more than the size cap.</strong> A single 5 MB upload is a
 * bounded cost. An unbounded {@code attachments} array on a JSON write endpoint is not: it is a
 * request that does arbitrarily many database writes, and it costs the caller one request. Both
 * caps below exist for that, and both are enforced server-side regardless of what the contract's
 * {@code maxItems} says, because {@code maxItems} is a document and this is a check.
 *
 * <p>The signature table itself lives in {@link MediaSignatures}, shared with the vault, so the day
 * a signature is corrected both upload surfaces get the correction.
 */
public final class MessageAttachmentUploads {

    private MessageAttachmentUploads() {
    }

    /** Per file. A photo from a phone camera fits; a scanned lease does not, and belongs in the vault. */
    public static final long MAX_BYTES = 5L * 1024 * 1024;

    /**
     * Per message. Five is what a "here is the damage" message legitimately needs; it is also the
     * bound on how many rows one reply can write.
     */
    public static final int MAX_PER_MESSAGE = 5;

    /**
     * Per thread, per uploader, unbound. The one accumulating state in the design is an upload that
     * never gets claimed by a reply, so it gets its own ceiling — otherwise a caller who uploads and
     * never replies has an unbounded write loop that the per-message cap never sees.
     */
    public static final int MAX_PENDING_PER_THREAD = 10;

    /**
     * Images and PDFs only. Deliberately the vault's list minus nothing and plus nothing: the
     * question "what can a person usefully send another person about a flat" has the same answer in
     * both places, and adding a type here that the vault rejects would mean two answers to it.
     */
    private static final Set<String> ALLOWED = Set.of(
            MediaSignatures.PDF, MediaSignatures.JPEG, MediaSignatures.PNG,
            MediaSignatures.HEIC, MediaSignatures.WEBP);

    /**
     * Reject anything that is not a small image or PDF, and return the type the bytes actually are.
     *
     * <p>Checks run declared-type, then size, then signature, for the reasons {@code DocumentUploads}
     * gives: the cheapest and most common rejection first, and the byte scan only on a file already
     * known to be small enough to hold in memory.
     *
     * @return the media type proved by the file's own signature — this, not the declared one, is
     *         what gets stored and what comes back out on the read
     */
    public static String validate(String contentType, long sizeBytes, byte[] content) {
        String declared = MediaSignatures.normalise(contentType);
        if (!ALLOWED.contains(declared)) {
            throw new UnsupportedMediaTypeException(
                    "Attach an image (JPEG, PNG, HEIC or WebP) or a PDF");
        }
        if (sizeBytes > MAX_BYTES) {
            throw new PayloadTooLargeException("That attachment is too large (max 5 MB)");
        }
        String actual = MediaSignatures.sniff(content);
        if (actual == null) {
            throw new UnsupportedMediaTypeException(
                    "That file is not an image or a PDF. Attach the original photo or document.");
        }
        if (!actual.equals(declared)) {
            throw new UnsupportedMediaTypeException(
                    "That file is a " + actual + ", not the " + declared + " it claims to be.");
        }
        return actual;
    }

    /** A client filename reduced to something safe to store and echo back into a thread. */
    public static String safeFileName(String raw) {
        return MediaSignatures.safeFileName(raw, "attachment");
    }
}
