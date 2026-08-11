package com.punenest.api.billing.boost;

import com.punenest.api.common.persistence.VersionedEntity;
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
 * <p><strong>{@code buyerId} duplicates what the listing already knows, and that is the point</strong>
 * (V45, D160). The endpoint is {@code /me/properties/{propId}/boost} and the buyer is the listing's
 * owner at the moment of purchase, so this column could be derived — until ownership changes hands,
 * after which the derivation would answer with the new owner and "who paid for this promotion"
 * would silently become a different person. It also gives the unpaid-order cap something to be
 * unique on: the cap is one open order per <em>person</em>, and a table with no person in it cannot
 * express that.
 */
@Entity
@Table(name = "boosts")
@Getter
public class Boost extends VersionedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /**
     * Who bought this window. Write-once; see the class javadoc for why it is not derived.
     *
     * <p>{@code updatable = false} is also what protects the historical record if listings ever
     * become transferable: a boost stays attributed to the person who paid for it, and a transfer
     * feature has to deal with any {@code pending} boost explicitly rather than silently inheriting
     * it. V45 says the same thing from the schema side.
     */
    @Column(name = "buyer_id", nullable = false, updatable = false)
    private UUID buyerId;

    @Column(name = "pack_id", nullable = false, updatable = false)
    private UUID packId;

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @Column(name = "status", nullable = false)
    private String status;

    /**
     * Stamped when a payment webhook confirms the money arrived (D64).
     *
     * <p>Distinct from {@code startsAt} because a future comp/manual-grant path will also open
     * the window — but should not be counted as revenue. Finance queries must key on this column,
     * not on {@code startsAt}.
     */
    @Column(name = "paid_at")
    private Instant paidAt;

    /**
     * The gateway order id; null on a free pack. Unique in the DB (V23) — the webhook's key.
     *
     * <p><strong>Written after the insert, not in it</strong> (D148). See
     * {@code Subscription.paymentRef}: the row is committed before the order is opened so that a
     * failure between the two cannot leave a live Cashfree order with no boost behind it.
     * {@link #attachOrder} refuses to overwrite, so the column is still write-once in practice.
     */
    @Column(name = "payment_ref")
    private String paymentRef;

    /** The client's {@code Idempotency-Key}, unique per property (V23). */
    /**
     * Dedupe key, not a property of a boost. It is matched in a repository lookup and must never
     * reach a response body.
     *
     * <p>Updatable so every transition that ends without a payment can release it —
     * {@link #abandonUnopened}, {@link #abandonCheckout} and {@link #fail}. A dead row that kept its
     * key would replay itself on the owner's next attempt to promote the same listing.
     */
    @Column(name = "idempotency_key")
    @Getter(AccessLevel.NONE)
    private String idempotencyKey;

    protected Boost() {
        // JPA
    }

    Boost(UUID propertyId, UUID buyerId, UUID packId, String status, Instant startsAt,
            Instant endsAt, String paymentRef, String idempotencyKey) {
        this.propertyId = propertyId;
        this.buyerId = buyerId;
        this.packId = packId;
        this.status = status;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.paymentRef = paymentRef;
        this.idempotencyKey = idempotencyKey;
    }

    /**
     * Open the promotion window from a confirmed payment. Stamps {@code paid_at} so revenue
     * queries count this boost (D64). Returns {@code false} on a boost that is not pending, because
     * the caller is a payment webhook a provider may redeliver — see {@code Subscription.activate}.
     */
    boolean activate(Instant from, Instant until) {
        if (!BoostStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = BoostStatuses.ACTIVE;
        this.startsAt = from;
        this.endsAt = until;
        this.paidAt = from;
        return true;
    }

    /**
     * Open the promotion window for a complimentary (non-payment) activation.
     *
     * <p>{@code paid_at} is deliberately <strong>not</strong> set, so revenue queries do not count
     * this boost (D64). Use this for free packs, staff grants, and any path that does not involve a
     * confirmed gateway payment.
     */
    boolean activateComp(Instant from, Instant until) {
        if (!BoostStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = BoostStatuses.ACTIVE;
        this.startsAt = from;
        this.endsAt = until;
        return true;
    }

    /**
     * Record the order this boost is waiting on, in the transaction after the one that created the
     * row (D148). Refuses to overwrite — see {@code Subscription.attachOrder} for what a displaced
     * order id costs.
     */
    boolean attachOrder(String orderId) {
        if (!BoostStatuses.PENDING.equals(status) || paymentRef != null) {
            return false;
        }
        this.paymentRef = orderId;
        return true;
    }

    /**
     * Abandon a boost whose checkout never opened because the gateway refused the order (D148).
     *
     * <p>{@code expired} for the same reason {@link #fail} uses it: the window never opened and
     * never will, and the contract declares no third terminal value. The idempotency key is released
     * with the status so the owner's next attempt on the same listing is not answered with this dead
     * row.
     */
    boolean abandonUnopened() {
        if (!BoostStatuses.PENDING.equals(status) || paymentRef != null) {
            return false;
        }
        this.status = BoostStatuses.EXPIRED;
        this.idempotencyKey = null;
        return true;
    }

    /**
     * Retire a boost whose checkout was opened and then walked away from (D161). Driven by
     * {@code AbandonedCheckoutSweep} once the abandoned-checkout TTL has passed.
     *
     * <p><strong>Why the payment reference is not part of the guard, unlike {@link #abandonUnopened}.</strong>
     * That method compensates for a gateway that refused the order, where a reference means the
     * order does exist and may still be paid — so refusing on it is right. This one runs 45 minutes
     * after the checkout was opened, and the reference is <em>present</em> in the case it exists
     * for: the order was created, the modal was closed, no webhook was ever generated. Guarding on
     * it would make the sweep a no-op for its own scenario and leave the row holding the buyer's
     * one-open-unpaid slot forever.
     *
     * <p>What proves no money arrived is the status. A settled payment moves the boost to
     * {@code active} and a refused one to {@code expired}, so a row still {@code pending} has never
     * been paid for. The narrow residual race — the webhook landing during the sweep — is closed by
     * {@code @Version}: one of the two writers loses.
     *
     * <p>The idempotency key is released with the status, exactly as {@link #abandonUnopened} does
     * and for the same reason: a dead row that kept its key would be replayed on the owner's next
     * attempt to promote that listing.
     */
    boolean abandonCheckout() {
        if (!BoostStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = BoostStatuses.EXPIRED;
        this.idempotencyKey = null;
        return true;
    }

    /**
     * Abandon a pending boost whose payment failed.
     *
     * <p>{@code expired} rather than a dedicated failure state: the contract's vocabulary has two
     * terminal values and this one is accurate — the window never opened and never will. Inventing
     * a third would put a value on the wire the contract does not declare.
     *
     * <p><strong>The key is released, exactly as {@link #abandonCheckout} releases it</strong>
     * (D171). An owner whose card was declined is the likeliest of all to retry at once, and the
     * client's key is derived from the listing and pack — so a dead row that kept its key would be
     * handed back as the answer to every later attempt to promote that listing.
     */
    boolean fail() {
        if (!BoostStatuses.PENDING.equals(status)) {
            return false;
        }
        this.status = BoostStatuses.EXPIRED;
        this.idempotencyKey = null;
        return true;
    }
}
