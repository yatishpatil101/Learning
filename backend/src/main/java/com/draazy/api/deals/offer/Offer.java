package com.draazy.api.deals.offer;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A buyer's price offer on a listing — the negotiation row behind the offer lifecycle.
 * Maps {@code offers} (V5).
 *
 * <p><strong>Ids, not associations.</strong> {@code propertyId} and {@code fromUserId} are plain
 * UUID columns rather than {@code @ManyToOne} graphs. The owner inbox reads many rows and an eager
 * association is an N+1 waiting to happen, and — more importantly — this entity lives in the
 * {@code deals} context while the targets live in {@code catalog} and {@code identity}, so an
 * object reference would hard-wire a cross-context join that {@code package-structure.md} §5
 * asks us to keep at the id level.
 *
 * <p><strong>Money is {@code Long}.</strong> The {@code amount} column is {@code bigint} (V5);
 * the contract's {@code Money} type is {@code int64} (whole INR, no paise). Never
 * {@code float}/{@code double}/{@code BigDecimal}.
 */
@Entity
@Table(name = "offers")
@Getter
public class Offer extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** The buyer who submitted the offer. Always taken from the JWT — never from the request body. */
    @Column(name = "from_user_id", nullable = false, updatable = false)
    private UUID fromUserId;

    /** Whole INR — the current (possibly countered) amount. */
    @Column(name = "amount", nullable = false)
    @Setter
    private long amount;

    /** One of {@link OfferStatuses}; the V5 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    @Setter
    private String status = OfferStatuses.PENDING;

    /** Optional free-text note from the buyer, shown to the owner. */
    @Column(name = "message")
    @Setter
    private String message;

    /**
     * The buyer's preferred possession date (V34). Optional — an offer may settle on price alone and
     * leave the date for later. Whole-day granularity, no time zone: a possession date is a calendar
     * day, not an instant. Mirrors {@code tenant_profiles.move_in}.
     */
    @Column(name = "move_in")
    @Setter
    private LocalDate moveIn;

    protected Offer() {
        // JPA
    }

    public Offer(UUID propertyId, UUID fromUserId, long amount, String message, LocalDate moveIn) {
        this.propertyId = propertyId;
        this.fromUserId = fromUserId;
        this.amount = amount;
        this.message = message;
        this.moveIn = moveIn;
    }

}
