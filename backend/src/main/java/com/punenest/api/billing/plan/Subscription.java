package com.punenest.api.billing.plan;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;

/**
 * One user's subscription to a {@link Plan}. Maps {@code subscriptions} (V8, extended by V23).
 *
 * <p><strong>A row exists from the moment checkout is opened, not from the moment it is paid.</strong>
 * {@code POST /me/subscription} answers {@code 201} with the row in {@link SubscriptionStatuses#PENDING}
 * and {@link #paymentRef} carrying the gateway order id; the payment webhook is what moves it to
 * {@code active} (spec fix S50). The alternative shapes are both broken: activating on {@code POST}
 * gives the plan away to anyone who closes the checkout tab, and persisting nothing until the webhook
 * leaves {@code 201} describing a row that does not exist.
 *
 * <p>A free plan skips all of that and is {@code active} on creation with a null {@code paymentRef} —
 * there is no order to wait for.
 */
@Entity
@Table(name = "subscriptions")
@Getter
public class Subscription extends AuditedEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "renews_at")
    private Instant renewsAt;

    /** The gateway order id; null on a free plan. Unique in the DB (V23) — the webhook's key. */
    @Column(name = "payment_ref", updatable = false)
    private String paymentRef;

    /** The client's {@code Idempotency-Key}, unique per user (V23). */
    /**
     * Dedupe key, not a property of a subscription. Repository-matched only.
     */
    @Column(name = "idempotency_key", updatable = false)
    @Getter(AccessLevel.NONE)
    private String idempotencyKey;

    protected Subscription() {
        // JPA
    }

    Subscription(UUID userId, UUID planId, String status, Instant startedAt, Instant renewsAt,
            String paymentRef, String idempotencyKey) {
        this.userId = userId;
        this.planId = planId;
        this.status = status;
        this.startedAt = startedAt;
        this.renewsAt = renewsAt;
        this.paymentRef = paymentRef;
        this.idempotencyKey = idempotencyKey;
    }

    /**
     * Activate a pending subscription, dating the term from the moment the money arrived.
     *
     * <p>Returns {@code false} — rather than throwing — when the row is not pending, because the
     * caller is a payment webhook that a provider may redeliver at any time. A redelivery is
     * ordinary traffic, not an error, and treating it as one would make the provider retry forever.
     *
     * @param paidAt  when the gateway confirmed
     * @param renewal end of the paid term
     * @return whether this call changed anything
     */
    boolean activate(Instant paidAt, Instant renewal) {
        if (!SubscriptionStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = SubscriptionStatuses.ACTIVE;
        this.startedAt = paidAt;
        this.renewsAt = renewal;
        return true;
    }

    /** Abandon a pending subscription whose payment failed. Same redelivery rule as {@link #activate}. */
    boolean fail() {
        if (!SubscriptionStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = SubscriptionStatuses.CANCELLED;
        return true;
    }

    /**
     * Supersede a live subscription because the holder bought a different plan.
     *
     * <p>Only ever called on the <em>previous</em> subscription once the new one is paid for, so an
     * upgrade that is abandoned at the checkout page leaves the old plan running.
     */
    boolean supersede() {
        if (!SubscriptionStatuses.isLive(status)) {
            return false;
        }
        this.status = SubscriptionStatuses.CANCELLED;
        return true;
    }
}
