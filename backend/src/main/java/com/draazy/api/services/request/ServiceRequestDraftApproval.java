package com.draazy.api.services.request;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

@Entity
@Table(name = "service_request_draft_approvals")
@Getter
public class ServiceRequestDraftApproval extends AuditedEntity {

    @Column(name = "request_id", nullable = false, updatable = false)
    private UUID requestId;

    @Column(name = "draft_version", nullable = false, updatable = false)
    private int draftVersion;

    @Column(name = "party_key", nullable = false, updatable = false)
    private String partyKey;

    @Column(name = "party_label", nullable = false)
    private String partyLabel;

    @Column(name = "user_id", updatable = false)
    private UUID userId;

    @Column(name = "mobile_hash", updatable = false)
    private String mobileHash;

    @Column(name = "mobile_masked")
    private String mobileMasked;

    @Column(name = "method", nullable = false, updatable = false)
    private String method;

    @Column(name = "opened_at")
    private Instant openedAt;

    @Column(name = "approved_at")
    private Instant approvedAt;

    protected ServiceRequestDraftApproval() {

    }

    ServiceRequestDraftApproval(UUID requestId, int draftVersion, String partyKey,
            String partyLabel, UUID userId, String mobileHash, String mobileMasked, String method) {
        this.requestId = requestId;
        this.draftVersion = draftVersion;
        this.partyKey = partyKey;
        this.partyLabel = partyLabel;
        this.userId = userId;
        this.mobileHash = mobileHash;
        this.mobileMasked = mobileMasked;
        this.method = method;
    }

    void opened() {
        this.openedAt = Instant.now();
    }

    void approve() {
        this.approvedAt = Instant.now();
    }
}
