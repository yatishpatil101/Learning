package com.draazy.api.admin.staff;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;

/** {@code audit_log} with the actor named; {@code metadata} is absent unless the caller is an admin. */
public record StaffActivityEntry(
        String id,
        String actorName,
        String actorRole,
        String action,
        String entity,
        String entityId,
        Instant at,
        @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> metadata) {
}
