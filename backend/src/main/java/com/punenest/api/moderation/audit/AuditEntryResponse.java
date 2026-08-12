package com.punenest.api.moderation.audit;

import com.punenest.api.common.audit.AuditLog;
import java.time.Instant;
import java.util.Map;

/**
 * Wire projection of an {@link AuditLog} row (contract {@code AuditEntry}).
 *
 * <p>{@code metadata} is exposed as a parsed object rather than the raw jsonb string the entity
 * stores, because the contract declares {@code type: object} — handing back a JSON-encoded string
 * would force the admin UI to double-parse and would break any generated client.
 *
 * @param actor     server-resolved actor (user id)
 * @param actorRole {@code buyer|owner|staff|admin} at the time of the action
 * @param action    dotted verb, e.g. {@code property.approve}
 * @param entity    affected entity type
 * @param checker   second party in a maker-checker flow, else null
 * @param at        when it happened
 * @param metadata  free-form context recorded by the acting service
 */
public record AuditEntryResponse(
        String id,
        String actor,
        String actorRole,
        String action,
        String entity,
        String entityId,
        String checker,
        Instant at,
        Map<String, Object> metadata) {
}
