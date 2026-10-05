package com.draazy.api.identity.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

// Wire boundary keeps password_hash and the soft-delete triplet from leaking.
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserResponse(
        String id,
        String name,
        String mobile,
        String email,
        String role,
        String team,
        String status,
        boolean verified,
        String city,
        boolean mobileVerified,
        boolean verifiedContactOnly,
        boolean hideNumber,
        boolean shareActivityStatus,
        boolean shareReadReceipts,
        int listingsCount,
        Instant joinedAt,
        Instant lastActive,
        Instant createdAt,
        List<String> permissions,
        List<String> desks,
        Boolean flagged,
        String flagReason,
        String badgeSource) {
}
