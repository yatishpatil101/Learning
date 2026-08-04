package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateRequest} — the host-facing inbox record.
 *
 * <p><strong>This payload carries the requester's mobile, and that is the whole point.</strong> The
 * contact model here runs opposite to the rest of the platform: everywhere else a seeker asks and an
 * owner approves before a number moves. There is no listing to request against and the host is a
 * person looking for a flatmate rather than an owner fielding enquiries, so instead the
 * <em>requester</em> volunteers their own number by pressing "I'm interested" on one named post.
 * That press is exactly the affirmative act the contact gate exists to require.
 *
 * <p>Nothing travels the other way: the host's number is not in this payload, and a host who wants
 * to be reachable has to answer.
 */
public record FlatmateRequestDto(
        UUID id,
        String kind,
        String action,
        String share,
        UUID targetId,
        String targetTitle,
        String locality,
        String requesterName,
        String requesterMobile,
        String message,
        String status,
        Instant requestedAt,
        Instant decidedAt) {

    static FlatmateRequestDto of(FlatmateRequest request, String targetTitle, String locality,
            String requesterName, String requesterMobile) {
        return new FlatmateRequestDto(
                request.getId(),
                request.getKind(),
                request.getAction(),
                request.getShare(),
                request.getTargetId(),
                targetTitle,
                locality,
                requesterName,
                requesterMobile,
                request.getMessage(),
                request.getStatus(),
                request.getRequestedAt(),
                request.getDecidedAt());
    }
}
