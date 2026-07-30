package com.punenest.api.common.audit;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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
     * @param actorRole {@code buyer|owner|staff|admin}
     * @param action    what happened (e.g. {@code property.approve})
     * @param entity    affected entity type
     * @param entityId  affected entity id
     * @param checker   the second party in a maker-checker flow, else {@code null}
     * @param metadataJson free-form JSON context (before/after diff); {@code "{}"} if none
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String actor, String actorRole, String action, String entity, String entityId,
            String checker, String metadataJson) {
        repository.save(new AuditLog(actor, actorRole, action, entity, entityId, checker, metadataJson));
    }

    /** Convenience overload keyed by the acting user's id. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(UUID actorId, String actorRole, String action, String entity, String entityId) {
        record(actorId.toString(), actorRole, action, entity, entityId, null, "{}");
    }
}
