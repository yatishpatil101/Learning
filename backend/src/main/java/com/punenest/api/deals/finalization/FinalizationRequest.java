package com.punenest.api.deals.finalization;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A maker/checker finalization request — the buyer (initiator) proposes to finalize a listing's
 * deal; the counterparty (the listing owner) must sign in and accept (checker step). Maps
 * {@code finalization_requests} (V5).
 *
 * <p><strong>Ids, not associations.</strong> {@code propertyId}, {@code initiatorId}, and
 * {@code counterpartyId} are plain UUID columns rather than {@code @ManyToOne} graphs. The entities
 * they reference live in {@code catalog} and {@code identity}; an object reference would hard-wire
 * a cross-context join that {@code package-structure.md} §5 asks us to keep at the id level.
 *
 * <p><strong>{@code counterpartyId} is NOT NULL</strong> — and that is correct. Unlike
 * {@code deals.counterparty_id} (nullable, because a close may involve an off-platform buyer who
 * has no account), finalization is a two-sided maker/checker flow where the counterparty must sign
 * in and accept. An off-platform mobile that resolves to no registered user is genuinely invalid
 * and should be a 422. This is the deliberate opposite of {@code closeDeal}, where the buyer often
 * has no account at all.
 *
 * <p><strong>Money is {@code Long}.</strong> {@code agreed_price} is {@code bigint} (V5); the
 * contract's {@code Money} type is {@code int64} (whole INR). Never float/double/BigDecimal.
 */
@Entity
@Table(name = "finalization_requests")
@Getter
public class FinalizationRequest extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** The buyer who initiated the finalization request (from the JWT). */
    @Column(name = "initiator_id", nullable = false, updatable = false)
    private UUID initiatorId;

    /** The listing owner who must accept (checker). NOT NULL — see class Javadoc. */
    @Column(name = "counterparty_id", nullable = false, updatable = false)
    private UUID counterpartyId;

    /** Whole INR — the agreed transaction price. */
    @Column(name = "agreed_price", nullable = false)
    private long agreedPrice;

    /** One of {@link FinalizationStatuses}; the V5 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    @Setter
    private String status = FinalizationStatuses.PENDING;

    protected FinalizationRequest() {
        // JPA
    }

    public FinalizationRequest(UUID propertyId, UUID initiatorId, UUID counterpartyId,
                               long agreedPrice) {
        this.propertyId = propertyId;
        this.initiatorId = initiatorId;
        this.counterpartyId = counterpartyId;
        this.agreedPrice = agreedPrice;
    }

}
