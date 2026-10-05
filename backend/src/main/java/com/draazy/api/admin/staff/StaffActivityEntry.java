package com.draazy.api.admin.staff;

import java.time.Instant;
import java.util.Map;

/** A projection of {@code audit_log} with the actor resolved to a name; {@code metadata} is empty unless the caller is an admin. */
public record StaffActivityEntry(
        String id,
        String actor,
        String actorName,
        String actorRole,
        String actorTeam,
        String action,
        String entity,
        String entityId,
        Instant at,
        Map<String, Object> metadata) {

    StaffActivityEntry withoutMetadata() {
        return new StaffActivityEntry(id, actor, actorName, actorRole, actorTeam, action, entity, entityId, at,
                Map.of());
    }
}
