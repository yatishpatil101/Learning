package com.punenest.api.services.request;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * The second person on a service request — the counterparty of a co-filled rent agreement (D121).
 * Maps {@code service_request_parties} (V75).
 *
 * <p><strong>A row here is a person, not a phone number.</strong> The frontend mock keyed its
 * co-fill on the other party's mobile and handed out a random invite id as a bearer token in a
 * WhatsApp link; anyone holding the link could read the matter. This table stores {@link #userId},
 * resolved from the mobile against {@code users} at the moment the invite is written, and the
 * number is never persisted. The consequence is that only a registered account can be invited —
 * which is the point, because it is the account, not the message, that proves who turned up.
 *
 * <p><strong>{@code invited} is not {@code accepted}, and only {@code accepted} widens what the
 * request shows.</strong> An invite addressed to a mistyped-but-real mobile reaches a stranger; if
 * the pending state already granted sight of the request, that stranger would be looking at a rent,
 * a deposit and two sets of identity documents before anybody noticed the typo. Pending therefore
 * reveals the invitation and nothing else — see {@code CoFillParties}.
 *
 * <p>Extends {@link AuditedEntity} rather than {@code VersionedEntity}: the only mutable field is
 * {@link #status}, and it moves out of {@code invited} exactly once, under the unique index on
 * {@code (request_id, role)}. There is no lost-update to lose.
 */
@Entity
@Table(name = "service_request_parties")
@Getter
public class ServiceRequestParty extends AuditedEntity {

    /** The side of the agreement this person is on, from {@link CoFillParties#ROLES}. */
    @Column(name = "request_id", nullable = false, updatable = false)
    private UUID requestId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "role", nullable = false, updatable = false)
    private String role;

    @Column(name = "status", nullable = false)
    private String status = CoFillParties.INVITED;

    /**
     * Who sent it — the requester, always, today.
     *
     * <p>Stored anyway rather than derived from {@code service_requests.requester_id}, because the
     * invitation is a thing one person did to another and an audit trail that has to be reconstructed
     * by join is one that stops being true the day a second party is allowed to invite a third.
     */
    @Column(name = "invited_by", nullable = false, updatable = false)
    private UUID invitedBy;

    protected ServiceRequestParty() {
        // JPA
    }

    ServiceRequestParty(UUID requestId, UUID userId, String role, UUID invitedBy) {
        this.requestId = requestId;
        this.userId = userId;
        this.role = role;
        this.invitedBy = invitedBy;
    }

    /**
     * Answer the invitation. Package-private, like {@code ServiceRequest.moveTo}: the status is
     * driven by {@code CoFillParties}, never set from a request body.
     */
    void answer(String outcome) {
        this.status = outcome;
    }
}
