package com.draazy.api.billing.plan;

import com.draazy.api.common.persistence.VersionedEntity;
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
public class Subscription extends VersionedEntity {

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

    /**
     * The gateway order id; null on a free plan. Unique in the DB (V23) — the webhook's key.
     *
     * <p><strong>Written after the insert, not in it</strong> (D148). The row is committed before
     * Cashfree is asked for an order, so that a failure between the two cannot roll the subscription
     * away while the order stands at the gateway — that shape lets a customer pay for a row that no
     * longer exists. The column is therefore updatable, but {@link #attachOrder} refuses to overwrite
     * a ref that is already set, so it stays write-once in practice.
     */
    @Column(name = "payment_ref")
    private String paymentRef;

    /** The client's {@code Idempotency-Key}, unique per user (V23). */
    /**
     * Dedupe key, not a property of a subscription. Repository-matched only.
     *
     * <p>Updatable so every transition that ends without a payment can release it —
     * {@link #abandonUnopened}, {@link #abandonCheckout} and {@link #fail}. The web client's key is
     * derived from the plan ({@code sub:<planId>}) rather than randomised, so a dead row that kept
     * its key would be replayed on every later attempt and the customer would never be able to buy
     * that plan again.
     */
    @Column(name = "idempotency_key")
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

    /**
     * Record the order this subscription is waiting on, in the transaction after the one that
     * created the row (D148).
     *
     * <p>Refuses to overwrite an existing ref. The displaced id would still be live at Cashfree, and
     * a payment against it would then match no row at all — money in with no subscription to credit
     * it to, which is the exact failure the commit-first ordering exists to prevent.
     *
     * @return whether the id was taken
     */
    boolean attachOrder(String orderId) {
        if (!SubscriptionStatuses.PENDING.equals(status) || paymentRef != null) {
            return false;
        }
        this.paymentRef = orderId;
        return true;
    }

    /**
     * Abandon a subscription whose checkout never opened because the gateway refused the order
     * (D148).
     *
     * <p>Safe to do — and better than leaving the row pending — because the checkout session id is
     * only ever handed to the client on success: with no order there is no way for the customer to
     * pay, and nothing sweeps a pending subscription, so the row would otherwise be reported by
     * {@code GET /me/subscription} forever as an order in progress that nobody can complete.
     *
     * <p><strong>The key is released with the status, and the two must move together.</strong> A
     * cancelled row that kept its idempotency key would be replayed on the customer's next attempt
     * at the same plan, permanently answering a purchase with a cancellation.
     */
    boolean abandonUnopened() {
        if (!SubscriptionStatuses.PENDING.equals(status) || paymentRef != null) {
            return false;
        }
        this.status = SubscriptionStatuses.CANCELLED;
        this.idempotencyKey = null;
        return true;
    }

    /**
     * Retire a subscription whose checkout was opened and then walked away from (D161). Driven by
     * {@code AbandonedCheckoutSweep} once the abandoned-checkout TTL has passed.
     *
     * <p><strong>Why the payment reference is not part of the guard, unlike {@link #abandonUnopened}.</strong>
     * That method compensates for a gateway that refused the order, where a reference means the
     * order does exist and may still be paid — so refusing on it is right. This one runs 45 minutes
     * after the checkout was opened, and the reference is <em>present</em> in the case it exists
     * for: the order was created, the customer closed the tab, and closing a Cashfree modal
     * generates no webhook. Guarding on it would make the sweep a no-op for its own scenario and
     * leave {@code GET /me/subscription} reporting an order in progress that nobody can finish,
     * while the D160 cap refuses the customer's next attempt.
     *
     * <p>What proves no money arrived is the status: a settled payment moves the subscription to
     * {@code active} and a refused one to {@code cancelled}, so a row still {@code pending} has
     * never been paid for. The narrow residual race — the webhook landing during the sweep — is
     * closed by {@code @Version}: one of the two writers loses.
     *
     * <p>The key is released with the status, for the reason spelled out on {@link #abandonUnopened}:
     * the client's key is derived from the plan, so a cancelled row that kept it would answer every
     * later purchase of that plan with this cancellation.
     */
    boolean abandonCheckout() {
        if (!SubscriptionStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = SubscriptionStatuses.CANCELLED;
        this.idempotencyKey = null;
        return true;
    }

    /**
     * Abandon a pending subscription whose payment failed. Same redelivery rule as {@link #activate}.
     *
     * <p><strong>The key is released, exactly as {@link #abandonCheckout} releases it</strong>
     * (D171). A declined card is the one case where the customer is most likely to try again
     * immediately, and the web client derives its key from the plan — so a cancelled row that kept
     * its key would replay this failure back at them as though it were their new order, for every
     * later attempt at that plan. The old behaviour was safe only because each frontend happens to
     * mint a fresh key per attempt, which is a guarantee no client should have to provide.
     */
    boolean fail() {
        if (!SubscriptionStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = SubscriptionStatuses.CANCELLED;
        this.idempotencyKey = null;
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

    /**
     * Whether the paid term has run out (D57).
     *
     * <p>A null {@code renewsAt} never lapses. That is not an oversight: a {@code pending} row has
     * no term yet because no money has arrived, and expiring one would destroy an order the buyer
     * is still in the middle of paying for.
     *
     * <p>The boundary is inclusive — a subscription whose renewal instant is exactly now is over.
     * {@code renewsAt} is the start of the next term, so the last instant actually paid for is the
     * one before it.
     */
    boolean hasLapsed(Instant now) {
        return SubscriptionStatuses.ACTIVE.equals(status)
                && renewsAt != null
                && !renewsAt.isAfter(now);
    }

    /**
     * End a subscription whose term elapsed without renewal (D57).
     *
     * <p>Only {@code active} rows expire. {@code cancelled} is terminal and already accurate, and
     * overwriting it would rewrite why a subscription ended — "they upgraded away" and "they let it
     * run out" are different facts, and the second is the one the finance desk will be asked about.
     *
     * @return whether this call changed anything, so a sweep can report a real number
     */
    boolean expire(Instant now) {
        if (!hasLapsed(now)) {
            return false;
        }
        this.status = SubscriptionStatuses.EXPIRED;
        return true;
    }
}
