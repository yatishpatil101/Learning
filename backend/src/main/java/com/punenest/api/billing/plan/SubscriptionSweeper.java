package com.punenest.api.billing.plan;

import com.punenest.api.common.payments.AbandonedCheckouts;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The two background sweeps that end a subscription nobody is going to finish: terms that have run
 * out (D57) and checkouts that were opened and walked away from (D161).
 *
 * <p>Split out of {@link SubscriptionService}, which had grown past the size guard. The seam is a
 * real one rather than a convenient cut: everything here is <em>time</em> acting on rows that are
 * already settled, driven by a scheduler with no caller and no request, while the service it left
 * behind is the customer-facing checkout — a caller, a price, a gateway order, a webhook. They share
 * a table and nothing else, which is why this class needs only the repository and none of the
 * gateway, mapper, user or transaction-template machinery the checkout depends on.
 *
 * <p><strong>Neither sweep is the entitlement rule.</strong> {@code SubscriptionService} already
 * refuses to report a lapsed row, so a plan stops entitling the instant its term ends whether or not
 * this has run. Were it the other way round, the gap between ticks would be a window in which an
 * unpaid plan still worked.
 */
@Service
public class SubscriptionSweeper implements AbandonedCheckouts {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionSweeper.class);

    private final SubscriptionRepository subscriptions;

    public SubscriptionSweeper(SubscriptionRepository subscriptions) {
        this.subscriptions = subscriptions;
    }

    /**
     * Expire every subscription whose term has run out (D57). Driven by {@link SubscriptionSweep}.
     *
     * <p><strong>This job is bookkeeping, not the entitlement rule.</strong> A plan stops entitling
     * the instant its term ends whether or not the sweep has run — see the class note. What the
     * sweep adds is a truthful stored status, so history, support screens and any future finance
     * report do not have to re-derive "was this really still active?".
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
     * <p><strong>Why this had to exist.</strong> D148 made {@code SubscriptionService.subscribe}
     * commit the pending row before opening the gateway order, and its own compensation path covers
     * a gateway refusal. That compensation runs in the same process, so it covers an exception and
     * not a hard kill: a SIGKILL or an OOM between the commit and the gateway call leaves a pending
     * row with no order behind it and nothing to clean it up. Closing the Cashfree modal leaves the
     * same shape with an order that generates no webhook. Either way the row sat forever, reported
     * by {@code GET /me/subscription} as an order in progress that nobody could finish — and once
     * D160 added the one-open-unpaid cap, it also closed plan purchases to that customer
     * permanently. The cap and this sweep are one mechanism: the cap without it is a latch.
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
}
