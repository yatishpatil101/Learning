package com.draazy.api.services.request;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.Getter;

@Entity
@Table(name = "service_request_draft_checks")
@Getter
public class ServiceRequestDraftCheck extends AuditedEntity {

    static final String PENDING = "pending";
    static final String RELEASED = "released";
    static final String SENT_BACK = "sent-back";

    @Column(name = "request_id", nullable = false, updatable = false)
    private UUID requestId;

    @Column(name = "draft_version", nullable = false, updatable = false)
    private int draftVersion;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "reasons", nullable = false)
    private String reasons;

    @Column(name = "note")
    private String note;

    @Column(name = "shared_by", nullable = false, updatable = false)
    private UUID sharedBy;

    @Column(name = "checked_by")
    private UUID checkedBy;

    @Column(name = "checked_at")
    private Instant checkedAt;

    protected ServiceRequestDraftCheck() {

    }

    ServiceRequestDraftCheck(UUID requestId, int draftVersion, List<String> reasons, UUID sharedBy) {
        this.requestId = requestId;
        this.draftVersion = draftVersion;
        this.status = PENDING;
        this.reasons = String.join(",", reasons);
        this.sharedBy = sharedBy;
    }

    void release(UUID checker) {
        decide(RELEASED, checker, null);
    }

    void sendBack(UUID checker, String note) {
        decide(SENT_BACK, checker, note);
    }

    List<String> reasonsList() {
        if (reasons == null || reasons.isBlank()) {
            return List.of();
        }
        return List.of(reasons.split(","));
    }

    private void decide(String status, UUID checker, String note) {
        this.status = status;
        this.checkedBy = checker;
        this.checkedAt = Instant.now();
        this.note = note;
    }
}
