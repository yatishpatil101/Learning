package com.punenest.api.services.request;

import com.punenest.api.common.persistence.VersionedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
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
 * {@link ServiceRequestStatus#canTransitionTo}; there is no public setter that takes an arbitrary
 * status, because the four endpoints that move this workflow have four different authorities and a
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

    /**
     * The ops desk that works this request (D44). One of {@link com.punenest.api.security.Teams}.
     *
     * <p><strong>Stored, not inferred, and derived only once — here.</strong> Deriving it at read
     * time is what the register objected to: a type nobody had mapped would resolve to no desk and
     * the request would drop out of every queue silently. Written at construction from
     * {@link ServiceRequestTypes#teamFor}, which throws on an unmapped type, and held to its type by
     * the V72 {@code service_requests_type_team_check} pair constraint.
     *
     * <p>Not settable, because {@link #type} is not: a request cannot change desks without changing
     * what it is, and re-teaming misfiled work is the ticket board's job, not this workflow's.
     */
    @Column(name = "team", nullable = false, updatable = false)
    private String team;

    /**
     * The ops board item this request came off, or {@code null} (D45).
     *
     * <p>Null for the ordinary case — a customer filing straight from the wizard has no ticket.
     * Present when the request was raised against a ticket the same customer had already raised, so
     * the operator working the paperwork can reach the enquiry it came from instead of searching for
     * it by name.
     *
     * <p>Unique where present ({@code uq_service_requests_ticket}, V72): one ticket mirrors at most
     * one request. Not updatable — the link is a fact about where this request came from, and a
     * mutable origin is not an origin.
     */
    @Column(name = "ticket_id", updatable = false)
    private UUID ticketId;

    /**
     * The workflow state. Stored as its {@link ServiceRequestStatus#wire()} form — never
     * {@code name()} — by {@link ServiceRequestStatus.Converter}, which is what the V7 CHECK accepts.
     */
    @Column(name = "status", nullable = false)
    @Convert(converter = ServiceRequestStatus.Converter.class)
    private ServiceRequestStatus status = ServiceRequestStatus.NEW;

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

    /**
     * A request, optionally mirroring the ticket it came off (D45).
     *
     * <p>The desk is not a parameter: it is {@link ServiceRequestTypes#teamFor}(type), full stop. A
     * caller that could pass one could file a rent agreement onto the packers' queue, and the whole
     * point of D44 is that the routing is not somebody's opinion.
     */
    public ServiceRequest(UUID requesterId, String type, UUID propertyId,
            Map<String, Object> details, UUID ticketId) {
        this.requesterId = requesterId;
        this.type = type;
        this.team = ServiceRequestTypes.teamFor(type);
        this.propertyId = propertyId;
        this.details = details;
        this.ticketId = ticketId;
    }

    /**
     * Replace the structured form payload while the request is still pre-payment.
     *
     * <p>Package-private like the workflow mutators: only {@code CoFillServiceRequests} composes
     * this into an authorised flow, and only for a party who was invited onto the matter.
     */
    void replaceDetails(Map<String, Object> details) {
        this.details = details;
    }

    /**
     * Hold this request behind a gateway order until it is paid for.
     *
     * <p>Sets the initial state to {@link ServiceRequestStatus#AWAITING_PAYMENT} — not a
     * transition, the starting state of a priced request — and records what it costs. The order it
     * is waiting on lands separately in {@link #attachOrder}, because the row must be committed
     * before Cashfree is asked for one (D148). Package-private for the same reason {@link #moveTo}
     * is: only {@link ServiceRequestService} decides a request is priced.
     */
    void awaitPayment(long amount) {
        this.status = ServiceRequestStatus.AWAITING_PAYMENT;
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
        if (status != ServiceRequestStatus.AWAITING_PAYMENT || paymentRef != null) {
            return false;
        }
        this.paymentRef = orderId;
        return true;
    }

    /**
     * Move the workflow.
     *
     * <p>Package-private, and that is the point: only {@link ServiceRequestService} may call it,
     * and it checks {@link ServiceRequestStatus#canTransitionTo} plus the caller's authority first.
     * Folding those checks in here would put authorization inside an entity, where the four callers
     * — each with a different authority — could not be told apart.
     */
    void moveTo(ServiceRequestStatus status) {
        this.status = status;
    }

}
