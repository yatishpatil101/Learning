package com.punenest.api.identity.user.erasure;

import java.time.Instant;

/**
 * An erasure request on the wire.
 *
 * <p><strong>{@code subjectId} is deliberately absent.</strong> The subject reads their own request
 * — they know who they are — and an admin working the queue does not need the id to decide it: the
 * decision turns on whether a live obligation exists, which the request itself does not answer
 * either way. Putting the id on the wire would make the admin queue a list of everybody who has
 * asked to be forgotten, which is the shape this feature exists to avoid.
 *
 * @param subjectDigest the surviving one-way reference. Published so that a subject holding their
 *     own id can verify a completed request was theirs, which is the only question the digest was
 *     designed to answer.
 * @param erased        what was removed — table names and row counts, never values. {@code null}
 *     until the request completes.
 * @param retained      what was kept and why, plus the categories this pass is known not to reach.
 *     {@code null} until the request completes.
 */
public record ErasureRequestResponse(
        String id,
        String subjectDigest,
        String status,
        String reason,
        Instant requestedAt,
        Instant decidedAt,
        String decisionNote,
        String erased,
        String retained) {

    /** {@code {}} is the column default and means "nothing recorded yet"; the wire says so with null. */
    private static final String EMPTY_DOCUMENT = "{}";

    public static ErasureRequestResponse of(ErasureRequest request) {
        return new ErasureRequestResponse(
                request.getId().toString(),
                request.getSubjectDigest(),
                request.getStatus(),
                request.getReason(),
                request.getRequestedAt(),
                request.getDecidedAt(),
                request.getDecisionNote(),
                blankDocumentToNull(request.getErased()),
                blankDocumentToNull(request.getRetained()));
    }

    private static String blankDocumentToNull(String document) {
        return (document == null || EMPTY_DOCUMENT.equals(document)) ? null : document;
    }
}
