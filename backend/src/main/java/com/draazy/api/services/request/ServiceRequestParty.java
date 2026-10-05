package com.draazy.api.services.request;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

// The number is transient, and that is the whole of the privacy argument.
// A claimed row is byte-for-byte the row and holds no personal data.
@Entity
@Table(name = "service_request_parties")
@Getter
public class ServiceRequestParty extends AuditedEntity {

    @Column(name = "request_id", nullable = false, updatable = false)
    private UUID requestId;

    // user_id appears only after claim; pending invitations are addressed to mobile.
    @Column(name = "user_id")
    private UUID userId;

    // The invited number, held only until it becomes a #userId.
    @Column(name = "mobile")
    private String mobile;

    // Pending rows need an expiry so numbers are not retained forever.
    @Column(name = "invite_expires_at")
    private Instant inviteExpiresAt;

    @Column(name = "role", nullable = false, updatable = false)
    private String role;

    @Column(name = "party_index", nullable = false, updatable = false)
    private int partyIndex;

    @Column(name = "status", nullable = false)
    private String status = CoFillParties.INVITED;

    // Store inviter explicitly; invitation audit should not depend on reconstructing joins.
    @Column(name = "invited_by", nullable = false, updatable = false)
    private UUID invitedBy;

    protected ServiceRequestParty() {

    }

    ServiceRequestParty(UUID requestId, UUID userId, String role, int partyIndex, UUID invitedBy) {
        this.requestId = requestId;
        this.userId = userId;
        this.role = role;
        this.partyIndex = partyIndex;
        this.invitedBy = invitedBy;
    }

    ServiceRequestParty(UUID requestId, String mobile, Instant expiresAt, String role, int partyIndex,
            UUID invitedBy) {
        this.requestId = requestId;
        this.mobile = mobile;
        this.inviteExpiresAt = expiresAt;
        this.role = role;
        this.partyIndex = partyIndex;
        this.invitedBy = invitedBy;
    }

    boolean isPending() {
        return userId == null;
    }

    // Claim is one-way; DB CHECK rejects rows holding both user id and mobile.
    void claim(UUID claimant) {
        this.userId = claimant;
        this.mobile = null;
        this.inviteExpiresAt = null;
    }

    void answer(String outcome) {
        this.status = outcome;
    }
}
