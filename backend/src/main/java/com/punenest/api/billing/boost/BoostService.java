package com.punenest.api.billing.boost;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.provider.PaymentGateway;
import com.punenest.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The promotion price list and the purchase of a window against one listing.
 *
 * <p><strong>You can only boost your own listing, and someone else's is a 404.</strong> The
 * ownership check and the lookup are one query ({@code findByIdAndOwner_Id}), so there is no window
 * in which the row is read and then authorised. Answering 403 would confirm that a given listing id
 * exists and belongs to someone else.
 *
 * <p><strong>The price comes from the pack.</strong> The request body names a {@code packId} and
 * nothing else; the amount is read from the row, as with plans and rent.
 */
@Service
public class BoostService {

    private static final Logger log = LoggerFactory.getLogger(BoostService.class);

    /** Window length when a pack is seeded without one. A week is the shortest pack we sell. */
    private static final int DEFAULT_DURATION_DAYS = 7;

    private final BoostPackRepository packs;
    private final BoostRepository boosts;
    private final PropertyRepository properties;
    private final BoostMapper mapper;
    private final PaymentGateway gateway;

    public BoostService(BoostPackRepository packs, BoostRepository boosts,
            PropertyRepository properties, BoostMapper mapper, PaymentGateway gateway) {
        this.packs = packs;
        this.boosts = boosts;
        this.properties = properties;
        this.mapper = mapper;
        this.gateway = gateway;
    }

    /** {@code GET /boost-packs} — public, fixed reference data, so a bare array. */
    @Transactional(readOnly = true)
    public List<BoostPackDto> listPacks() {
        return mapper.toPackDtos(packs.findAllByOrderByPriceAsc());
    }

    /**
     * {@code GET /me/properties/{propId}/boost} (contract {@code listListingBoosts}) — owner-scoped.
     *
     * <p><strong>Why a read had to exist.</strong> The boost surface could write and never read: a
     * client could buy a window and then had no way to render whether it was pending, live or
     * finished. There is also no {@code boosted} flag on {@code PropertySummary} — deliberately, see
     * tech-debt D59, since a boost does not yet influence ranking — so the listing itself could not
     * answer the question either. An owner who paid could not see what they had paid for.
     *
     * <p>Returns the full history rather than only the live window. A boost stuck in
     * {@code pending} is a payment that did not complete, and that is the single most useful thing
     * this endpoint can show someone wondering why nothing happened; filtering it out server-side
     * would hide the failure and leave "I paid and nothing happened" unanswerable from the API.
     *
     * <p>Bare array, matching {@code GET /boost-packs} above: the collection is bounded by how many
     * times one owner has promoted one listing.
     */
    @Transactional(readOnly = true)
    public List<BoostDto> listForListing(AuthPrincipal caller, String propId) {
        UUID propertyId = ownedProperty(caller.userId(), propId);
        return boosts.findByPropertyIdOrderByCreatedAtDesc(propertyId).stream()
                .map(mapper::toDto)
                .toList();
    }

    /**
     * {@code POST /me/properties/{propId}/boost} (contract {@code boostListing}, spec fix S51) — 201.
     *
     * <p>Returns {@code pending} with the gateway order id; the window opens when the payment
     * webhook confirms. A zero-price pack activates immediately.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    @Transactional
    public BoostDto boost(AuthPrincipal caller, String propId, String packId,
            String idempotencyKey) {
        UUID propertyId = ownedProperty(caller.userId(), propId);
        String key = blankToNull(idempotencyKey);
        if (key != null) {
            Optional<Boost> replay = boosts.findByPropertyIdAndIdempotencyKey(propertyId, key);
            if (replay.isPresent()) {
                return mapper.toDto(replay.get());
            }
        }

        BoostPack pack = Ids.parseUuid(packId)
                .flatMap(packs::findById)
                .orElseThrow(() -> NotFoundException.of("Boost pack"));

        Instant now = Instant.now();
        boolean free = pack.getPrice() <= 0;
        String orderId = free ? null : createOrder(propertyId, pack);

        Boost boost = new Boost(
                propertyId,
                pack.getId(),
                free ? BoostStatuses.ACTIVE : BoostStatuses.PENDING,
                free ? now : null,
                free ? endOfWindow(now, pack) : null,
                orderId,
                key);
        // See SubscriptionService.subscribe: the race is settled by uq_boosts_idempotency (V23)
        // and answered as a 409; it cannot be recovered from inside this transaction.
        return mapper.toDto(boosts.saveAndFlush(boost));
    }

    /**
     * Apply a terminal outcome from the payment webhook. Reachable only after an HMAC check.
     *
     * <p>An order id this table never issued is ignored — the callback endpoint is shared with rent
     * and subscriptions.
     *
     * @param paidAt when the gateway confirmed; the promotion window is measured from this
     */
    @Transactional
    public void applyWebhookOutcome(String orderId, boolean paid, Instant paidAt) {
        if (orderId == null || orderId.isBlank()) {
            return;
        }
        Optional<Boost> found = boosts.findByPaymentRef(orderId);
        if (found.isEmpty()) {
            return;
        }
        Boost boost = found.get();
        if (!paid) {
            if (boost.fail()) {
                log.info("Boost {} expired unopened: payment failed", boost.getId());
            }
            return;
        }
        BoostPack pack = packs.findById(boost.getPackId()).orElse(null);
        if (pack == null) {
            // D62: the pack row vanished between purchase and callback. The window still opens --
            // the customer paid -- but at the shortest duration, so a mispriced window would
            // otherwise be indistinguishable from a correct one in the data. Warn so it is not.
            log.warn("Boost pack {} not found while settling boost {}; opening the default {}-day "
                    + "window instead of the purchased one", boost.getPackId(), boost.getId(),
                    DEFAULT_DURATION_DAYS);
        }
        if (!boost.activate(paidAt, endOfWindow(paidAt, pack))) {
            // why: a redelivered callback on a boost that is already settled. Expected.
            log.info("Ignored payment callback for boost {}: already {}",
                    boost.getId(), boost.getStatus());
            return;
        }
        log.info("Boost {} activated by provider callback", boost.getId());
    }

    /** Resolve the contract's {@code propId} — a UUID or a slug — and prove the caller owns it. */
    private UUID ownedProperty(UUID ownerId, String propId) {
        return Ids.parseUuid(propId)
                .flatMap(id -> properties.findByIdAndOwner_Id(id, ownerId))
                .or(() -> properties.findBySlugAndOwner_Id(propId, ownerId))
                .map(Property::getId)
                .orElseThrow(() -> NotFoundException.of("Listing"));
    }

    /**
     * Create the gateway order for a priced pack.
     *
     * <p>Fails before anything is persisted when the gateway returns no order id: without one the
     * webhook can never find this row, so a paid boost would never open. See
     * {@code SubscriptionService.createOrder}.
     */
    private String createOrder(UUID propertyId, BoostPack pack) {
        PaymentGateway.PaymentOrder order = gateway.createOrder(pack.getPrice(),
                "boost:" + propertyId + ":" + pack.getId());
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return order.orderId();
    }

    /** End of the promotion window. A pack that lost its duration still gets the shortest one. */
    private static Instant endOfWindow(Instant from, BoostPack pack) {
        int days = pack == null || pack.getDurationDays() == null || pack.getDurationDays() <= 0
                ? DEFAULT_DURATION_DAYS
                : pack.getDurationDays();
        return from.plus(days, ChronoUnit.DAYS);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
