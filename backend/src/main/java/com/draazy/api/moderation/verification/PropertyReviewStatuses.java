package com.draazy.api.moderation.verification;

final class PropertyReviewStatuses {
    static final String STORED_PENDING = "pending";
    static final String WIRE_IN_REVIEW = "in_review";
    static final String NEEDS_INFO = "needs_info";
    static final String APPROVED = "approved";
    static final String REJECTED = "rejected";

    private PropertyReviewStatuses() {
    }

    static String wire(PropertyReview review) {
        return switch (review.getStatus()) {
            case NEEDS_INFO, APPROVED, REJECTED -> review.getStatus();
            case "clarification" -> NEEDS_INFO;
            default -> WIRE_IN_REVIEW;
        };
    }

    static String storedFilter(String status) {
        return WIRE_IN_REVIEW.equals(status) ? STORED_PENDING : status;
    }
}
