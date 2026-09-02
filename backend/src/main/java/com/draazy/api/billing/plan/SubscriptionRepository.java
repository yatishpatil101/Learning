package com.draazy.api.billing.plan;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

/** The caller's subscriptions, and the webhook's lookup by gateway order id. */
public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {

    /**
     * The caller's subscriptions, newest first. Serves {@code idx_subscriptions_user_started} (V23).
     *
     * <p>Returns the list rather than one row because the current subscription is "the newest live
     * one" and the filter is a domain rule ({@link SubscriptionStatuses#isLive}) rather than a
     * column value — encoding the status set into a derived query name would put the vocabulary in
     * two places.
     */
    List<Subscription> findByUserIdOrderByStartedAtDesc(UUID userId);

    /** The payment webhook's key. Unique in the DB (V23). */
    Optional<Subscription> findByPaymentRef(String paymentRef);

    /** Replays a client's {@code Idempotency-Key}. Unique per user (V23). */
    Optional<Subscription> findByUserIdAndIdempotencyKey(UUID userId, String idempotencyKey);

    /**
     * Subscriptions whose paid term has run out but which still claim to be running (D57).
     *
     * <p>Named against the column rather than filtered in memory because this is the one query that
     * reads the whole table instead of one user's rows: every {@code active} subscription on the
     * platform would otherwise be loaded on every tick of the sweep.
     *
     * <p>{@code LessThanEqual} matches {@link Subscription#hasLapsed} — the renewal instant belongs
     * to the next term, not this one.
     */
    List<Subscription> findByStatusAndRenewsAtLessThanEqual(String status, Instant cutoff);

    /**
     * How many unpaid orders this caller is already holding open (D160).
     *
     * <p>Every one of these opened a live gateway order. Without a ceiling, a script calling
     * {@code POST /me/subscription} in a loop opens unbounded real orders against our merchant
     * account at no cost to itself — omitting {@code Idempotency-Key} skips the replay branch
     * entirely, so the header is no defence.
     *
     * <p><strong>This count is the fast path, not the guarantee.</strong> It is a read with no lock
     * over rows that do not exist yet, so two concurrent creates both see zero and both insert. What
     * actually holds the cap is {@code uq_subscriptions_open_unpaid} (V44); this stays because it
     * produces the better message on the ordinary double click.
     */
    long countByUserIdAndStatus(UUID userId, String status);

    /**
     * Checkouts opened before {@code cutoff} and still unpaid — the sweep's input (D161).
     *
     * <p>The status filter is also the never-paid proof: a settled payment moves the subscription to
     * {@code active} and a refused one to {@code cancelled}, so a row still {@code pending} is one no
     * money has arrived for, whether or not it carries a gateway order id.
     *
     * <p>Ordered oldest-first and taken a {@code batch} at a time. Both matter: with a limit, the
     * order decides <em>which</em> rows get retired, and oldest-first drains a backlog as a queue
     * rather than starving the rows that have waited longest. The limit itself bounds a first run
     * after a long outage, which would otherwise pull every stranded row into one transaction — and
     * since {@code Subscription} is version-checked, a single lost race there would roll back the
     * whole batch instead of the few hundred rows the next tick will pick up anyway.
     */
    List<Subscription> findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(String status,
            Instant cutoff, Limit batch);
}
