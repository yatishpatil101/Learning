package com.draazy.api.documents.agreement;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

/**
 * A Leave &amp; License agreement record. Maps {@code rent_agreements} (V6).
 *
 * <p><strong>{@code tenantMobile} is text, not a user id</strong>, and V6 says why: at draft time
 * the tenant may not have a Draazy account at all — the owner types the number they were given.
 * It resolves to a user when the agreement activates.
 *
 * <p>{@code status} and {@code documentUrl} are server/ops-owned. The wizard creates a
 * {@code draft}; everything after that — e-sign, registration, the final registered copy — is the
 * ops workflow's to write, and lands with {@code /service-requests} rather than here.
 */
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

}
