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

    @Column(name = "document_url")
    private String documentUrl;

    protected RentAgreement() {
        // JPA
    }

    public RentAgreement(UUID propertyId, UUID ownerId, String tenantMobile, Long rent,
            Long deposit, LocalDate startDate, Integer durationMonths) {
        this.propertyId = propertyId;
        this.ownerId = ownerId;
        this.tenantMobile = tenantMobile;
        this.rent = rent;
        this.deposit = deposit;
        this.startDate = startDate;
        this.durationMonths = durationMonths;
    }

    /** No plain {@code setStatus}: readers treat the field as evidence, so the only writer is a move
     * the ladder allowed. A null {@code documentUrl} leaves the stored copy alone rather than erasing it. */
    void moveTo(String next, String documentUrl) {
        this.status = next;
        if (documentUrl != null && !documentUrl.isBlank()) {
            this.documentUrl = documentUrl;
        }
    }
}
