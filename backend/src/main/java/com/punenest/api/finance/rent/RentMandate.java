package com.punenest.api.finance.rent;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A tenant's standing autopay instruction against one tenancy. Maps {@code rent_mandates} (V6,
 * constrained by V14).
 *
 * <p><strong>At most one active mandate per tenancy</strong>, enforced by V14's partial unique
 * index rather than a service check. Two active mandates are not a duplicate record but two
 * standing instructions against the same rent — the tenant is debited twice every month until
 * somebody notices.
 *
 * <p><strong>{@code dayOfMonth} is capped at 28</strong> by V6's CHECK, and that cap is correct
 * rather than lazy: a mandate set for the 30th simply does not fire in February, so the one month a
 * tenant most needs autopay to work is the month it silently does not.
 *
 * <p>{@code maxAmount} is the ceiling the tenant authorised, not the rent. It exists so a rent
 * increase cannot be collected automatically without the tenant re-consenting.
 */
@Entity
@Table(name = "rent_mandates")
@Getter
public class RentMandate extends AuditedEntity {

    @Column(name = "tenancy_id", nullable = false, updatable = false)
    private UUID tenancyId;

    /** The ceiling the tenant authorised, whole rupees. A charge above it must be re-consented. */
    @Column(name = "max_amount")
    @Setter
    private Long maxAmount;

    @Column(name = "day_of_month")
    @Setter
    private Integer dayOfMonth;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = MandateStatuses.ACTIVE;

    /** The rail holding the mandate, e.g. {@code cashfree}. Server-set, never client-supplied. */
    @Column(name = "provider")
    private String provider;

    protected RentMandate() {
        // JPA
    }

    public RentMandate(UUID tenancyId, Long maxAmount, Integer dayOfMonth, String provider) {
        this.tenancyId = tenancyId;
        this.maxAmount = maxAmount;
        this.dayOfMonth = dayOfMonth;
        this.provider = provider;
        this.status = MandateStatuses.ACTIVE;
    }

    /**
     * The rail this mandate is registered with. Set once at construction and deliberately given no
     * setter: a mandate whose provider changed under it is a standing instruction pointing at a rail
     * that never registered it — live at the bank, invisible to us, and impossible to cancel.
     */
}
