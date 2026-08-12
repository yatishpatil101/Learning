package com.punenest.api.common.audit;

import com.punenest.api.security.AuthPrincipal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * The single write path into the append-only {@code audit_log}. Called from privileged /
 * maker-checker / money mutations. Actor and role are resolved server-side by the caller (from the
 * {@code AuthPrincipal}), never client-supplied.
 *
 * <p>Writes run in {@code REQUIRES_NEW} so an audit entry survives even if the surrounding business
 * transaction later rolls back — an attempted privileged action is itself worth recording.
 */
@Service
public class AuditService {

    /**
     * Serializer for the {@code metadata} document. A hand-rolled JSON string builder was the
     * obvious shortcut and the wrong one: the interesting half of any audit entry is
     * operator-supplied free text, and a quote in a moderator's note must not be able to corrupt
     * the surrounding document — or to forge fields inside it, which is a log-injection attack
     * against the one table that exists to be trusted.
     */
    private static final ObjectMapper METADATA_JSON = JsonMapper.builder().build();

    private final AuditLogRepository repository;

    public AuditService(AuditLogRepository repository) {
        this.repository = repository;
    }

    /** Record a privileged action with no structured context. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String actor, String actorRole, String action, String entity, String entityId) {
        record(actor, actorRole, action, entity, entityId, null, "{}");
    }

    /**
     * Record a privileged action.
     *
     * @param actor     server-resolved actor handle (user id/mobile)
     * @param action    what happened (e.g. {@code property.approve})
     * @param entity    affected entity type
     * @param checker   the second party in a maker-checker flow, else {@code null}
     * @param metadataJson free-form JSON context (before/after diff); {@code "{}"} if none
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String actor, String actorRole, String action, String entity, String entityId,
            String checker, String metadataJson) {
        repository.save(new AuditLog(actor, actorRole, action, entity, entityId, checker, metadataJson));
    }

    /**
     * Convenience overload keyed by the acting user's id.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(UUID actorId, String actorRole, String action, String entity, String entityId) {
        record(actorId.toString(), actorRole, action, entity, entityId, null, "{}");
    }

    /**
     * The overload the back-office uses: actor taken straight from the authenticated principal, and
     * context supplied as key/value pairs rather than as a JSON string.
     *
     * <p>Taking the principal rather than an id and a role removes the one mistake this API makes
     * easy — passing an actor and a role that do not belong to each other, which would leave the
     * log confidently attributing an admin action to a buyer.
     *
     * @param actor    the authenticated caller; {@code actor} and {@code actorRole} are read from it
     * @param action   dotted verb, e.g. {@code report.triage}, {@code user.archive}
     * @param entity   affected entity type
     * @param context  alternating key/value pairs; an odd number is a programming error. Values may
     *                 be {@code null}, which is recorded as JSON null rather than dropped — "the
     *                 reason was blank" and "there is no reason field" are different statements.
     *
     * <p><strong>Serialisation failure is deliberately allowed to propagate</strong>, and it should
     * stay that way. A review suggested catching it and writing {@code "{}"} so the row survives;
     * that trades a loud failure for a quiet one, which is the wrong trade on this table
     * specifically. Every caller passes strings, so a failure here means a programming error, and
     * the honest response to "this action cannot be recorded" is to refuse the action rather than
     * to perform it and file an empty note saying it happened for reasons unknown.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(AuthPrincipal actor, String action, String entity, String entityId,
            Object... context) {
        if (context.length % 2 != 0) {
            throw new IllegalArgumentException(
                    "audit context must be alternating key/value pairs, got " + context.length);
        }
        Map<String, Object> metadata = new LinkedHashMap<>();
        for (int i = 0; i < context.length; i += 2) {
            metadata.put(String.valueOf(context[i]), context[i + 1]);
        }
        record(actor.userId().toString(), actor.role(), action, entity, entityId, null,
                METADATA_JSON.writeValueAsString(metadata));
    }
}

