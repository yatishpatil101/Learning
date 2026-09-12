package com.draazy.api.common.payments;

import java.time.Instant;

/**
 * A family of purchases that can be left half-finished at a payment gateway, and knows how to
 * retire the ones nobody came back to (D161).
 *
 * <p><strong>Why a port in the shared kernel.</strong> Three contexts open Cashfree orders —
 * {@code billing.plan}, {@code billing.boost} and {@code services.request} —
 * and every one of them needs the same timer. A scheduler that named them would have to import all
 * three, which {@code package-structure.md} §2 forbids the kernel from doing (and which
 * {@code ArchitectureBoundaryTest} fails the build over). Declaring the shape here and letting each
 * service implement it inverts that: the kernel depends on an abstraction, each feature depends on
 * the kernel, and {@link AbandonedCheckoutSweep} sweeps a family it has never heard of. The same
 * reasoning as {@code common.trust.ContactGate}.
 *
 * <p><strong>The signature is an instant and a count, and nothing else.</strong> No entity, no DTO,
 * nothing that could drag a feature's model into the kernel — again the {@code ContactGate} rule.
 *
 * <p><strong>Why the work stays in the service rather than moving here.</strong> The query is the
 * same shape at all four sites but the write is not: a stranded service request becomes
 * {@code cancelled} with a timeline entry, a boost becomes {@code expired}, a rent payment becomes
 * {@code failed} with a reason the tenant reads in their ledger. Generalising the trigger is worth
 * doing; generalising the transition would mean inventing a status vocabulary none of the four
 * share.
 *
 * <p><strong>One note on wiring.</strong> These four classes are injected elsewhere by concrete
 * type, and implementing an interface is what would ordinarily break that: a JDK dynamic proxy for
 * {@code @Transactional} implements only the interface, so {@code SubscriptionService} would no
 * longer be assignable. Spring Boot sets {@code spring.aop.proxy-target-class=true} by default, so
 * the proxies stay CGLIB subclasses and every existing injection point keeps working. Turning that
 * off would break this package, not just the AOP configuration.
 */
public interface AbandonedCheckouts {

    /**
     * The most rows any one family may retire in a single tick.
     *
     * <p>Unbounded, the first run after an outage would pull every stranded row in the table into
     * one transaction. That is slow, it holds locks for as long as it takes, and since these rows
     * are now version-checked, one webhook winning a race anywhere in that set rolls back the whole
     * thing — so a bigger batch is not merely slower, it is more likely to achieve nothing at all.
     *
     * <p>Five hundred every ten minutes drains three thousand rows an hour per family, which is far
     * beyond any backlog this platform can plausibly build up, while keeping a single transaction
     * small enough to be uninteresting. One number for all four for the same reason there is one
     * TTL: they are the same situation seen from four tables.
     */
    int MAX_PER_SWEEP = 500;

    /**
     * What this family is called in a log line — "subscription", "boost", "rent payment".
     *
     * <p>Exists because the sweep reports per family: without it, "expired 3" from a scheduler that
     * touches four tables tells an operator nothing about which one moved. Singular and lower-case,
     * so the sweep can pluralise it uniformly.
     */
    String family();

    /**
     * Retire every checkout in this family that was opened before {@code cutoff} and never paid for.
     *
     * <p><strong>Nothing paid may ever be touched.</strong> Each implementation proves that from its
     * own status filter — a settled payment has already moved the row out of the unpaid state — and
     * re-checks per row on the way past, so a webhook landing mid-sweep cannot be overwritten.
     *
     * <p>Bounded by {@link #MAX_PER_SWEEP}. A caller that returns exactly that many has more to do
     * and will do it on the next tick; nothing here is urgent enough to need draining in one pass.
     *
     * @param cutoff rows created before this instant have run out of checkout time. Passed in
     *               rather than read from the clock so a test can drive the whole lifecycle without
     *               waiting on one
     * @return how many rows this call actually moved, so a caller reporting "0" is telling the truth
     */
    int expireAbandonedCheckouts(Instant cutoff);
}
