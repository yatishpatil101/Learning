package com.punenest.api.security;

import java.time.Duration;
import java.time.Instant;

/**
 * Where the write rate limit's counters live (tech-debt D158).
 *
 * <p>{@link WriteRateLimiter} was written with exactly one public method — {@code tryAcquire(key,
 * now)} returning a retry hint — precisely so that moving the counter out of the JVM would be a swap
 * rather than a rewrite. This interface is that swap made explicit. Its contract is
 * {@code WriteRateLimiter}'s, unchanged and deliberately so: any store that returns a different
 * shape would force {@link WriteRateLimitFilter} to know which one it has, and a filter that
 * branches on its backend is a filter with two behaviours to test and one of them untested.
 *
 * <p><strong>The default is still in memory, and that is not a placeholder.</strong> With one
 * instance running, the in-memory counter is not an approximation of the right answer — it is the
 * right answer, and it costs a map lookup instead of a network round trip. This interface exists so
 * that starting a second instance is a configuration change rather than a code change; it does not
 * exist because the current implementation is wrong.
 */
public interface WriteRateLimitStore {

    /**
     * Count one request from {@code key} and say whether it may proceed.
     *
     * @return {@code 0} if the request is allowed, otherwise the whole seconds until the caller's
     *         window rolls over — the value for {@code Retry-After}, never below 1 so a client that
     *         obeys it exactly does not immediately earn a second 429
     */
    int tryAcquire(String key, Instant now);

    /**
     * Builds the stores a filter needs.
     *
     * <p>A factory rather than a bean per store because {@link WriteRateLimitFilter} needs two
     * independent budgets — ordinary callers and provider callbacks — and they must not share a
     * counter. The {@code namespace} is what keeps them apart, and it matters far more for a shared
     * backend than for a per-instance map: two instances of this application, or two applications,
     * pointed at one Redis would otherwise silently add their counts together.
     */
    @FunctionalInterface
    interface Factory {

        /**
         * @param namespace short, stable discriminator for this family of counters, e.g.
         *                  {@code "w"} for ordinary writes
         * @param budget    requests permitted per window, at least 1
         * @param window    length of the fixed window
         */
        WriteRateLimitStore create(String namespace, int budget, Duration window);
    }
}
