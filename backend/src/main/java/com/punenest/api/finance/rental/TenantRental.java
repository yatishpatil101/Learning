package com.punenest.api.finance.rental;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A tenant's own record of a home they rent. Maps {@code tenant_rentals} (V128).
 *
 * <p><strong>Not a {@code Tenancy}.</strong> {@link com.punenest.api.finance.tenancy.Tenancy} is
 * written in one place — when a rent deal closes on this platform and the tenant already holds an
 * account — and it describes an agreement the platform brokered. This describes an agreement the
 * platform had nothing to do with, which is almost all of them. The two are kept apart because
 * merging them would put unverified figures into the table that answers "who is legally living in
 * this flat", and that table is what a double-let check reads.
 *
 * <p><strong>Nothing here is evidence.</strong> Every column is typed in by the person it flatters
 * and nothing is checked against anything. That is acceptable for the two things it drives — the
 * tenant's own dashboard, and an HRA exemption estimate they already self-report to their employer
 * — and unacceptable for the Rent Passport, which is a credential shown to a prospective landlord.
 * The service exposes no read that a landlord could reach, which is the structural half of that
 * rule; the other half is that no scoring code may import this package.
 *
 * <p><strong>Money is {@code Long}.</strong> Whole rupees, matching {@code transactions.amount} and
 * the contract's {@code Money} ({@code int64}). {@code monthlyRent} is multiplied by a month count
 * to produce a headline figure and compared against an annual salary; a floating-point rupee would
 * make both drift.
 *
 * <p><strong>{@code deposit} is nullable and stays that way.</strong> Zero and "I do not remember"
 * are different answers, and the deposit panel renders them differently. A {@code DEFAULT 0} would
 * collapse the second into the first and quietly assert a fact the tenant never gave.
 *
 * <p><strong>Soft-delete</strong> via {@link SoftDeleteEntity}, and it is distinct from
 * {@link RentalStatuses#ENDED}: ended means the tenant moved out and last year's rent still counts
 * toward last year's HRA claim, archived means the row should never have existed.
 */
@Entity
@Table(name = "tenant_rentals")
@Getter
public class TenantRental extends SoftDeleteEntity {

    /**
     * The tenant, and the only scope this table has. Not updatable: a rental changing hands is a
     * different rental, and allowing the column to move would make one tenant's edit capable of
     * pushing a row into another tenant's dashboard.
     */
    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    /** Where they live, as they describe it. Personal data — see {@code ErasureRetention}. */
    @Setter
    @Column(name = "address", nullable = false)
    private String address;

    /** The landlord's name, if given. Personal data, and someone else's. */
    @Setter
    @Column(name = "landlord_name")
    private String landlordName;

    /** Monthly rent, whole INR. */
    @Setter
    @Column(name = "monthly_rent", nullable = false)
    private Long monthlyRent;

    /** Security deposit, whole INR, or null when unknown. */
    @Setter
    @Column(name = "deposit")
    private Long deposit;

    /**
     * When the lease began. Required: it is the only thing that makes "rent paid so far"
     * computable, and a rent figure with no start date has nothing to multiply it by.
     */
    @Setter
    @Column(name = "lease_start", nullable = false)
    private LocalDate leaseStart;

    /**
     * When it ends, or null while open. Null for the same reason {@code Tenancy} leaves it null:
     * assuming eleven months would show the tenant a date neither party agreed to.
     */
    @Setter
    @Column(name = "lease_end")
    private LocalDate leaseEnd;

    /** One of {@link RentalStatuses}. */
    @Setter
    @Column(name = "status", nullable = false)
    private String status = RentalStatuses.ACTIVE;

    protected TenantRental() {
    }

    public TenantRental(UUID tenantId) {
        this.tenantId = tenantId;
    }
}
