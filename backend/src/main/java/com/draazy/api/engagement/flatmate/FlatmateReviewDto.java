package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.trust.MobileMask;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/** Contract schema {@code FlatmateReview}. Masking lives in the compact constructor so no future
 * route can reach an unmasked canonical constructor. */
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
        String agreementRegNo,
        LocalDate agreementRegisteredOn,
        LocalDate agreementValidTill,
        String status,
        String reason,
        Instant createdAt,
        Instant updatedAt) {

    public FlatmateReviewDto {
        hostMobile = MobileMask.mask(hostMobile);
    }

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
                review.getAgreement().getRegNo(),
                review.getAgreement().getRegisteredOn(),
                review.getAgreement().getValidTill(),
                review.getStatus(),
                review.getReason(),
                review.getCreatedAt(),
                review.getUpdatedAt());
    }
}
