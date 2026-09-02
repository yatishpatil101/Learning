package com.draazy.api.billing.boost;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.payments.AbandonedCheckouts;
import com.draazy.api.common.persistence.ConstraintViolations;
import com.draazy.api.common.web.Ids;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

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
public class BoostService implements AbandonedCheckouts {

    private static final Logger log = LoggerFactory.getLogger(BoostService.class);

    /** Window length when a pack is seeded without one. A week is the shortest pack we sell. */
    private static final int DEFAULT_DURATION_DAYS = 7;

    /**
     * How many unpaid boost orders one buyer may hold open (D160).
     *
     * <p>One, because each opens a live gateway order and nothing else bounded the total —
     * {@code WriteRateLimitFilter} caps the rate, not the count, and {@code Idempotency-Key} is
     * optional, so a loop that omits the header opened unbounded real orders against our merchant
     * account.
     *
     * <p><strong>Per buyer, not per listing.</strong> Scoping to the listing would have been the
     * easier change — {@code property_id} is already on the row — but it would let an owner with
     * five listings hold five live orders, which is a different rule from the one the product asked
     * for. What it costs is that an owner cannot have two boost checkouts open at once; what it buys
     * is a bound that does not grow with how many listings someone can create.
     *
     * <p><strong>The value is mirrored by {@code uq_boosts_open_unpaid}</strong> (V45), which is what
     * holds the cap under concurrency. Raising this constant means replacing that index — a unique
     * index cannot express "at most N".
     */
    private static final int MAX_OPEN_UNPAID_PER_BUYER = 1;

    /**
     * The V45 partial unique index that enforces {@link #MAX_OPEN_UNPAID_PER_BUYER}.
     *
     * <p>Named so its violation can be told apart from the idempotency index, a foreign key or a
     * not-null, and answered as the cap's own 409 rather than the generic conflict.
     */
    private static final String OPEN_UNPAID_INDEX = "uq_boosts_open_unpaid";

    private final BoostPackRepository packs;
    private final BoostRepository boosts;
    private final PropertyRepository properties;
    private final BoostMapper mapper;
    private final PaymentGateway gateway;

    /** Runs the two short transactions {@link #boost} is built from — see the field it mirrors on
     * {@code SubscriptionService} for why the template is built here and why propagation is left
     * at {@code REQUIRED}. */
    private final TransactionTemplate transactions;

    public BoostService(BoostPackRepository packs, BoostRepository boosts,
            PropertyRepository properties, BoostMapper mapper, PaymentGateway gateway,
            PlatformTransactionManager transactionManager) {
        this.packs = packs;
        this.boosts = boosts;
        this.properties = properties;
        this.mapper = mapper;
        this.gateway = gateway;
        this.transactions = new TransactionTemplate(transactionManager);
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
     * finished. {@code PropertySummary.boosted} (D59) now answers "is this listing promoted right
     * now", but only that — it is one boolean derived from the live window and says nothing about
     * which pack was bought, when it ends, or that a payment is still pending. An owner who paid
     * still needs this endpoint to see what they paid for.
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
     * <p><strong>One unpaid order at a time, per buyer</strong> (D160). A priced pack is refused with
     * 409 while the caller already holds a {@code pending} boost on <em>any</em> of their listings,
     * because each one opens a live gateway order and nothing else bounded the total. The held order
     * is visible in {@code GET /me/properties/{propId}/boost}, and the abandoned-checkout sweep
     * clears it if the owner never comes back.
     *
     * <p><strong>Deliberately not {@code @Transactional}</strong> (D148). The pending row is
     * committed before the order is opened and the id attached afterwards, so that a failure between
     * the two cannot roll the boost away while leaving a payable order at the gateway. See
     * {@code SubscriptionService.subscribe}.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    public BoostDto boost(AuthPrincipal caller, String propId, String packId,
            String idempotencyKey) {
        String key = blankToNull(idempotencyKey);
        Opened opened = transactions.execute(tx -> open(caller, propId, packId, key));

        if (opened.settled() != null) {
            // A replay, or a free pack: no money, so nothing to open and nothing to attach.
            return opened.settled();
        }

        PaymentGateway.PaymentOrder order;
        try {
            order = createOrder(opened);
            return transactions.execute(tx -> attach(opened.boostId(), order));
        } catch (RuntimeException checkoutFailed) {
            // The attach is inside the guard, not only the gateway call. A second-transaction
            // failure would otherwise leave the pending boost holding its idempotency key, and the
            // owner would get that dead row back — with no checkout session on it — every time they
            // tried to promote that listing again.
            abandon(opened);
            throw checkoutFailed;
        }
    }

    /**
     * First transaction: authorise, settle the free case, or commit the pending row the order will
     * be opened against.
     */
    private Opened open(AuthPrincipal caller, String propId, String packId, String key) {
        UUID propertyId = ownedProperty(caller.userId(), propId);
        if (key != null) {
            Optional<Boost> replay = boosts.findByPropertyIdAndIdempotencyKey(propertyId, key);
            if (replay.isPresent()) {
                return Opened.settled(mapper.toDto(replay.get()));
            }
        }

        BoostPack pack = Ids.parseUuid(packId)
                .flatMap(packs::findById)
                .orElseThrow(() -> NotFoundException.of("Boost pack"));

        Instant now = Instant.now();
        boolean free = pack.getPrice() <= 0;

        if (!free) {
            // Each priced pack opens a live gateway order, and nothing else bounds the total (D160):
            // the rate limiter caps the speed, and Idempotency-Key is optional, so a loop that
            // simply omits the header opened unbounded real orders. The held order is visible in
            // GET /me/properties/{propId}/boost as `pending`, so this points at something the owner
            // can act on.
            //
            // Fast path only: an unlocked read over rows that do not exist yet, so N concurrent
            // callers all see zero. uq_boosts_open_unpaid, caught below, is what holds.
            long openUnpaid = boosts.countByBuyerIdAndStatus(
                    caller.userId(), BoostStatuses.PENDING);
            if (openUnpaid >= MAX_OPEN_UNPAID_PER_BUYER) {
                throw openUnpaidConflict();
            }
        }

        Boost boost = new Boost(
                propertyId,
                caller.userId(),
                pack.getId(),
                free ? BoostStatuses.ACTIVE : BoostStatuses.PENDING,
                free ? now : null,
                free ? endOfWindow(now, pack) : null,
                null,
                key);
        Boost saved;
        try {
            saved = boosts.saveAndFlush(boost);
        } catch (DataIntegrityViolationException violation) {
            // Only the cap's own index is translated; everything else is rethrown untouched --
            // including uq_boosts_idempotency (V23), which GlobalExceptionHandler answers as a
            // generic 409 and which cannot be recovered from inside this transaction (Hibernate
            // poisons the persistence context when a constraint fires).
            if (isOpenUnpaidCollision(violation)) {
                log.info("Concurrent boost lost the open-unpaid race for {}", caller.userId());
                throw openUnpaidConflict();
            }
            throw violation;
        }
        if (free) {
            // After the save, not before (D172). A promoted listing with no boost row behind it is
            // a property nobody can explain or revoke, whereas a boost row with an unpromoted
            // listing is merely a promotion that did not take. This transaction rolls both back
            // together today, so the ordering changes nothing in practice -- it is here so that a
            // future caller running this outside a transaction inherits the survivable failure
            // rather than the unexplainable one.
            promote(propertyId, endOfWindow(now, pack));
        }
        return free
                ? Opened.settled(mapper.toDto(saved))
                : new Opened(null, saved.getId(), pack.getPrice(),
                        "boost:" + propertyId + ":" + pack.getId());
    }

    /**
     * Second transaction: record the order the committed boost is waiting on.
     *
     * <p>A boost that has vanished between the two is not a case that exists — nothing deletes
     * boosts — so it is raised rather than papered over.
     */
    private BoostDto attach(UUID boostId, PaymentGateway.PaymentOrder order) {
        Boost boost = boosts.findById(boostId)
                .orElseThrow(() -> new IllegalStateException("Boost " + boostId
                        + " disappeared before gateway order " + order.orderId()
                        + " could be attached"));
        if (!boost.attachOrder(order.orderId())) {
            log.error("Boost {} would not take gateway order {}; it is {} with ref {}",
                    boostId, order.orderId(), boost.getStatus(), boost.getPaymentRef());
        }
        // The session id is single-use and lives only in this response: the checkout SDK consumes
        // it, and the payment webhook - not any stored id - is what later opens the window (D167).
        return mapper.toDto(boosts.saveAndFlush(boost))
                .withPaymentSessionId(order.paymentSessionId());
    }

    /**
     * Compensating write for a gateway that refused the order after the row was committed (D148).
     *
     * <p>Expired rather than left pending: {@link #listForListing} deliberately shows pending rows
     * so an owner can see a payment that did not complete, and a row that can never be paid would
     * sit there permanently claiming to be in progress. Releasing the idempotency key with it keeps
     * the owner's next attempt on the same listing from being answered with this dead row.
     *
     * <p>A failure to compensate is logged and swallowed so the caller still gets the gateway's
     * error rather than a bookkeeping one.
     */
    private void abandon(Opened opened) {
        try {
            transactions.executeWithoutResult(tx ->
                    boosts.findById(opened.boostId()).ifPresent(Boost::abandonUnopened));
            log.error("No gateway order for boost {} ({}); expired it and released the idempotency "
                    + "key. Nothing was charged.", opened.boostId(), opened.reference());
        } catch (RuntimeException compensationFailed) {
            log.error("Could not expire boost {} after its gateway order failed; it will sit pending "
                    + "with an idempotency key that replays this dead row",
                    opened.boostId(), compensationFailed);
        }
    }

    /**
     * What survives the first transaction: a finished response, or plain values describing the
     * order to open. No entity crosses a transaction boundary.
     */
    private record Opened(BoostDto settled, UUID boostId, long price, String reference) {

        static Opened settled(BoostDto dto) {
            return new Opened(dto, null, 0, null);
        }
    }

    /**
     * Apply a terminal outcome from the payment webhook. Reachable only after an HMAC check.
     *
     * <p>An order id this table never issued is ignored — the callback endpoint is shared with rent
     * and subscriptions.
     *
     * @param paidAt when the gateway confirmed; the promotion window is measured from this
     * @return whether this table owned the order — the fan-out alerts on a paid event nobody claims
     */
    @Transactional
    public boolean applyWebhookOutcome(String orderId, boolean paid, Instant paidAt) {
        if (orderId == null || orderId.isBlank()) {
            return false;
        }
        Optional<Boost> found = boosts.findByPaymentRef(orderId);
        if (found.isEmpty()) {
            return false;
        }
        Boost boost = found.get();
        if (!paid) {
            if (boost.fail()) {
                log.info("Boost {} expired unopened: payment failed", boost.getId());
            }
            return true;
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
            reportRefusedSettlement(boost);
            return true;
        }
        promote(boost.getPropertyId(), endOfWindow(paidAt, pack));
        log.info("Boost {} activated by provider callback", boost.getId());
        return true;
    }

    /**
     * Say what it means that a paid callback could not be applied — and say it at the right volume.
     *
     * <p><strong>Why this stopped being one log line (D161).</strong> Until the abandoned-checkout
     * sweep existed, the only route to a settled boost was this method, so a refused settlement was
     * always a redelivered callback: harmless, and correctly INFO. The sweep adds a second route to
     * {@code expired}, and it means the opposite — the window was retired unpaid and the money has
     * turned up afterwards, buying the customer nothing. {@code PaymentWebhookController}'s
     * "unreconciled" alarm cannot catch it either, because this method returns {@code true}: the
     * order really is ours, we simply could not honour it.
     *
     * <p>{@code active} tells the benign case apart with no extra state — the promotion is running,
     * so this is a duplicate. Anything else means we hold the money and promoted nothing. The gateway
     * order id goes in the message because it is the key an operator needs to refund against.
     */
    private void reportRefusedSettlement(Boost boost) {
        if (BoostStatuses.ACTIVE.equals(boost.getStatus())) {
            log.info("Ignored payment callback for boost {}: already {}",
                    boost.getId(), boost.getStatus());
            return;
        }
        log.error("Payment settled for boost {} but it is {} — the customer has been charged and "
                + "their listing was never promoted. Gateway order {}, buyer {}. Refund or "
                + "reconcile.", boost.getId(), boost.getStatus(), boost.getPaymentRef(),
                boost.getBuyerId());
    }

    /**
     * Mirror the promotion window onto the listing so the catalogue can rank it (D59).
     *
     * <p>Written here, in the same transaction as the activation, because {@code catalog} must not
     * read {@code billing.boost} — see the column comment on {@code properties.boosted_until}.
     *
     * <p>Extends rather than overwrites: an owner who stacks a second pack while the first is still
     * running would otherwise <em>shorten</em> their promotion by buying more of it. A listing that
     * vanished between purchase and callback is logged, not thrown — the boost row itself is already
     * settled and correct, and failing here would roll back a confirmed payment.
     */
    private void promote(UUID propertyId, Instant until) {
        properties.findById(propertyId).ifPresentOrElse(property -> {
            Instant current = property.getBoostedUntil();
            if (current == null || current.isBefore(until)) {
                property.setBoostedUntil(until);
            }
        }, () -> log.warn("Boost activated for listing {} that no longer exists; ranking mirror "
                + "not written", propertyId));
    }

    /** Resolve the contract's {@code propId} — a UUID or a slug — and prove the caller owns it. */
    private UUID ownedProperty(UUID ownerId, String propId) {
        return Ids.parseUuid(propId)
                .flatMap(id -> properties.findByIdAndOwner_Id(id, ownerId))
                .or(() -> properties.findBySlugAndOwner_Id(propId, ownerId))
                .map(Property::getId)
                .orElseThrow(() -> NotFoundException.of("Listing"));
    }

    /** {@inheritDoc} — "boost", so a sweep log line names the table that moved. */
    @Override
    public String family() {
        return "boost";
    }

    /**
     * Expire every checkout that was opened and then walked away from (D161). Driven by
     * {@code AbandonedCheckoutSweep}.
     *
     * <p><strong>Why this had to exist.</strong> D148 made {@link #boost} commit the pending row
     * before opening the gateway order, and {@link #abandon} compensates when the gateway refuses —
     * but that compensation runs in the same process, so a hard kill between the commit and the
     * gateway call leaves a pending row nothing will ever clean up. Closing the Cashfree modal
     * leaves the same shape with an order that generates no webhook. Either way the row sat forever
     * in {@link #listForListing} claiming a payment was in progress, and once D160 added the
     * one-open-unpaid cap it also closed promotion to that owner across all their listings. The cap
     * and this sweep are one mechanism.
     *
     * <p><strong>Nothing paid is ever touched.</strong> A settled payment opens the window
     * ({@code active}) and a refused one closes it ({@code expired}), so a row still {@code pending}
     * is one no money has arrived for. {@link Boost#abandonCheckout} re-checks that per row, and
     * {@code @Version} settles the last instant of the race against a webhook landing mid-sweep.
     *
     * <p>Nothing is written to {@code properties.boosted_until}: a window that never opened never
     * promoted anything, so there is no ranking mirror to unwind.
     *
     * @param cutoff boosts created before this instant have run out of checkout time; passed in so
     *               tests need not wait on a clock
     * @return how many boosts this call actually expired
     */
    @Override
    @Transactional
    public int expireAbandonedCheckouts(Instant cutoff) {
        List<Boost> stale = boosts.findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(
                BoostStatuses.PENDING, cutoff, Limit.of(MAX_PER_SWEEP));
        int expired = 0;
        for (Boost boost : stale) {
            if (boost.abandonCheckout()) {
                expired++;
                log.info("Boost {} expired: its checkout was opened at {} and never paid",
                        boost.getId(), boost.getCreatedAt());
            }
        }
        return expired;
    }

    /**
     * The one 409 the unpaid-order cap returns, whichever guard produced it (D160).
     *
     * <p>Both actions it names are real — the owner can finish the checkout they have, and the
     * abandoned-checkout sweep clears it within the hour if they do not. It also says "any of your
     * listings" explicitly, because an owner refused while looking at a listing they have never
     * boosted would otherwise have no way to guess where the held order is.
     */
    private ConflictException openUnpaidConflict() {
        return new ConflictException("You already have a boost waiting for payment on one of your "
                + "listings. Finish paying for it, or wait for it to expire — an unpaid boost is "
                + "cancelled automatically once its checkout has run out.");
    }

    /**
     * Whether this constraint violation is the open-unpaid cap rather than a genuine bug.
     *
     * <p>Matched on the index name in the driver's own message, because the same insert can trip
     * {@code uq_boosts_idempotency}, a foreign key or a not-null, and dressing those up as a
     * business rule would hide a defect behind a message that reads as if the system were working.
     * The match itself lives in {@link ConstraintViolations} — four services need the identical two
     * lines against four different index names (D170).
     */
    private static boolean isOpenUnpaidCollision(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, OPEN_UNPAID_INDEX);
    }

    /**
     * Create the gateway order for a priced pack. Called with no transaction open (D148).
     *
     * <p>Treats a blank order id as a refusal: without one the webhook can never find this row, so a
     * paid boost would never open. See {@code SubscriptionService.createOrder}.
     */
    private PaymentGateway.PaymentOrder createOrder(Opened opened) {
        PaymentGateway.PaymentOrder order =
                gateway.createOrder(opened.price(), opened.reference());
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return order;
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
