package com.punenest.api.finance.rent;

import com.punenest.api.common.persistence.AuditedEntity;
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
 * <p><strong>Never hard-deleted, and never updated except by the webhook.</strong> There is no
 * delete endpoint: a payment record is the evidence a tenant paid and an owner was credited, and it
 * is also the HRA receipt a tenant files with their employer. The only mutation after creation is
 * the terminal state transition driven by the provider callback.
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
public class RentPayment extends AuditedEntity {

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

    /** The gateway order id. Unique (V14); the payment webhook's dedupe key. */
    @Column(name = "reference", updatable = false)
    private String reference;

    /** The client's {@code Idempotency-Key}. Unique (V14); stops a double-tap double-charging. */
    @Column(name = "idempotency_key", updatable = false)
    private String idempotencyKey;

    /** The provider's reason for a terminal failure, so the tenant knows whether retrying helps. */
    @Column(name = "failure_reason")
    private String failureReason;

    protected RentPayment() {
        // JPA
    }

    /**
     * Opens a pending payment. Deliberately demands every server-derived value at construction:
     * there is no path that creates a payment row and fills the money in afterwards.
     */
    public RentPayment(UUID tenancyId, long amount, long platformFee, long gst, LocalDate dueDate,
            String method, String reference, String idempotencyKey) {
        this.tenancyId = tenancyId;
        this.amount = amount;
        this.platformFee = platformFee;
        this.gst = gst;
        this.dueDate = dueDate;
        this.method = method;
        this.reference = reference;
        this.idempotencyKey = idempotencyKey;
        this.status = RentPaymentStatuses.DUE;
    }

    /**
     * Applies the provider's terminal outcome.
     *
     * <p>Returns {@code false} and changes nothing if the transition is not legal — which is the
     * normal case for a redelivered callback on an already-settled payment, not an error.
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
        }
        return true;
    }

}
