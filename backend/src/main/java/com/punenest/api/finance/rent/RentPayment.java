package com.punenest.api.finance.rent;

import com.punenest.api.common.persistence.VersionedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

/**
 * One rent payment against a tenancy — the tenant's charge and the owner's receipt, which are the
 * same row read from two sides. Maps {@code rent_payments} (V6, constrained by V14).
 *
 * <p><strong>Amount, fee and GST are all server-computed and none of them are client-supplied.</strong>
 * The amount comes from the tenancy's rent (spec fix S12: it used to be a required request field,
 * so a tenant could have paid ₹1 and had it recorded as the month's rent), and the fee and GST come
 * from {@link RentFeeCalculator}.
 *
 * <p><strong>Never hard-deleted, and never updated except by the webhook and the order handshake.</strong>
 * There is no delete endpoint: a payment record is the evidence a tenant paid and an owner was
 * credited, and it is also the HRA receipt a tenant files with their employer. After creation the
 * only mutations are {@link #attachOrder} / {@link #abandonUnopened}, which close the gap between
 * committing the row and opening the gateway order (D148), and the terminal state transition driven
 * by the provider callback.
 *
 * <p><strong>{@code reference} is the gateway order id and is unique</strong> (V14). It is the
 * webhook's dedupe key — Cashfree may redeliver an event, and without uniqueness a replay would be
 * applied twice.
 *
 * <p>Money is {@link Long} whole rupees ({@code bigint} in V6), matching the contract's
 * {@code Money}. Ids, not associations: this entity lives in {@code finance} and the tenancy it
 * points at is in the same context, but the property and users behind it are not.
 */
@Entity
@Table(name = "rent_payments")
@Getter
public class RentPayment extends VersionedEntity {

    @Column(name = "tenancy_id", nullable = false, updatable = false)
    private UUID tenancyId;

    /** The rent itself, excluding fee and GST. Derived from the tenancy, never from the client. */
    @Column(name = "amount", nullable = false, updatable = false)
    private Long amount;

    @Column(name = "platform_fee", nullable = false, updatable = false)
    private Long platformFee = 0L;

    @Column(name = "gst", nullable = false, updatable = false)
    private Long gst = 0L;

    /** The rent month this settles. NOT NULL since V14 so the duplicate-payment index can rely on it. */
    @Column(name = "due_date", nullable = false, updatable = false)
    private LocalDate dueDate;

    /** Set only when the provider confirms settlement. Null while pending or failed. */
    @Column(name = "paid_date")
    private LocalDate paidDate;

    @Column(name = "status", nullable = false)
    private String status = RentPaymentStatuses.DUE;

    @Column(name = "method", updatable = false)
    private String method;

    /**
     * The gateway order id. Unique (V14); the payment webhook's dedupe key.
     *
     * <p>Null between the insert and {@link #attachOrder}. The row is committed before Cashfree is
     * asked for an order (D148), because the reverse order lets a rolled-back transaction leave a
     * payable order behind with no payment row to settle it against.
     */
    @Column(name = "reference")
    private String reference;

    /**
     * The client's {@code Idempotency-Key}. Unique (V14); stops a double-tap double-charging.
     *
     * <p>Updatable only so a payment that ended without money can release it —
     * {@link #abandonUnopened}, {@link #abandonCheckout} and a failing {@link #settle}. The web
     * client derives the key from the tenancy and the month ({@code rent:<tenancy>:<month>}) rather
     * than randomising it, so a failed row that kept its key would replay itself on every later
     * attempt and the tenant could never pay that month. A <em>paid</em> row keeps its key on
     * purpose: replaying that one is what the header is for.
     */
    @Column(name = "idempotency_key")
    private String idempotencyKey;

    /** The provider's reason for a terminal failure, so the tenant knows whether retrying helps. */
    @Column(name = "failure_reason")
    private String failureReason;

    protected RentPayment() {
        // JPA
    }

    /**
     * Opens a pending payment. Deliberately demands every server-derived money value at
     * construction: there is no path that creates a payment row and fills the money in afterwards.
     *
     * <p>The order reference is <em>not</em> among them and cannot be — the row has to exist and be
     * committed before the gateway is asked for an order (D148), so it arrives later through
     * {@link #attachOrder}.
     */
    public RentPayment(UUID tenancyId, long amount, long platformFee, long gst, LocalDate dueDate,
            String method, String idempotencyKey) {
        this.tenancyId = tenancyId;
        this.amount = amount;
        this.platformFee = platformFee;
        this.gst = gst;
        this.dueDate = dueDate;
        this.method = method;
        this.idempotencyKey = idempotencyKey;
        this.status = RentPaymentStatuses.DUE;
    }

    /**
     * Record the gateway order this payment is waiting on, in the transaction after the one that
     * created the row (D148).
     *
     * <p>Refuses to overwrite an existing reference: the displaced order would still be payable at
     * Cashfree and the callback for it would then match nothing, leaving a tenant who really paid
     * showing as unpaid.
     *
     * @return whether the id was taken
     */
    public boolean attachOrder(String orderId) {
        if (!RentPaymentStatuses.DUE.equals(status) || reference != null) {
            return false;
        }
        this.reference = orderId;
        return true;
    }

    /**
     * Fail a payment whose checkout never opened because the gateway refused the order (D148).
     *
     * <p>Leaving it {@code due} is not an option: {@code due} occupies the month in
     * {@code uq_rent_payments_live_per_due_date}, so a row that can never be paid would block that
     * tenancy's rent for that month permanently. {@code failed} is excluded from the index, which is
     * exactly why V14 made it partial.
     *
     * <p>The idempotency key is released alongside, because the client's key is derived from the
     * tenancy and month and would otherwise replay this failure at every retry.
     *
     * @param reason shown to the tenant, so "try again" is distinguishable from "your bank declined"
     */
    public boolean abandonUnopened(String reason) {
        if (!RentPaymentStatuses.DUE.equals(status) || reference != null) {
            return false;
        }
        this.status = RentPaymentStatuses.FAILED;
        this.failureReason = reason;
        this.idempotencyKey = null;
        return true;
    }

    /**
     * Fail a payment whose checkout was opened and then walked away from (D161). Driven by
     * {@code AbandonedCheckoutSweep} once the abandoned-checkout TTL has passed.
     *
     * <p><strong>Why the reference is not part of the guard, unlike {@link #abandonUnopened}.</strong>
     * That method compensates for a gateway that refused the order, where a reference means the
     * order exists and may still be paid. This one runs 45 minutes after the checkout was opened,
     * and the reference is <em>present</em> in the case it exists for: the order was created and
     * the tenant closed the page, which generates no webhook. Guarding on it would make the sweep a
     * no-op for its own scenario — and rent is the worst place to strand a row, because a payment
     * left at {@code due} occupies the month in {@code uq_rent_payments_live_per_due_date}, so the
     * tenant is refused with "already paid or in progress" and cannot pay that month by any route.
     *
     * <p>{@code failed} is excluded from that index, which frees the month, and it carries a reason
     * the tenant can read in their ledger — which is also how a swept row is told apart from a bank
     * decline during reconciliation.
     *
     * <p><strong>The gateway order closes with this row</strong> (D169). It did not always:
     * {@code CashfreePaymentGateway.createOrder} once sent no {@code order_expiry_time}, so the
     * order stayed payable for weeks after the TTL retired the row, and a tenant who left the
     * checkout tab open could pay it — by which time {@code failed} had freed the month and they
     * may have paid it again, which made rent the one family where this was a double charge rather
     * than money for nothing. The order now carries an expiry derived from the same
     * {@code CheckoutTtl} this sweep subtracts, so the two windows close together. The residual
     * case — a payment already in flight at the gateway when the sweep runs — still lands on a
     * terminal row: {@link #settle} refuses the transition and {@code RentService} logs the refusal
     * at {@code ERROR} naming the order, so it is reconcilable rather than silent.
     *
     * @param reason shown to the tenant, so "start again" is distinguishable from "your bank declined"
     */
    public boolean abandonCheckout(String reason) {
        if (!RentPaymentStatuses.DUE.equals(status)) {
            return false;
        }
        this.status = RentPaymentStatuses.FAILED;
        this.failureReason = reason;
        this.idempotencyKey = null;
        return true;
    }

    /**
     * Applies the provider's terminal outcome.
     *
     * <p>Returns {@code false} and changes nothing if the transition is not legal — which is the
     * normal case for a redelivered callback on an already-settled payment, not an error.
     *
     * <p><strong>A failure releases the idempotency key; a payment keeps it</strong> (D171). The two
     * are not symmetric. Replaying a <em>paid</em> row is the whole point of the header — the tenant
     * retried, the month is settled, and handing back the settled payment is the correct answer.
     * Replaying a <em>failed</em> one is not: the client's key is derived from the tenancy and
     * month, so a declined card that kept its key would answer the tenant's next attempt at that
     * same month with the decline, and rent is the family where that leaves them unable to pay at
     * all. Same release, same reason, as {@link #abandonUnopened} and {@link #abandonCheckout}.
     *
     * @param nextStatus    {@link RentPaymentStatuses#PAID} or {@link RentPaymentStatuses#FAILED}
     * @param settledOn     the settlement date, ignored unless {@code nextStatus} is paid
     * @param failureReason the provider's reason, ignored unless {@code nextStatus} is failed
     * @return whether the payment moved
     */
    public boolean settle(String nextStatus, LocalDate settledOn, String failureReason) {
        if (!RentPaymentStatuses.canTransition(this.status, nextStatus)) {
            return false;
        }
        this.status = nextStatus;
        if (RentPaymentStatuses.PAID.equals(nextStatus)) {
            this.paidDate = settledOn;
        } else {
            this.failureReason = failureReason;
            this.idempotencyKey = null;
        }
        return true;
    }

}
