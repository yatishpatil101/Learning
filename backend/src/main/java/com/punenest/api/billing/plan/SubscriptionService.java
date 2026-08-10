package com.punenest.api.billing.plan;

import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.payments.AbandonedCheckouts;
import com.punenest.api.common.persistence.ConstraintViolations;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.PaymentGateway;
import com.punenest.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
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
 * Plans and the caller's subscription to one.
 *
 * <p><strong>The price comes from the plan, never from the request.</strong> {@code SubscribeRequest}
 * carries only a {@code planId}; the amount charged is read from the row. This is the same rule as
 * rent (spec fix S12) and for the same reason — a client that can name its own price eventually
 * will.
 *
 * <p><strong>Nothing here writes {@code active} for a paid plan.</strong> A priced subscription is
 * created {@link SubscriptionStatuses#PENDING} against a gateway order and only
 * {@link #applyWebhookOutcome} — reachable solely from the signature-verified payment webhook —
 * moves it on. A free plan is active immediately because there is no money to wait for.
 */
@Service
public class SubscriptionService implements AbandonedCheckouts {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    /**
     * How many unpaid orders one caller may hold open (D160).
     *
     * <p>One, because each opens a live gateway order and the legitimate need is exactly one: you
     * are either buying a plan right now or you are not. This is a cap on outstanding orders, not a
     * rate limit — {@code WriteRateLimitFilter} bounds how fast the endpoint may be called and does
     * nothing about the total, so a caller content to be slow was previously unbounded. Nor is
     * {@code Idempotency-Key} a defence: it is optional, and omitting it skips the replay branch
     * entirely.
     *
     * <p><strong>The value is mirrored by {@code uq_subscriptions_open_unpaid}</strong> (V44), which
     * is what actually holds the cap under concurrency. A unique index can only express "at most
     * one", so raising this constant means replacing that index too — otherwise this would wave a
     * second order through and the database would refuse it with a message about the first.
     */
    private static final int MAX_OPEN_UNPAID_PER_USER = 1;

    /**
     * The V44 partial unique index that enforces {@link #MAX_OPEN_UNPAID_PER_USER}.
     *
     * <p>Named here so its violation can be told apart from the idempotency index, a not-null or a
     * foreign key, and answered as the cap's own 409 rather than the generic "conflicts with
     * existing data".
     */
    private static final String OPEN_UNPAID_INDEX = "uq_subscriptions_open_unpaid";

    /** Terms are whole calendar periods in the customer's own timezone, not 365-day windows. */
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** Months in each {@code billingCycle}. An unrecognised cycle falls back to a year. */
    private static final int MONTHLY = 1;
    private static final int QUARTERLY = 3;
    private static final int YEARLY = 12;

    private final PlanRepository plans;
    private final SubscriptionRepository subscriptions;
    private final PlanMapper mapper;
    private final PaymentGateway gateway;
    private final UserRepository users;

    /**
     * Runs the two short transactions {@link #subscribe} is built from.
     *
     * <p>Built here rather than injected so the boundaries do not depend on which template bean the
     * context happens to hold, and used rather than splitting the work across two annotated methods
     * because a self-call would bypass the proxy and quietly produce one transaction again — the
     * exact bug being fixed, made invisible.
     *
     * <p>Propagation stays {@code REQUIRED} on purpose. In production nothing is in flight when the
     * endpoint is entered, so each block is genuinely its own transaction; under the test base
     * class's class-level {@code @Transactional} it joins the test's transaction instead, which
     * keeps per-test rollback working and avoids taking a second pooled connection while holding
     * the first.
     */
    private final TransactionTemplate transactions;

    public SubscriptionService(PlanRepository plans, SubscriptionRepository subscriptions,
            PlanMapper mapper, PaymentGateway gateway, UserRepository users,
            PlatformTransactionManager transactionManager) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.mapper = mapper;
        this.gateway = gateway;
        this.users = users;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /** {@code GET /plans} — public, fixed reference data, so a bare array (api-standards §5.1). */
    @Transactional(readOnly = true)
    public List<PlanDto> listPlans() {
        return mapper.toPlanDtos(plans.findAllByOrderByPriceAsc());
    }

    /**
     * {@code GET /me/subscription} — the caller's current subscription, or the empty document.
     *
     * <p>"Current" is the newest row that is still live. Cancelled and expired subscriptions stay in
     * the table as history and are never returned here.
     */
    @Transactional(readOnly = true)
    public SubscriptionDto getSubscription(AuthPrincipal caller) {
        return currentFor(caller.userId()).map(mapper::toDto).orElseGet(SubscriptionDto::none);
    }

    /**
     * {@code POST /me/subscription} (contract {@code subscribe}, spec fix S50) — 201.
     *
     * <p>A free plan returns {@code active}; a priced one returns {@code pending} with the gateway
     * order id in {@code paymentRef}. The caller's existing subscription is left alone in both
     * cases and is superseded only when the new one is actually paid for — an upgrade abandoned at
     * the checkout page must not cost someone the plan they already had.
     *
     * <p>{@code paymentMethod} is accepted and dropped: the column does not exist, and the method is
     * chosen on the gateway's own checkout page rather than here. Written down rather than implied.
     *
     * <p><strong>One unpaid order at a time</strong> (D160). A priced plan is refused with 409 while
     * the caller already holds a {@code pending} subscription, because each one opens a live gateway
     * order and nothing else bounded the total. The held order is visible in
     * {@code GET /me/subscription}, and the abandoned-checkout sweep clears it if the customer never
     * comes back, so the cap is measured in minutes rather than being a latch.
     *
     * <p><strong>Deliberately not {@code @Transactional}</strong> (D148). The pending row is
     * committed <em>before</em> the gateway order is opened, and the order id is attached in a
     * second transaction afterwards. Doing it the other way round — which is what this method used
     * to do — means any failure on the way to commit rolls the subscription away while the order it
     * created stays live at Cashfree: the customer can still be charged, and the callback then
     * matches no row. Committing first inverts the risk into one we can actually repair, and
     * {@link #abandon} repairs it.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    public SubscriptionDto subscribe(AuthPrincipal caller, SubscribeRequest body,
            String idempotencyKey) {
        String key = blankToNull(idempotencyKey);
        Opened opened = transactions.execute(tx -> open(caller, body, key));

        if (opened.settled() != null) {
            // A replay, or a free plan: no money, so nothing to open and nothing to attach.
            return opened.settled();
        }

        PaymentGateway.PaymentOrder order;
        try {
            order = createOrder(opened);
            return transactions.execute(tx -> attach(opened.subscriptionId(), order));
        } catch (RuntimeException checkoutFailed) {
            // The attach is inside the guard, not only the gateway call. If the second transaction
            // dies — pool exhaustion, a connection reset, a SIGTERM mid-deploy — the pending row
            // survives holding the client's derived key `sub:<planId>`, and every later attempt then
            // replays that dead row and returns it with no paymentSessionId. The customer is shown a
            // payment in progress they can never finish, on that plan, forever; nothing sweeps it.
            abandon(opened);
            throw checkoutFailed;
        }
    }

    /**
     * First transaction: settle everything that can be settled without money, and otherwise commit
     * the pending row the gateway order will be opened against.
     *
     * @return either a finished response, or the handle {@link #subscribe} needs to open an order
     */
    private Opened open(AuthPrincipal caller, SubscribeRequest body, String key) {
        if (key != null) {
            Optional<Subscription> replay =
                    subscriptions.findByUserIdAndIdempotencyKey(caller.userId(), key);
            if (replay.isPresent()) {
                return Opened.settled(mapper.toDto(replay.get()));
            }
        }

        Plan plan = Ids.parseUuid(body.planId())
                .flatMap(plans::findById)
                .orElseThrow(() -> NotFoundException.of("Plan"));

        Instant now = Instant.now();
        boolean free = plan.getPrice() <= 0;

        if (!free) {
            // Each priced subscription opens a live gateway order, and nothing else bounds the
            // total: the rate limiter caps the speed, and Idempotency-Key is optional, so a loop
            // that simply omits the header opened unbounded real orders (D160). One open unpaid
            // order is the whole legitimate need, and the existing one is visible in
            // GET /me/subscription as `pending`, so this points at something the caller can act on
            // rather than a wall.
            //
            // This count is the fast path, not the guarantee: it is an unlocked read over rows that
            // do not exist yet, so N concurrent creates all see zero. It stays because it produces
            // the better message on the ordinary double click; uq_subscriptions_open_unpaid, caught
            // below, is what holds under concurrency.
            long openUnpaid = subscriptions.countByUserIdAndStatus(
                    caller.userId(), SubscriptionStatuses.PENDING);
            if (openUnpaid >= MAX_OPEN_UNPAID_PER_USER) {
                throw openUnpaidConflict();
            }
        }

        Subscription subscription = new Subscription(
                caller.userId(),
                plan.getId(),
                free ? SubscriptionStatuses.ACTIVE : SubscriptionStatuses.PENDING,
                now,
                free ? renewalFrom(now, plan.getBillingCycle()) : null,
                null,
                key);
        Subscription saved;
        try {
            saved = subscriptions.saveAndFlush(subscription);
        } catch (DataIntegrityViolationException violation) {
            // Only the cap's own index is translated. Everything else is rethrown untouched --
            // including uq_subscriptions_idempotency (V23), which GlobalExceptionHandler answers as
            // a generic 409, and which deliberately has no recovery here: Hibernate poisons the
            // persistence context when a constraint fires, so re-reading the winning row is
            // impossible from inside this transaction.
            if (isOpenUnpaidCollision(violation)) {
                log.info("Concurrent subscribe lost the open-unpaid race for {}", caller.userId());
                throw openUnpaidConflict();
            }
            throw violation;
        }
        if (free) {
            supersedeOthers(caller.userId(), saved.getId());
            return Opened.settled(mapper.toDto(saved));
        }
        // why here: this is the last transaction that will be open, and the gateway call must not
        // hold a connection while it waits on the network.
        String phone = users.findById(caller.userId()).map(User::getMobile).orElse(null);
        return new Opened(null, saved.getId(), plan.getPrice(),
                "subscription:" + caller.userId() + ":" + plan.getId(),
                new PaymentGateway.Customer(caller.userId().toString(), phone));
    }

    /**
     * Second transaction: record the order the committed row is now waiting on.
     *
     * <p>The row cannot legitimately be missing — it was committed a moment ago and nothing deletes
     * subscriptions — so its absence means a concurrent write nobody has modelled, and the loud
     * failure is preferable to returning a checkout that will never settle against anything.
     */
    private SubscriptionDto attach(UUID subscriptionId, PaymentGateway.PaymentOrder order) {
        Subscription subscription = subscriptions.findById(subscriptionId)
                .orElseThrow(() -> new IllegalStateException("Subscription " + subscriptionId
                        + " disappeared before gateway order " + order.orderId()
                        + " could be attached"));
        if (!subscription.attachOrder(order.orderId())) {
            log.error("Subscription {} would not take gateway order {}; it is {} with ref {}",
                    subscriptionId, order.orderId(), subscription.getStatus(),
                    subscription.getPaymentRef());
        }
        Subscription saved = subscriptions.saveAndFlush(subscription);
        // The session id is single-use and lives only in this response: the checkout SDK consumes
        // it, and the payment webhook - not any stored id - is what later activates the plan.
        return mapper.toDto(saved).withPaymentSessionId(order.paymentSessionId());
    }

    /**
     * Compensating write for a gateway that refused the order after the row was committed (D148).
     *
     * <p>The subscription is cancelled rather than left pending because the customer can never reach
     * a checkout for it: the session id only exists on the success path, so an order that was never
     * returned is unreachable even if one somehow exists at the gateway. A pending row would instead
     * be reported by {@code GET /me/subscription} as an order in progress that nobody can finish.
     *
     * <p><strong>A failure to compensate must not replace the failure being compensated.</strong>
     * The caller needs the gateway's error; this one is logged for us and swallowed.
     */
    private void abandon(Opened opened) {
        try {
            transactions.executeWithoutResult(tx -> subscriptions.findById(opened.subscriptionId())
                    .ifPresent(Subscription::abandonUnopened));
            log.error("No gateway order for subscription {} ({}); cancelled it and released the "
                    + "idempotency key. Nothing was charged.",
                    opened.subscriptionId(), opened.reference());
        } catch (RuntimeException compensationFailed) {
            log.error("Could not cancel subscription {} after its gateway order failed; it will sit "
                    + "pending with an idempotency key that replays this dead row",
                    opened.subscriptionId(), compensationFailed);
        }
    }

    /**
     * What survives the first transaction: either a finished response, or plain values describing
     * the order to open.
     *
     * <p>Everything here is detached by design. No entity crosses a transaction boundary, so nothing
     * can be lazily touched outside one.
     */
    private record Opened(SubscriptionDto settled, UUID subscriptionId, long price,
            String reference, PaymentGateway.Customer customer) {

        static Opened settled(SubscriptionDto dto) {
            return new Opened(dto, null, 0, null, null);
        }
    }

    /**
     * Apply a terminal outcome from the payment webhook. Reachable only after an HMAC check.
     *
     * <p>An order id this table never issued is ignored, not failed: the same callback endpoint
     * serves rent, boosts and subscriptions, so most of what arrives here belongs to someone else.
     *
     * @param orderId the gateway order id, matched against {@code payment_ref}
     * @param paid    whether the money actually moved
     * @param paidAt  when the gateway confirmed; the subscription term is dated from this
     * @return whether this table owned the order — the fan-out alerts on a paid event nobody claims
     */
    @Transactional
    public boolean applyWebhookOutcome(String orderId, boolean paid, Instant paidAt) {
        if (orderId == null || orderId.isBlank()) {
            return false;
        }
        Optional<Subscription> found = subscriptions.findByPaymentRef(orderId);
        if (found.isEmpty()) {
            return false;
        }
        Subscription subscription = found.get();
        if (!paid) {
            if (subscription.fail()) {
                log.info("Subscription {} cancelled: payment failed", subscription.getId());
            }
            return true;
        }
        Optional<Plan> plan = plans.findById(subscription.getPlanId());
        String cycle = plan.map(Plan::getBillingCycle).orElse(null);
        if (plan.isEmpty()) {
            // D62: the plan row vanished between purchase and callback. The subscription still
            // activates -- the customer paid -- but on the fallback term, so a wrong term would
            // otherwise look exactly like a correct one. Warn so it does not.
            log.warn("Plan {} not found while settling subscription {}; granting the default "
                    + "{}-month term instead of the purchased one",
                    subscription.getPlanId(), subscription.getId(), YEARLY);
        } else if (monthsIn(cycle) == YEARLY && !"yearly".equals(cycle)) {
            log.warn("Plan {} has billing cycle {} which is not one of monthly/quarterly/yearly; "
                    + "granting {} months on subscription {}",
                    subscription.getPlanId(), cycle, YEARLY, subscription.getId());
        }
        if (!subscription.activate(paidAt, renewalFrom(paidAt, cycle))) {
            reportRefusedSettlement(subscription);
            return true;
        }
        supersedeOthers(subscription.getUserId(), subscription.getId());
        log.info("Subscription {} activated by provider callback", subscription.getId());
        return true;
    }

    /**
     * Say what it means that a paid callback could not be applied — and say it at the right volume.
     *
     * <p><strong>Why this stopped being one log line (D161).</strong> Before the abandoned-checkout
     * sweep existed there was only one way a subscription could reach a settled state, and that was
     * this very method, so a refused settlement was always a redelivery of a callback already
     * applied: harmless, and correctly INFO. The sweep adds a second route to a terminal status, one
     * that means the opposite — the row was retired unpaid, and money has now arrived against it.
     * That is a customer charged for a plan they do not have, and it was being written to the log in
     * the same words, at the same level, as the routine case. {@code PaymentWebhookController}
     * cannot rescue it either: this method returns {@code true} (the order *is* ours), so its
     * "unreconciled" alarm — which exists for precisely this — never fires.
     *
     * <p>The status tells the two apart with no extra state: entitling means the customer has what
     * they paid for and this is a duplicate; anything else means we hold their money and granted
     * nothing. The {@code ERROR} carries the gateway order id because that is the key an operator
     * needs to find the payment and refund or reconcile it.
     */
    private void reportRefusedSettlement(Subscription subscription) {
        if (SubscriptionStatuses.isEntitling(subscription.getStatus())) {
            log.info("Ignored payment callback for subscription {}: already {}",
                    subscription.getId(), subscription.getStatus());
            return;
        }
        log.error("Payment settled for subscription {} but it is {} — the customer has been charged "
                + "and holds no plan. Gateway order {}, user {}. Refund or reconcile.",
                subscription.getId(), subscription.getStatus(), subscription.getPaymentRef(),
                subscription.getUserId());
    }

    /**
     * Expire every subscription whose term has run out (D57). Driven by {@link SubscriptionSweep}.
     *
     * <p><strong>This job is bookkeeping, not the entitlement rule.</strong> {@link #currentFor}
     * already refuses to report a lapsed row, so a plan stops entitling the instant its term ends
     * whether or not the sweep has run. Were it the other way round, the window between ticks would
     * be a window in which an unpaid plan still worked — a smaller version of exactly the defect
     * D57 records. What the sweep adds is a truthful stored status, so history, support screens and
     * any future finance report do not have to re-derive "was this really still active?".
     *
     * <p>Runs in one transaction: the sweep is small (only rows past their renewal), and a partial
     * commit would leave the table in a state no reader could interpret.
     *
     * @param now the instant to judge terms against; passed in so tests need not wait on a clock
     * @return how many subscriptions this call actually ended
     */
    @Transactional
    public int expireLapsed(Instant now) {
        List<Subscription> lapsed = subscriptions
                .findByStatusAndRenewsAtLessThanEqual(SubscriptionStatuses.ACTIVE, now);
        int ended = 0;
        for (Subscription subscription : lapsed) {
            if (subscription.expire(now)) {
                ended++;
                log.info("Subscription {} expired: term ended {}",
                        subscription.getId(), subscription.getRenewsAt());
            }
        }
        return ended;
    }

    /** {@inheritDoc} — "subscription", so a sweep log line names the table that moved. */
    @Override
    public String family() {
        return "subscription";
    }

    /**
     * Cancel every checkout that was opened and then walked away from (D161). Driven by
     * {@code AbandonedCheckoutSweep}.
     *
     * <p><strong>Why this had to exist.</strong> D148 made {@link #subscribe} commit the pending row
     * before opening the gateway order, and {@link #abandon} compensates when the gateway refuses.
     * That compensation runs in the same process, so it covers an exception and not a hard kill: a
     * SIGKILL or an OOM between the commit and the gateway call leaves a pending row with no order
     * behind it and nothing to clean it up. Closing the Cashfree modal leaves the same shape with an
     * order that generates no webhook. Either way the row sat forever, reported by
     * {@code GET /me/subscription} as an order in progress that nobody could finish — and once D160
     * added the one-open-unpaid cap, it also closed plan purchases to that customer permanently.
     * The cap and this sweep are one mechanism: the cap without it is a latch.
     *
     * <p><strong>Nothing paid is ever touched.</strong> The status filter is the proof: a settled
     * payment moves the subscription to {@code active} and a refused one to {@code cancelled}, so a
     * row still {@code pending} is one no money has arrived for. The status is re-checked per row on
     * the way past — {@link Subscription#abandonCheckout} does it — so a webhook settling mid-sweep
     * is not overwritten, and {@code @Version} settles the last instant of that race.
     *
     * <p>Runs in one transaction, like {@link #expireLapsed}: the set is small (only rows past the
     * TTL) and a partial commit would leave a state no reader could interpret.
     *
     * @param cutoff subscriptions created before this instant have run out of checkout time; passed
     *               in so tests need not wait on a clock
     * @return how many subscriptions this call actually cancelled
     */
    @Override
    @Transactional
    public int expireAbandonedCheckouts(Instant cutoff) {
        List<Subscription> stale = subscriptions
                .findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(
                        SubscriptionStatuses.PENDING, cutoff, Limit.of(MAX_PER_SWEEP));
        int expired = 0;
        for (Subscription subscription : stale) {
            if (subscription.abandonCheckout()) {
                expired++;
                log.info("Subscription {} cancelled: its checkout was opened at {} and never paid",
                        subscription.getId(), subscription.getCreatedAt());
            }
        }
        return expired;
    }

    /**
     * The one 409 the unpaid-order cap returns, whichever guard produced it (D160).
     *
     * <p>Both actions it names are real, which is the standard D152 set for this family of
     * messages: the customer can finish the checkout they already have, and if they do not, the
     * abandoned-checkout sweep clears it within the hour. A message naming an action the customer
     * cannot take is worse than no message, because it reads as though they are being told to do
     * something and failing.
     */
    private ConflictException openUnpaidConflict() {
        return new ConflictException("You already have a subscription order waiting for payment. "
                + "Finish paying for it, or wait for it to expire — an unpaid order is cancelled "
                + "automatically once its checkout has run out.");
    }

    /**
     * Whether this constraint violation is the open-unpaid cap rather than a genuine bug.
     *
     * <p>Matched on the index name in the driver's own message, because the same insert can also
     * trip {@code uq_subscriptions_idempotency}, a foreign key or a not-null. Translating those into
     * "you already have an unpaid order" would hide a defect behind a business rule that reads as if
     * the system were working. The match itself lives in {@link ConstraintViolations} — four
     * services need the identical two lines against four different index names (D170).
     */
    private static boolean isOpenUnpaidCollision(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, OPEN_UNPAID_INDEX);
    }

    /**
     * The subscription {@code GET /me/subscription} should report.
     *
     * <p><strong>An entitling row wins over a newer pending one.</strong> Otherwise a user who
     * started an upgrade and closed the tab would be told their plan is {@code pending} with no
     * renewal date — reading as though the plan they had already paid for had evaporated, which is
     * exactly what {@link #subscribe} takes care not to do. A {@code pending} row is still returned
     * when it is all the user has, so a first-time subscriber can find and resume their order.
     *
     * <p><strong>A lapsed row is not live</strong> (D57), even while it still says {@code active}
     * in the database. Entitlement is decided against the clock here rather than against the stored
     * status, so it cannot depend on how recently the sweep happened to run.
     */
    private Optional<Subscription> currentFor(java.util.UUID userId) {
        Instant now = Instant.now();
        List<Subscription> live = subscriptions.findByUserIdOrderByStartedAtDesc(userId).stream()
                .filter(s -> SubscriptionStatuses.isLive(s.getStatus()) && !s.hasLapsed(now))
                .toList();
        return live.stream()
                .filter(s -> SubscriptionStatuses.isEntitling(s.getStatus()))
                .findFirst()
                .or(() -> live.stream().findFirst());
    }

    /**
     * Cancel every other live subscription the user holds, leaving {@code keepId} standing.
     *
     * <p>Called only once a subscription is genuinely in force. Without it an upgrade would leave
     * two live rows and "which plan am I on?" would be answered by whichever sorted first.
     */
    private void supersedeOthers(java.util.UUID userId, java.util.UUID keepId) {
        for (Subscription other : subscriptions.findByUserIdOrderByStartedAtDesc(userId)) {
            if (!other.getId().equals(keepId) && other.supersede()) {
                log.info("Subscription {} superseded by {}", other.getId(), keepId);
            }
        }
    }

    /**
     * Create the gateway order for a priced plan. Called with no transaction open (D148).
     *
     * <p>Fails loudly on a gateway that returns no order id. The order id is how the webhook finds
     * this row again, so a subscription left without one can never be activated — the callback would
     * arrive, match nothing, and a subscriber who has actually paid would sit unsubscribed forever.
     * Treating a blank id as a refusal routes it into {@link #abandon} with everything else.
     */
    private PaymentGateway.PaymentOrder createOrder(Opened opened) {
        PaymentGateway.PaymentOrder order =
                gateway.createOrder(opened.price(), opened.reference(), opened.customer());
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return order;
    }

    /** End of one paid term, measured in whole calendar months from {@code from}. */
    private static Instant renewalFrom(Instant from, String billingCycle) {
        ZonedDateTime start = from.atZone(IST);
        return start.plusMonths(monthsIn(billingCycle)).toInstant();
    }

    private static int monthsIn(String billingCycle) {
        if ("monthly".equals(billingCycle)) {
            return MONTHLY;
        }
        if ("quarterly".equals(billingCycle)) {
            return QUARTERLY;
        }
        // why yearly for anything else: it is the longest term, so a mis-seeded cycle over-serves
        // the customer rather than silently cutting a paid year short.
        return YEARLY;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
