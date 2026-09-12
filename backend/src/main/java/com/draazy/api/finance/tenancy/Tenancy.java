package com.draazy.api.finance.tenancy;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A rental agreement between an owner and a tenant over one property — the parent of every rent
 * payment and mandate. Maps {@code tenancies} (V6, constrained by V12).
 *
 * <p><strong>Created by the system, never by a client.</strong> {@code POST /tenancies} was deleted
 * from the contract (spec fix S9): it carried no role guard and accepted the whole shape, so any
 * signed-in user could fabricate a money-bearing relationship on any property, naming themselves
 * owner or tenant. The only way a tenancy comes into existence is inside {@code DealService.close}
 * on a rent deal, in the same transaction that closes the deal — which is the moment the agreement
 * actually exists in the real world.
 *
 * <p><strong>At most one active tenancy per property</strong>, enforced by {@code V10__DDL_tenancy_finance.sql}'s
 * partial unique index rather than a service check. Two active rows would not be a duplicate record but a
 * double-let: two tenants each believing they hold the flat, and rent payments that cannot be
 * attributed to either.
 *
 * <p><strong>Ids, not associations.</strong> {@code propertyId}, {@code tenantId} and
 * {@code ownerId} are plain UUID columns — this entity lives in {@code finance} while its targets
 * live in {@code catalog} and {@code identity}.
 *
 * <p>Money is {@code Long} whole rupees ({@code bigint} in V6), matching the contract's
 * {@code Money}.
 */
@Entity
@Table(name = "tenancies")
@Getter
public class Tenancy extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    /** Monthly rent, whole INR — the agreed price from the closed deal. */
    @Column(name = "rent")
    @Setter
    private Long rent;

    /** Security deposit, whole INR. */
    @Column(name = "deposit")
    @Setter
    private Long deposit;

    @Column(name = "start_date")
    @Setter
    private LocalDate startDate;

    /**
     * When the agreement is due to end, or when it actually ended once terminal. Nullable: a
     * tenancy created on deal close has a start but not yet an agreed end.
     */
    @Column(name = "end_date")
    @Setter
    private LocalDate endDate;

    /** One of {@link TenancyStatuses}; the V6 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    @Setter
    private String status = TenancyStatuses.ACTIVE;

    protected Tenancy() {
        // JPA
    }

    public Tenancy(UUID propertyId, UUID tenantId, UUID ownerId) {
        this.propertyId = propertyId;
        this.tenantId = tenantId;
        this.ownerId = ownerId;
    }

}
