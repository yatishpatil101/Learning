package com.draazy.api.common.trust;

/**
 * One personal-vault document as a context outside the vault is allowed to see it: something a
 * reviewer can open, and just enough description to label the link.
 *
 * <p><strong>The URL, not the storage key.</strong> {@link PersonalDocumentLookup} argues at length
 * that handing back the row would put a {@code storageKey} — a capability, not a description — into
 * a context with no business minting URLs for somebody's KYC papers. That argument survives here:
 * the vault mints the URL itself and this record carries the result, so the signing stays in the one
 * package that owns the object store and the caller receives a link that is already expiring rather
 * than a key it could sign again tomorrow.
 *
 * @param url       a short-lived signed GET, minted per read and never stored
 * @param fileName  the claimant's own filename, already stripped by {@code DocumentUploads}
 * @param mimeType  the type the file's leading bytes proved on upload, not the one it claimed
 * @param sizeBytes what the uploader sent, for a reviewer deciding whether to open it on mobile
 */
public record PersonalDocumentView(String url, String fileName, String mimeType, long sizeBytes) {
}
