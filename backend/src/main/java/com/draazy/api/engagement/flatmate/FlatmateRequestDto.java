package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.trust.MobileMask;
import java.time.Instant;
import java.util.UUID;

/** The requester volunteers their number, but it stays masked ({@link #forHost()}) until the host accepts. */
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

    FlatmateRequestDto forHost() {
        if (FlatmateVocabulary.STATUS_ACCEPTED.equals(status)) {
            return this;
        }
        return new FlatmateRequestDto(id, kind, action, share, targetId, targetTitle, locality,
                requesterName, MobileMask.mask(requesterMobile), message, status, requestedAt, decidedAt);
    }

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
