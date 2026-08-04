package com.punenest.api.billing.marketplace;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
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

    public ServiceOrderService(ServiceOfferingRepository offerings, ServiceOrderRepository orders,
            PropertyRepository properties, MarketplaceMapper mapper) {
        this.offerings = offerings;
        this.orders = orders;
        this.properties = properties;
        this.mapper = mapper;
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
