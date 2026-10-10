package com.draazy.api.moderation.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/** One row of the admin people directory; {@code mobile} is masked, the audited single-user read reveals it. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminUserRow(
        String id,
        String name,
        String mobile,
        String role,
        String status,
        boolean verified,
        String city,
        int listingsCount,
        Instant joinedAt,
        Boolean flagged,
        String flagReason,
        String badgeSource,
        boolean badgePending) {
}
