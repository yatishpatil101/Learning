package com.draazy.api.finance.rental;

import com.draazy.api.common.persistence.SoftDeleteEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "tenant_rentals")
@Getter
public class TenantRental extends SoftDeleteEntity {

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    /** Security deposit, whole INR, or null when unknown. */
    @Setter
    @Column(name = "address", nullable = false)
    private String address;

    @Setter
    @Column(name = "monthly_rent", nullable = false)
    private Long monthlyRent;

    @Setter
    @Column(name = "deposit")
    private Long deposit;

    @Setter
    @Column(name = "lease_start", nullable = false)
    private LocalDate leaseStart;

    @Setter
    @Column(name = "lease_end")
    private LocalDate leaseEnd;

    @Setter
    @Column(name = "status", nullable = false)
    private String status = RentalStatuses.ACTIVE;

    protected TenantRental() {
    }

    public TenantRental(UUID tenantId) {
        this.tenantId = tenantId;
    }
    }
