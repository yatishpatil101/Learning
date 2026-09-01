package com.punenest.api.engagement.society;

/**
 * A link an operator can open to read the registration certificate on one claim (contract
 * {@code SocietyClaimCertificate}).
 *
 * <p><strong>Minted per request and short-lived.</strong> {@code url} is not a property of the claim
 * and is never stored on it; it is signed by the document vault at the moment an operator asks, and
 * it expires. The consequence worth stating: this response must not be cached, logged, or put in a
 * list — it is a single handoff to one reviewer's browser.
 *
 * <p>No document id, deliberately. The queue row already carries {@code certificateDocumentId} for
 * the client to decide whether to offer the button; echoing it back beside the URL would only give a
 * caller a second handle on someone's vault, and this response exists to avoid exactly that.
 *
 * @param url       a signed GET, valid for minutes
 * @param fileName  what the claimant called the file, already stripped on upload
 * @param mimeType  the type the bytes proved, so the client can label a PDF as a PDF
 * @param sizeBytes the upload size, so a reviewer on mobile data can decide before tapping
 */
public record SocietyClaimCertificateResponse(
        String url,
        String fileName,
        String mimeType,
        long sizeBytes) {
}
