package com.draazy.api.security;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A fixed-window request counter, keyed on whatever the caller decides identifies a client
 * (tech-debt D2).
 *
 * <p><strong>Why a fixed window and not a token bucket.</strong> The failure this guards is a script
 * discovering that every authenticated write is free — creating enquiries, offers, visits, reviews
 * and saved searches as fast as the network allows. A fixed window lets a caller spend the whole
 * budget in the last second of one window and again in the first second of the next, so the true
 * worst case is twice the budget across a window boundary. That is a well-known weakness and, here,
 * an acceptable one: the point is to bound the damage to a constant, not to smooth traffic. A bucket
 * would cost per-key refill arithmetic to improve a number already two orders of magnitude below
 * what a script wants.
 *
 * <p><strong>What this is not.</strong> It is in-memory and per-instance, so the effective limit is
 * the budget multiplied by the number of running instances, and it resets on deploy. Every
 * distributed limiter starts as this and then moves the counter to Redis; keeping the interface this
 * narrow — one {@link #tryAcquire} returning a retry hint — is what makes that a swap rather than a
 * rewrite. Recorded as D158 so the single-instance assumption is written down rather than assumed.
 *
 * <p><strong>Bounded by eviction, not by admission.</strong> The key space is caller-supplied, so an
 * attacker sourcing requests from many addresses — trivial on a routed IPv6 /64 — can push the map
 * to any size. An earlier version answered that by refusing to track new keys past a ceiling and
 * letting them through unlimited, which inverts the protection exactly when it is needed: the flood
 * would have switched the limiter off for every user who arrived after it, while the attacker's own
 * traffic kept the map full. This version evicts the least-recently-seen key instead, so enforcement
 * never stops. A flood can still evict a quiet legitimate caller's window early, which costs that
 * caller a reset budget — strictly better than costing everyone the limit entirely.
 *
 * <p><strong>One lock, deliberately.</strong> An earlier version used a {@code ConcurrentHashMap}
 * with per-counter monitors and swept expired entries inline. That had two defects worth recording:
 * the sweep walked the entire map on any request that presented a new key, so a flood turned each
 * cheap request into tens of thousands of lock acquisitions on the request thread; and a counter
 * could be removed by the sweep between the lookup and the lock, silently discarding the request
 * that had just been counted against it. Both were consequences of splitting the state across two
 * levels of locking to make an already-cheap operation cheaper. This class holds one monitor for a
 * few field assignments; writes are a small fraction of traffic, and correctness that can be read in
 * one pass is worth more here than uncontended reads.
 */
public class WriteRateLimiter {

    /**
     * Ceiling on distinct tracked callers.
     *
     * <p>Sized far above any plausible concurrent-writer count, so eviction is a response to abuse
     * rather than routine. Each entry is a short string plus two fields, so the cap costs single-digit
     * megabytes at worst.
     */
    private static final int MAX_TRACKED = 50_000;

    /**
     * Longest window that can be configured.
     *
     * <p>An upper bound matters for the same reason the lower one does, just later: a window of
     * {@code 99999999999999999} seconds binds and boots perfectly happily, then throws
     * {@code DateTimeException} out of {@code windowStart.plus(window)} on the first write — an
     * unhandled 500 on every mutating request, surfacing from a security filter rather than the API
     * envelope. A day is already far longer than any rate limit anyone would mean.
     */
    private static final Duration MAX_WINDOW = Duration.ofDays(1);

    private final int budget;
    private final Duration window;

    /**
     * Access-ordered, so the eldest entry is the least recently *used* rather than the least recently
     * inserted. That is the distinction that keeps an active caller tracked while a flood of
     * single-use keys churns through the tail.
     */
    private final Map<String, Counter> counters = new LinkedHashMap<>(256, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Counter> eldest) {
            return size() > MAX_TRACKED;
        }
    };

    public WriteRateLimiter(int budget, Duration window) {
        // Both misconfigurations fail silently and in opposite directions, which is why they are
        // rejected at construction rather than clamped: a zero or negative window makes every request
        // start a fresh window, so nothing is ever limited and the app looks healthy while the
        // control is off; a budget below one refuses every write on the platform. Neither should be
        // discoverable in production.
        if (budget < 1) {
            throw new IllegalArgumentException("rate-limit budget must be at least 1, got " + budget);
        }
        if (window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("rate-limit window must be positive, got " + window);
        }
        if (window.compareTo(MAX_WINDOW) > 0) {
            throw new IllegalArgumentException(
                    "rate-limit window must be at most " + MAX_WINDOW + ", got " + window);
        }
        this.budget = budget;
        this.window = window;
    }

    /**
     * Count one request from {@code key} and say whether it may proceed.
     *
     * @return {@code 0} if the request is allowed, otherwise the whole seconds until the caller's
     *         window rolls over — the value for {@code Retry-After}, never below 1 so a client that
     *         obeys it exactly does not immediately earn a second 429
     */
    public int tryAcquire(String key, Instant now) {
        synchronized (counters) {
            Counter counter = counters.computeIfAbsent(key, ignored -> new Counter(now));
            if (!now.isBefore(counter.windowStart.plus(window))) {
                counter.windowStart = now;
                counter.used = 0;
            }
            counter.used++;
            if (counter.used <= budget) {
                return 0;
            }
            long millis = Duration.between(now, counter.windowStart.plus(window)).toMillis();
            return (int) Math.max(1, (millis + 999) / 1000);
        }
    }

    /** Visible for tests: how many callers are currently tracked. */
    int tracked() {
        synchronized (counters) {
            return counters.size();
        }
    }

    private static final class Counter {
        private Instant windowStart;
        private int used;

        private Counter(Instant windowStart) {
            this.windowStart = windowStart;
        }
    }
}
