package com.draazy.api.services.request;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * The second person on a service request — the counterparty of a co-filled rent agreement (D121).
 * Maps {@code service_request_parties} (V75, amended by V107).
 *
 * <p><strong>A row here is a person, or a number waiting to become one.</strong> The frontend mock
 * keyed its co-fill on the other party's mobile and handed out a random invite id as a bearer token
 * in a WhatsApp link; anyone holding the link could read the matter. That is gone and stays gone —
 * there is no token here. What V107 restored is the ability to address an invitation to somebody who
 * has not signed up yet: {@link #mobile} holds the number until they register, {@link #claim} swaps
 * it for {@link #userId}, and the database permits exactly one of the two to be set.
 *
 * <p><strong>The number is transient, and that is the whole of the privacy argument.</strong> A
 * claimed row is byte-for-byte the V75 row and holds no personal data. Only the waiting room does,
 * it is reachable by erasure through the old mobile, and it empties itself after
 * {@link #getInviteExpiresAt()} — see V107's header for why a recycled number makes the clock
 * load-bearing rather than tidy.
 *
 * <p><strong>{@code invited} is not {@code accepted}, and only {@code accepted} widens what the
 * request shows.</strong> An invite addressed to a mistyped-but-real mobile reaches a stranger; if
 * the pending state already granted sight of the request, that stranger would be looking at a rent,
 * a deposit and two sets of identity documents before anybody noticed the typo. Pending therefore
 * reveals the invitation and nothing else — see {@code CoFillParties}. A pending row that has not
 * even been claimed reveals less still: it is not addressed to an account at all.
 *
 * <p>Extends {@link AuditedEntity} rather than {@code VersionedEntity}: the mutable fields are
 * {@link #status}, which moves out of {@code invited} exactly once under the unique index on
 * {@code (request_id, role)}, and the claim, which moves out of pending exactly once under the
 * {@code addressee} CHECK. There is no lost-update to lose.
 */
@Entity
@Table(name = "service_request_parties")
@Getter
public class ServiceRequestParty extends AuditedEntity {

    /** The side of the agreement this person is on, from {@link CoFillParties#ROLES}. */
    @Column(name = "request_id", nullable = false, updatable = false)
    private UUID requestId;

    /**
     * The party, once they hold an account — {@code null} while the invitation is still addressed to
     * a {@link #mobile}.
     *
     * <p>Writable, unlike every other identity on this row, because {@link #claim} is the one thing
     * that ever changes it and it can only ever go from absent to present.
     */
    @Column(name = "user_id")
    private UUID userId;

    /**
     * The invited number, held only until it becomes a {@link #userId}.
     *
     * <p>Ten digits, normalised by {@code MobileMask} at the service edge — never whatever the
     * requester typed. Personal data, and the only personal data this table has ever held.
     */
    @Column(name = "mobile")
    private String mobile;

    /**
     * When an unclaimed invitation is deleted; {@code null} once claimed.
     *
     * <p>Set for every pending row and no claimed one, which V107 states as a CHECK rather than
     * leaving to this class: the sweep finds expired rows by this column, so a pending row without
     * one would be a number retained forever.
     */
    @Column(name = "invite_expires_at")
    private Instant inviteExpiresAt;

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

    /** An invitation to somebody who already holds an account. */
    ServiceRequestParty(UUID requestId, UUID userId, String role, UUID invitedBy) {
        this.requestId = requestId;
        this.userId = userId;
        this.role = role;
        this.invitedBy = invitedBy;
    }

    /** An invitation addressed to a number that resolves to nobody yet (V107). */
    ServiceRequestParty(UUID requestId, String mobile, Instant expiresAt, String role, UUID invitedBy) {
        this.requestId = requestId;
        this.mobile = mobile;
        this.inviteExpiresAt = expiresAt;
        this.role = role;
        this.invitedBy = invitedBy;
    }

    /** Is this invitation still waiting for its addressee to register? */
    boolean isPending() {
        return userId == null;
    }

    /**
     * Bind a pending invitation to the account that has proved control of its number.
     *
     * <p>Package-private and one-way, like {@link #answer}. Clearing the mobile is not optional
     * bookkeeping — the {@code addressee} CHECK rejects a row holding both, so this method is the
     * only shape the database will accept and there is no way to claim a row while leaving the
     * number behind.
     *
     * <p>Note what this does <em>not</em> do: it does not accept the invitation. The claimed row is
     * still {@code invited}, and the person now has to answer it as themselves. Registering proves
     * who they are; it does not express consent to be on somebody's rent agreement.
     */
    void claim(UUID claimant) {
        this.userId = claimant;
        this.mobile = null;
        this.inviteExpiresAt = null;
    }

    /**
     * Answer the invitation. Package-private, like {@code ServiceRequest.moveTo}: the status is
     * driven by {@code CoFillParties}, never set from a request body.
     */
    void answer(String outcome) {
        this.status = outcome;
    }
}
