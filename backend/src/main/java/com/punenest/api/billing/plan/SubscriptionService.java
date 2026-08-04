package com.punenest.api.billing.plan;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.provider.PaymentGateway;
import com.punenest.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

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

    public SubscriptionService(PlanRepository plans, SubscriptionRepository subscriptions,
            PlanMapper mapper, PaymentGateway gateway) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.mapper = mapper;
        this.gateway = gateway;
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
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    @Transactional
    public SubscriptionDto subscribe(AuthPrincipal caller, SubscribeRequest body,
            String idempotencyKey) {
        String key = blankToNull(idempotencyKey);
        if (key != null) {
            Optional<Subscription> replay =
                    subscriptions.findByUserIdAndIdempotencyKey(caller.userId(), key);
            if (replay.isPresent()) {
                return mapper.toDto(replay.get());
            }
        }

        Plan plan = Ids.parseUuid(body.planId())
                .flatMap(plans::findById)
                .orElseThrow(() -> NotFoundException.of("Plan"));

        Instant now = Instant.now();
        boolean free = plan.getPrice() <= 0;
        String orderId = free ? null : createOrder(caller, plan);

        Subscription subscription = new Subscription(
                caller.userId(),
                plan.getId(),
                free ? SubscriptionStatuses.ACTIVE : SubscriptionStatuses.PENDING,
                now,
                free ? renewalFrom(now, plan.getBillingCycle()) : null,
                orderId,
                key);
        // No catch on the unique index: Hibernate poisons the persistence context when a
        // constraint fires, so re-reading the winner here is impossible. The race is settled by
        // uq_subscriptions_idempotency (V23) and answered as a 409 by GlobalExceptionHandler.
        Subscription saved = subscriptions.saveAndFlush(subscription);
        if (free) {
            supersedeOthers(caller.userId(), saved.getId());
        }
        return mapper.toDto(saved);
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
     */
    @Transactional
    public void applyWebhookOutcome(String orderId, boolean paid, Instant paidAt) {
        if (orderId == null || orderId.isBlank()) {
            return;
        }
        Optional<Subscription> found = subscriptions.findByPaymentRef(orderId);
        if (found.isEmpty()) {
            return;
        }
        Subscription subscription = found.get();
        if (!paid) {
            if (subscription.fail()) {
                log.info("Subscription {} cancelled: payment failed", subscription.getId());
            }
            return;
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
            // why: a redelivered callback on a subscription that is already settled. Expected.
            log.info("Ignored payment callback for subscription {}: already {}",
                    subscription.getId(), subscription.getStatus());
            return;
        }
        supersedeOthers(subscription.getUserId(), subscription.getId());
        log.info("Subscription {} activated by provider callback", subscription.getId());
    }

    /**
     * The subscription {@code GET /me/subscription} should report.
     *
     * <p><strong>An entitling row wins over a newer pending one.</strong> Otherwise a user who
     * started an upgrade and closed the tab would be told their plan is {@code pending} with no
     * renewal date — reading as though the plan they had already paid for had evaporated, which is
     * exactly what {@link #subscribe} takes care not to do. A {@code pending} row is still returned
     * when it is all the user has, so a first-time subscriber can find and resume their order.
     */
    private Optional<Subscription> currentFor(java.util.UUID userId) {
        List<Subscription> live = subscriptions.findByUserIdOrderByStartedAtDesc(userId).stream()
                .filter(s -> SubscriptionStatuses.isLive(s.getStatus()))
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
     * Create the gateway order for a priced plan.
     *
     * <p>Fails loudly on a gateway that returns no order id. The order id is how the webhook finds
     * this row again, so a subscription stored without one can never be activated — the callback
     * would arrive, match nothing, and a subscriber who has actually paid would sit unsubscribed
     * forever. Failing before anything is persisted is the only outcome that does not strand money.
     */
    private String createOrder(AuthPrincipal caller, Plan plan) {
        PaymentGateway.PaymentOrder order = gateway.createOrder(plan.getPrice(),
                "subscription:" + caller.userId() + ":" + plan.getId());
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return order.orderId();
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
