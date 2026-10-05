package com.draazy.api.services.request;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

// The desk's verdict on one filed document.
// A re-upload is a new document, so it starts unreviewed.
@Entity
@Table(name = "service_request_document_reviews")
@Getter
public class ServiceRequestDocumentReview extends BaseEntity {

    static final String VERIFIED = "verified";
    static final String REJECTED = "rejected";

    @Column(name = "service_request_id", nullable = false, updatable = false)
    private UUID serviceRequestId;

    @Column(name = "document_id", nullable = false, updatable = false)
    private UUID documentId;

    @Column(name = "verdict", nullable = false, length = 10)
    private String verdict;

    @Column(name = "reason", length = 300)
    private String reason;

    @Column(name = "reviewed_by")
    private UUID reviewedBy;

    @Column(name = "reviewed_at", nullable = false)
    private Instant reviewedAt;

    protected ServiceRequestDocumentReview() {
    }

    ServiceRequestDocumentReview(UUID serviceRequestId, UUID documentId) {
        this.serviceRequestId = serviceRequestId;
        this.documentId = documentId;
    }

    void decide(String verdict, String reason, UUID reviewedBy, Instant at) {
        this.verdict = verdict;
        this.reason = reason;
        this.reviewedBy = reviewedBy;
        this.reviewedAt = at;
    }

    boolean verified() {
        return VERIFIED.equals(verdict);
    }
}
