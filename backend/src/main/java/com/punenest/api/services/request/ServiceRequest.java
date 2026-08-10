package com.punenest.api.services.request;

import com.punenest.api.common.persistence.VersionedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An assisted-service request — "draw up my rent agreement", "get me a legal opinion on this
 * title". Maps {@code service_requests} (V7).
 *
 * <p><strong>This is the aggregate slice 10 deferred to.</strong> {@code RentAgreementService}
 * deliberately stops at the {@code draft} record and hands the workflow — the stamp-duty maths, the
 * e-sign, the registration — to this context. Nothing else on the platform can move a rent
 * agreement out of {@code draft}.
 *
 * <p><strong>Status is driven, never set.</strong> Every transition goes through
 * {@link ServiceRequestStatuses#canTransition}; there is no public setter that takes an arbitrary
 * string, because the four endpoints that move this workflow have four different authorities and a
 * shared setter would let any of them make any move.
 */
@Entity
@Table(name = "service_requests")
@Getter
public class ServiceRequest extends VersionedEntity {

    /** The customer. Always from the JWT; a request filed on someone else's behalf is a ticket. */
    @Column(name = "requester_id", updatable = false)
    private UUID requesterId;

    /** One of {@link com.punenest.api.services.request.ServiceRequestTypes} — the desk's word. */
    @Column(name = "type", nullable = false, updatable = false)
    private String type;

    /** One of {@link ServiceRequestStatuses}; the V7 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    private String status = ServiceRequestStatuses.NEW;

    @Column(name = "property_id", updatable = false)
    private UUID propertyId;

    /** The staff member working it. Set by ops, never by the customer. */
    @Column(name = "assignee_id")
    @Setter
    private UUID assigneeId;

    /**
     * The fields the customer filled — property, rent, deposit, scope — as a structured object (V36,
     * D119). Held as a map rather than a flat string so the create shape round-trips onto
     * {@link ServiceRequestDto}; {@code null} for a request with no structured detail.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "details")
    private Map<String, Object> details;

    /**
     * What the customer was charged, in whole rupees. {@code null} for a free desk (a legal
     * opinion), set once at creation for a priced one (a rent agreement) from the published fee.
     */
    @Column(name = "amount")
    private Long amount;

    /**
     * The Cashfree order id, and how the payment webhook finds this request again.
     *
     * <p>Null between {@link #awaitPayment} and {@link #attachOrder}: the request is committed in
     * {@code awaiting-payment} before the order is opened (D148), because opening it first means an
     * exception on the way to commit destroys the request while its order stays payable at Cashfree.
     */
    @Column(name = "payment_ref")
    private String paymentRef;

    protected ServiceRequest() {
        // JPA
    }

    public ServiceRequest(UUID requesterId, String type, UUID propertyId, Map<String, Object> details) {
        this.requesterId = requesterId;
        this.type = type;
        this.propertyId = propertyId;
        this.details = details;
    }

    /**
     * Hold this request behind a gateway order until it is paid for.
     *
     * <p>Sets the initial state to {@link ServiceRequestStatuses#AWAITING_PAYMENT} — not a
     * transition, the starting state of a priced request — and records what it costs. The order it
     * is waiting on lands separately in {@link #attachOrder}, because the row must be committed
     * before Cashfree is asked for one (D148). Package-private for the same reason {@link #moveTo}
     * is: only {@link ServiceRequestService} decides a request is priced.
     */
    void awaitPayment(long amount) {
        this.status = ServiceRequestStatuses.AWAITING_PAYMENT;
        this.amount = amount;
    }

    /**
     * Record the order this request is waiting on, in the transaction after the one that committed
     * it (D148).
     *
     * <p>Refuses to overwrite an existing ref: the displaced order would still be payable and its
     * callback would then match no request, so a customer who paid for their agreement would sit at
     * {@code awaiting-payment} while the money sits unallocated.
     *
     * @return whether the id was taken
     */
    boolean attachOrder(String orderId) {
        if (!ServiceRequestStatuses.AWAITING_PAYMENT.equals(status) || paymentRef != null) {
            return false;
        }
        this.paymentRef = orderId;
        return true;
    }

    /**
     * Move the workflow.
     *
     * <p>Package-private, and that is the point: only {@link ServiceRequestService} may call it,
     * and it checks {@link ServiceRequestStatuses#canTransition} plus the caller's authority first.
     * Folding those checks in here would put authorization inside an entity, where the four callers
     * — each with a different authority — could not be told apart.
     */
    void moveTo(String status) {
        this.status = status;
    }

}
