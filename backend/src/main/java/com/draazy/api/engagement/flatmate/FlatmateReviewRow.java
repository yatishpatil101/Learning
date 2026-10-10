package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.UUID;

/** What a card on the verification desk shows. The agreement file and the host's number are the
 * popup's: a list of them would carry up to 3 MB of base64 per row for cards that never render it. */
public record FlatmateReviewRow(
        UUID id,
        String kind,
        UUID roomId,
        UUID groupId,
        String host,
        String address,
        String tier,
        boolean flagForReview,
        boolean ownerConsent,
        Instant createdAt) {

    static FlatmateReviewRow of(FlatmateReviewRepository.QueueRow r, String hostName) {
        return new FlatmateReviewRow(r.getId(), r.getKind(), r.getRoomId(), r.getGroupId(), hostName,
                r.getAddress(), r.getTier(), r.getFlagForReview(), r.getOwnerConsent(), r.getCreatedAt());
    }
}