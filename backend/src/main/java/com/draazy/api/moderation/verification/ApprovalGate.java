package com.draazy.api.moderation.verification;

import com.draazy.api.common.error.ConflictException;
import java.util.List;

public final class ApprovalGate {

    private ApprovalGate() {
    }

    public static void require(PropertyReview review) {
        List<String> open = review.getChecklist().stream()
                .filter(item -> !item.isPass())
                .map(ReviewChecklistItem::getItem)
                .toList();
        if (!open.isEmpty()) {
            throw new ConflictException("checklist_incomplete",
                    "Open the review and tick every check first");
        }
    }
}
