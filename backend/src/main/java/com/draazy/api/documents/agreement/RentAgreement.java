package com.draazy.api.documents.agreement;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

/** Maps {@code rent_agreements} (V6). {@code tenantMobile} is text, not a user id, because at draft
 * time the tenant may have no Draazy account; {@code status} is ops-owned, written only by {@link #moveTo}. */
@Entity
@Table(name = "rent_agreements")
@Getter
public class RentAgreement extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    @Column(name = "tenant_mobile")
    private String tenantMobile;

    @Column(name = "rent")
    private Long rent;

    @Column(name = "deposit")
    private Long deposit;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "duration_months")
    private Integer durationMonths;

    /** One of {@link RentAgreementStatuses}; the V6 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    private String status = RentAgreementStatuses.DRAFT;

    /** Pre-V39 free-text link. Rows the paid flow creates leave it null and carry {@link #finalDocumentId}. */
    @Column(name = "document_url")
    private String documentUrl;

    @Column(name = "service_request_id", updatable = false)
    private UUID serviceRequestId;

    @Column(name = "final_document_id", updatable = false)
    private UUID finalDocumentId;

    @Column(name = "prepared_by", updatable = false)
    private UUID preparedBy;

    @Column(name = "verified_by")
    private UUID verifiedBy;

    protected RentAgreement() {
        // JPA
    }

    RentAgreement(PreparedAgreement prepared, String tenantMobile) {
        this.propertyId = prepared.propertyId();
        this.ownerId = prepared.ownerId();
        this.tenantMobile = tenantMobile;
        this.rent = prepared.rent();
        this.deposit = prepared.deposit();
        this.startDate = prepared.startDate();
        this.durationMonths = prepared.durationMonths();
        this.serviceRequestId = prepared.serviceRequestId();
        this.finalDocumentId = prepared.finalDocumentId();
        this.preparedBy = prepared.preparedBy();
    }

    /** No plain {@code setStatus}: readers treat the field as evidence, so the only writer is a move
     * the ladder allowed. */
    void moveTo(String next, UUID actor) {
        this.status = next;
        if (RentAgreementStatuses.REGISTERED.equals(next)) {
            this.verifiedBy = actor;
        }
    }
}
