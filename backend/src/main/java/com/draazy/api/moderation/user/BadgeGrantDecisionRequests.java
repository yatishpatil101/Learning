package com.draazy.api.moderation.user;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class BadgeGrantDecisionRequests {

    private BadgeGrantDecisionRequests() {
    }

    public record Approve(@Size(max = 300) String note) {
    }

    public record Reject(@NotBlank @Size(min = 10, max = 300) String reason) {
    }
}
