package com.punenest.api.billing.boost;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;

/**
 * A purchased promotion window on one listing. Maps {@code boosts} (V8, extended by V23).
 *
 * <p><strong>The window opens when the money arrives, not when checkout opens</strong> (spec fix
 * S51). {@code startsAt} and {@code endsAt} stay null through {@link BoostStatuses#PENDING} and are
 * stamped by the payment webhook, so a buyer who completes payment an hour later still gets the
 * whole pack rather than an hour less of it.
 *
 * <p>There is no buyer column: the endpoint is {@code /me/properties/{propId}/boost} and the buyer
 * is always the listing's owner, checked before this row is created.
 */
@Entity
@Table(name = "boosts")
@Getter
public class Boost extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    @Column(name = "pack_id", nullable = false, updatable = false)
    private UUID packId;

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @Column(name = "status", nullable = false)
    private String status;

    /** The gateway order id; null on a free pack. Unique in the DB (V23) — the webhook's key. */
    @Column(name = "payment_ref", updatable = false)
    private String paymentRef;

    /** The client's {@code Idempotency-Key}, unique per property (V23). */
    /**
     * Dedupe key, not a property of a boost. It is matched in a repository lookup and must never
     * reach a response body.
     */
    @Column(name = "idempotency_key", updatable = false)
    @Getter(AccessLevel.NONE)
    private String idempotencyKey;

    protected Boost() {
        // JPA
    }

    Boost(UUID propertyId, UUID packId, String status, Instant startsAt, Instant endsAt,
            String paymentRef, String idempotencyKey) {
        this.propertyId = propertyId;
        this.packId = packId;
        this.status = status;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.paymentRef = paymentRef;
        this.idempotencyKey = idempotencyKey;
    }

    /**
     * Open the promotion window. Returns {@code false} on a boost that is not pending, because the
     * caller is a payment webhook a provider may redeliver — see {@code Subscription.activate}.
     */
    boolean activate(Instant from, Instant until) {
        if (!BoostStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = BoostStatuses.ACTIVE;
        this.startsAt = from;
        this.endsAt = until;
        return true;
    }

    /**
     * Abandon a pending boost whose payment failed.
     *
     * <p>{@code expired} rather than a dedicated failure state: the contract's vocabulary has two
     * terminal values and this one is accurate — the window never opened and never will. Inventing
     * a third would put a value on the wire the contract does not declare.
     */
    boolean fail() {
        if (!BoostStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = BoostStatuses.EXPIRED;
        return true;
    }
}
