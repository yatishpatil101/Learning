package com.draazy.api.identity.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * Public projection of a {@link User} (contract {@code User} schema) — entity↔wire boundary that
 * keeps {@code password_hash} and the soft-delete triplet from ever leaking. Populated by {@code UserMapper}.
 */
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
        int listingsCount,
        Instant joinedAt,
        Instant lastActive,
        Instant createdAt,
        List<String> permissions,
        Boolean flagged,
        String flagReason) {
}
