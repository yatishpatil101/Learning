package com.draazy.api.moderation.user;

import java.util.Set;

final class BadgeGrantStatuses {

    static final String PENDING = "pending";
    static final String APPROVED = "approved";
    static final String REJECTED = "rejected";
    static final Set<String> ALL = Set.of(PENDING, APPROVED, REJECTED);

    private BadgeGrantStatuses() {
    }
}
