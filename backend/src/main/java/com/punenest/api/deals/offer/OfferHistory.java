package com.punenest.api.deals.offer;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

/**
 * One entry in the negotiation trail — an amount event (submit or counter).
 * Maps {@code offer_history} (V5).
 *
 * <p>History rows are append-only: they record an amount and who proposed it. Accept/decline are
 * terminal status changes on the offer itself — not amount events — so they append nothing here
 * (reconciliation item i).
 *
 * <p>Not an {@code AuditedEntity}: {@code offer_history} has no {@code updated_at}. The
 * {@code at} column (named {@code at} in the V5 DDL) serves as the creation timestamp.
 */
@Entity
@Table(name = "offer_history")
@Getter
public class OfferHistory {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "offer_id", nullable = false, updatable = false)
    private UUID offerId;

    /** Whole INR — the proposed amount at this point in the negotiation. */
    @Column(name = "amount", nullable = false, updatable = false)
    private long amount;

    /** {@code buyer} or {@code owner} — direction inferred from the caller (reconciliation item b). */
    @Column(name = "\"by\"", nullable = false, updatable = false)
    private String by;

    @CreationTimestamp
    @Column(name = "\"at\"", nullable = false, updatable = false)
    private Instant at;

    protected OfferHistory() {
        // JPA
    }

    public OfferHistory(UUID offerId, long amount, String by) {
        this.offerId = offerId;
        this.amount = amount;
        this.by = by;
    }

}
