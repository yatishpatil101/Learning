package com.draazy.api.billing.marketplace;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The paid-services marketplace: a public price list and the caller's own orders against it.
 *
 * <p><strong>Ordering takes no money.</strong> See {@link ServiceOrder} — the offering's price is a
 * "from", the real amount is quoted after a survey, and the contract declares no payment on this
 * operation. The only money-shaped concern here is the retry key.
 *
 * <p><strong>An order can only name the caller's own listing.</strong> {@code propertyId} is
 * optional, but when it is present it is resolved owner-scoped: an unknown listing and someone
 * else's are both a 404, so this cannot be used to probe which listing ids exist.
 *
 * <p><strong>Three guards on one aggregate, and the split is the design (D58).</strong> The order
 * lifecycle is driven from two sides. {@link #updateStatus} is ops', role-guarded, and is where the
 * price is set. {@link #accept} and {@link #cancel} are the customer's, guarded by ownership rather
 * than a role, and ops is refused on both. The seam between them is
 * {@link ServiceOrderStatuses#isOpsSettable}: the desk that quotes a job cannot accept its own
 * quote, which is the only reason the two operations are not one.
 */
@Service
public class ServiceOrderService {

    /**
     * Ceiling on the bare array returned by {@code GET /me/service-orders}.
     *
     * <p>{@code api-standards.md} §5.1 allows an unpaged array for a collection driven by one
     * user's own actions, on the explicit condition that it is bounded rather than assumed small.
     * A hundred move-in jobs is far beyond any real customer; the cap exists so that a scripted
     * account cannot turn this endpoint into an unbounded response.
     */
    static final int MAX_ORDERS = 100;

    private final ServiceOfferingRepository offerings;
    private final ServiceOrderRepository orders;
    private final PropertyRepository properties;
    private final MarketplaceMapper mapper;

    /**
     * Every status move is written to {@code audit_log} (D58).
     *
     * <p>Ordering takes no money, but quoting names some, and closing an order is the last thing
     * anyone can say about a job that was paid for offline. "Who priced this, and when" is the
     * question a billing dispute opens with, and a status column alone cannot answer it.
     */
    private final AuditService audit;

    public ServiceOrderService(ServiceOfferingRepository offerings, ServiceOrderRepository orders,
            PropertyRepository properties, MarketplaceMapper mapper, AuditService audit) {
        this.offerings = offerings;
        this.orders = orders;
        this.properties = properties;
        this.mapper = mapper;
        this.audit = audit;
    }

    /** {@code GET /service-catalog} — public, fixed reference data, so a bare array. */
    @Transactional(readOnly = true)
    public List<ServiceOfferingDto> listCatalog() {
        return mapper.toOfferingDtos(offerings.findAllByOrderByNameAsc());
    }

    /** {@code GET /me/service-orders} — the caller's own, newest first, capped. */
    @Transactional(readOnly = true)
    public List<ServiceOrderDto> listOrders(AuthPrincipal caller) {
        return mapper.toOrderDtos(orders.findByUserIdOrderByCreatedAtDesc(
                caller.userId(), Limit.of(MAX_ORDERS)));
    }

    /**
     * {@code POST /me/service-orders} (contract {@code createServiceOrder}) — 201.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    @Transactional
    public ServiceOrderDto create(AuthPrincipal caller, ServiceOrderCreate body,
            String idempotencyKey) {
        String key = blankToNull(idempotencyKey);
        if (key != null) {
            Optional<ServiceOrder> replay =
                    orders.findByUserIdAndIdempotencyKey(caller.userId(), key);
            if (replay.isPresent()) {
                return mapper.toDto(replay.get());
            }
        }

        ServiceOffering offering = Ids.parseUuid(body.offeringId())
                .flatMap(offerings::findById)
                .orElseThrow(() -> NotFoundException.of("Service"));

        ServiceOrder order = new ServiceOrder(
                offering.getId(),
                caller.userId(),
                ownedProperty(caller.userId(), body.propertyId()),
                body.preferredSlot(),
                body.notes(),
                key);
        // See SubscriptionService.subscribe: the race is settled by uq_service_orders_idempotency
        // (V23) and answered as a 409; it cannot be recovered from inside this transaction.
        return mapper.toDto(orders.saveAndFlush(order));
    }

    /**
     * {@code PATCH /service-orders/{id}/status} (contract {@code updateServiceOrderStatus},
     * {@code x-roles: [staff, admin]}) — the ops half of the order lifecycle (D58).
     *
     * <p><strong>Quoting is why this is not a status setter.</strong> {@code amount} is accepted
     * here and only alongside {@link ServiceOrderStatuses#QUOTED}: pricing a job is a step in the
     * workflow, not a field the desk can revise afterwards, and an amount that arrives with any
     * other target is refused rather than ignored. Refusing is the point — silently dropping it
     * would let a desk believe it had repriced an accepted order.
     *
     * <p><strong>{@code scheduled} is not reachable from here</strong>
     * ({@link ServiceOrderStatuses#isOpsSettable}). It means the customer said yes to the price, so
     * it belongs to {@link #accept}; letting ops set it would make quoting and accepting the same
     * person's two calls.
     *
     * <p>A mis-quote has no repair on this endpoint, deliberately — see the self-loop note in
     * {@link ServiceOrderStatuses}. The order is cancelled and placed again, which costs the
     * customer a click and leaves both prices in the audit log instead of one of them vanishing.
     *
     * @throws NotFoundException   if no such order exists
     * @throws BadRequestException if the target status is unknown or not ops-settable
     * @throws ValidationException if {@code amount} is missing on a quote, or present on anything else
     * @throws ConflictException   if the transition is illegal from where the order is now
     */
    @Transactional
    public ServiceOrderDto updateStatus(AuthPrincipal caller, String id, String status,
            Long amount) {
        ServiceOrder order = found(id);
        String target = status == null ? "" : status.trim();
        if (!ServiceOrderStatuses.isKnown(target)) {
            throw new BadRequestException("Unknown service order status: " + status);
        }
        if (!ServiceOrderStatuses.isOpsSettable(target)) {
            throw new BadRequestException(
                    ("'%s' is not set from here. An order starts at '%s', and only the customer can "
                            + "accept a quote.").formatted(target, ServiceOrderStatuses.PLACED));
        }
        String from = order.getStatus();
        if (!ServiceOrderStatuses.canTransition(from, target)) {
            throw illegal(from, target);
        }
        // State before body, deliberately. Both refusals are correct on a quote sent to a closed
        // order, and "this order is already completed" is the one the caller can act on -- being
        // told the amount is missing invites them to resend with a price and fail again.
        checkAmount(target, amount);

        if (ServiceOrderStatuses.QUOTED.equals(target)) {
            order.quote(amount);
        } else {
            order.moveTo(target);
        }
        audit.record(caller, "service-order." + target, "service_order", order.getId().toString(),
                "from", from, "to", target, "amount", amount == null ? null : amount.toString());
        return mapper.toDto(orders.saveAndFlush(order));
    }

    /**
     * {@code POST /me/service-orders/{id}/accept} (contract {@code acceptServiceOrder}) — the
     * customer agreeing to the quoted price (D58).
     *
     * <p><strong>No role annotation, and a staff caller is refused.</strong> The guard is ownership,
     * which is stronger than a role: the order is resolved by (id, caller), so a stranger's is a 404
     * and never a 403. Staff and admins are turned away outright even for an order they placed
     * themselves, because the desk that sets a price must not be able to accept it — ops already has
     * {@code PATCH /status} for everything it is entitled to do, and this is the one move it is not.
     *
     * @throws ForbiddenException if the caller is ops
     * @throws NotFoundException  if the order is not the caller's
     * @throws ConflictException  if the order is not sitting at {@code quoted}
     */
    @Transactional
    public ServiceOrderDto accept(AuthPrincipal caller, String id) {
        ServiceOrder order = ownOrder(caller, id, "accept a quote on");
        return move(caller, order, ServiceOrderStatuses.SCHEDULED, "service-order.accepted");
    }

    /**
     * {@code POST /me/service-orders/{id}/cancel} (contract {@code cancelServiceOrder}) — the
     * customer calling the job off (D58).
     *
     * <p>Legal from every state before work starts and from none after, so an order the crew is
     * already on site for answers 409 rather than quietly erasing a job somebody is doing. Same
     * guards as {@link #accept}: the customer's own, ops refused.
     *
     * @throws ForbiddenException if the caller is ops
     * @throws NotFoundException  if the order is not the caller's
     * @throws ConflictException  if work has started, or the order is already closed
     */
    @Transactional
    public ServiceOrderDto cancel(AuthPrincipal caller, String id) {
        ServiceOrder order = ownOrder(caller, id, "cancel");
        return move(caller, order, ServiceOrderStatuses.CANCELLED, "service-order.cancelled");
    }

    /** Apply a customer-driven move, or refuse it. Shared by {@link #accept} and {@link #cancel}. */
    private ServiceOrderDto move(AuthPrincipal caller, ServiceOrder order, String target,
            String action) {
        String from = order.getStatus();
        if (!ServiceOrderStatuses.canTransition(from, target)) {
            throw illegal(from, target);
        }
        order.moveTo(target);
        audit.record(caller, action, "service_order", order.getId().toString(), "from", from,
                "to", target);
        return mapper.toDto(orders.saveAndFlush(order));
    }

    /**
     * {@code amount} belongs to the quote and to nothing else.
     *
     * <p>422 rather than 400 on both halves: the body parsed, the value is wrong <em>for this
     * request</em> ({@code api-standards.md} §3, and see {@link ValidationException}). A quote of
     * zero or less is refused for the same reason a quote of null is — a job with no price has not
     * been quoted, and the customer would be accepting nothing.
     */
    private static void checkAmount(String target, Long amount) {
        if (ServiceOrderStatuses.QUOTED.equals(target)) {
            if (amount == null || amount <= 0) {
                throw new ValidationException(
                        "amount is required when quoting, and must be a positive number of rupees.");
            }
        } else if (amount != null) {
            throw new ValidationException(
                    ("amount is only set when quoting. Move the order to '%s' with the price, then "
                            + "advance it to '%s'.")
                            .formatted(ServiceOrderStatuses.QUOTED, target));
        }
    }

    /** Any order by id, for the ops endpoint. Its guard is the role, not ownership. */
    private ServiceOrder found(String id) {
        return Ids.parseUuid(id)
                .flatMap(orders::findById)
                .orElseThrow(() -> NotFoundException.of("Service order"));
    }

    /** The caller's own order, with ops turned away. See {@link #accept} for why. */
    private ServiceOrder ownOrder(AuthPrincipal caller, String id, String verb) {
        if (Roles.Wire.STAFF.equals(caller.role()) || Roles.Wire.ADMIN.equals(caller.role())) {
            throw new ForbiddenException(
                    "Only the customer can " + verb + " their own service order.");
        }
        return Ids.parseUuid(id)
                .flatMap(uuid -> orders.findByIdAndUserId(uuid, caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Service order"));
    }

    /** 409, never a silent no-op: the caller asked for something the order cannot do. */
    private static ConflictException illegal(String from, String to) {
        String detail = ServiceOrderStatuses.isTerminal(from)
                ? "This order is already " + from + "."
                : "An order at '" + from + "' cannot move to '" + to + "'.";
        return new ConflictException(detail);
    }

    /** The caller's listing by id or slug, or null when none was named. Someone else's is a 404. */
    private UUID ownedProperty(UUID ownerId, String propId) {
        if (propId == null || propId.isBlank()) {
            return null;
        }
        return Ids.parseUuid(propId)
                .flatMap(id -> properties.findByIdAndOwner_Id(id, ownerId))
                .or(() -> properties.findBySlugAndOwner_Id(propId, ownerId))
                .map(Property::getId)
                .orElseThrow(() -> NotFoundException.of("Listing"));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
