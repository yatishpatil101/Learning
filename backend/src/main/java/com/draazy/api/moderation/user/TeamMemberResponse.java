package com.draazy.api.moderation.user;

import java.time.Instant;
import java.util.List;

/** {@code functions} is empty when the caller could not read that document. */
public record TeamMemberResponse(
        String id,
        String name,
        String mobile,
        String email,
        String role,
        String status,
        boolean archived,
        Instant createdAt,
        List<String> functions) {
}
