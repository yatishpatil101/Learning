package com.draazy.api.moderation.verification;

import com.draazy.api.common.error.ConflictException;
import java.util.List;

/**
 * What an approval needs beyond a reviewer's intent: every checklist line ticked, enforced here because a
 * confirm dialog cannot stop the route it fronts. Ownership evidence is deliberately not part of it.
 */
final class ApprovalGate {

    private ApprovalGate() {
    }

    static void require(PropertyReview review) {
        List<String> open = review.getChecklist().stream()
                .filter(item -> !item.isPass())
                .map(ReviewChecklistItem::getItem)
                .toList();
        if (!open.isEmpty()) {
            throw new ConflictException("Tick every checklist line before approving. Still open: "
                    + String.join(", ", open));
        }
    }
}
