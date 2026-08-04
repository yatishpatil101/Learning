package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateReview} — one item in the Ops host-verification queue.
 *
 * <p>{@link #hostMobile()} is present and unmasked, which is the exception rather than the rule on
 * this platform. Ops cannot verify a rent agreement without being able to ring the person who
 * uploaded it, and this payload is only ever served to staff on an admin route.
 */
public record FlatmateReviewDto(
        UUID id,
        String kind,
        UUID roomId,
        UUID groupId,
        String host,
        String hostMobile,
        String address,
        String tier,
        boolean flagForReview,
        boolean ownerConsent,
        Map<String, Object> agreementDoc,
        String status,
        String reason,
        Instant createdAt,
        Instant updatedAt) {

    static FlatmateReviewDto of(FlatmateReview review, String hostName, String hostMobile) {
        return new FlatmateReviewDto(
                review.getId(),
                review.getKind(),
                review.getRoomId(),
                review.getGroupId(),
                hostName,
                hostMobile,
                review.getAddress(),
                review.getTier(),
                review.isFlagForReview(),
                review.isOwnerConsent(),
                review.getAgreementDoc(),
                review.getStatus(),
                review.getReason(),
                review.getCreatedAt(),
                review.getUpdatedAt());
    }
}
