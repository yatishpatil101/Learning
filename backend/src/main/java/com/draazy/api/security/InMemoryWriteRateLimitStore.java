package com.draazy.api.security;

import java.time.Duration;
import java.time.Instant;

/**
 * The default store: {@link WriteRateLimiter}, unchanged, behind {@link WriteRateLimitStore}
 * (tech-debt D158).
 *
 * <p>Deliberately a thin adapter with no logic of its own. The eviction policy, the window
 * arithmetic, the single-monitor decision and the reasoning behind all three stay in
 * {@code WriteRateLimiter} where they were argued out; introducing the interface must not become an
 * excuse to move or "tidy" any of that, because the class is load-bearing and every line of it
 * answers a specific past defect.
 *
 * <p>The namespace is ignored rather than prefixed onto the key: this store is one map per instance
 * of this class, so the two families of counters are already separated by object identity. Prefixing
 * would be dead ceremony here and would make the in-memory and Redis key spaces differ in a way
 * nothing checks.
 */
public final class InMemoryWriteRateLimitStore implements WriteRateLimitStore {

    private final WriteRateLimiter delegate;

    public InMemoryWriteRateLimitStore(String namespace, int budget, Duration window) {
        this.delegate = new WriteRateLimiter(budget, window);
    }

    @Override
    public int tryAcquire(String key, Instant now) {
        return delegate.tryAcquire(key, now);
    }

    /** Visible for tests: how many callers are currently tracked. */
    int tracked() {
        return delegate.tracked();
    }
}
