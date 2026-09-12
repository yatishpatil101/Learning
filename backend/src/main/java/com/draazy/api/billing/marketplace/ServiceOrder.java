package com.draazy.api.billing.marketplace;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;

/**
 * One customer's order against a {@link ServiceOffering}. Maps {@code service_orders} (V8, extended
 * by V23).
 *
 * <p><strong>No payment columns, deliberately.</strong> {@code createServiceOrder} declares neither
 * a {@code 402} nor a payment callback, and the offering carries a <em>starting</em> price, so the
 * money is agreed after a survey. Attaching a gateway order here would be inventing a flow the
 * contract does not describe — and charging a customer a "from" price is the wrong thing to do
 * regardless.
 *
 * <p>{@code amount} is therefore null on creation and filled in by ops once the job is quoted —
 * through {@link #quote(long)} and the {@code quoted} transition alone (D58).
 */
@Entity
@Table(name = "service_orders")
@Getter
public class ServiceOrder extends AuditedEntity {

    @Column(name = "offering_id", nullable = false, updatable = false)
    private UUID offeringId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "property_id", updatable = false)
    private UUID propertyId;

    @Column(name = "status", nullable = false)
    private String status;

    /** Whole rupees. Null until ops quotes the job — see the class Javadoc. */
    @Column(name = "amount")
    private Long amount;

    @Column(name = "scheduled_for")
    private Instant scheduledFor;

    @Column(name = "notes", updatable = false)
    private String notes;

    /** The client's {@code Idempotency-Key}, unique per user (V23). */
    /**
     * Dedupe key, not a property of an order. Repository-matched only.
     */
    @Column(name = "idempotency_key", updatable = false)
    @Getter(AccessLevel.NONE)
    private String idempotencyKey;

    protected ServiceOrder() {
        // JPA
    }

    ServiceOrder(UUID offeringId, UUID userId, UUID propertyId, Instant preferredSlot, String notes,
            String idempotencyKey) {
        this.offeringId = offeringId;
        this.userId = userId;
        this.propertyId = propertyId;
        this.status = ServiceOrderStatuses.PLACED;
        this.scheduledFor = preferredSlot;
        this.notes = notes;
        this.idempotencyKey = idempotencyKey;
    }

    /**
     * Attach the surveyed price and move to {@code quoted} (D58).
     *
     * <p><strong>The only writer of {@code amount} in the codebase</strong>, and it cannot be
     * called without also setting the status — which is what makes "the price is set when the job
     * is quoted, and never again" a property of the class rather than a rule the service is trusted
     * to remember. {@link #moveTo} deliberately takes no amount for the same reason.
     */
    void quote(long quotedAmount) {
        this.status = ServiceOrderStatuses.QUOTED;
        this.amount = quotedAmount;
    }

    /**
     * Move to {@code status}, leaving the money alone (D58).
     *
     * <p>Package-private and unvalidated: legality is {@link ServiceOrderStatuses}'s job and the
     * service checks it before calling. The entity's contribution is narrower and structural —
     * there is no setter that can change a status and a price in one step.
     */
    void moveTo(String next) {
        this.status = next;
    }
}
