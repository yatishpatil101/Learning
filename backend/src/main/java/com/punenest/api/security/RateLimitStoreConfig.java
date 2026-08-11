package com.punenest.api.security;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Chooses where the write rate limit counts (tech-debt D158).
 *
 * <p>{@code memory} is the default and stays the default. One instance is what runs, and for one
 * instance the in-memory counter is not a compromise — it is the correct answer at the cost of a map
 * lookup. This exists so that starting a second instance is a line of configuration rather than a
 * code change.
 *
 * <p><strong>Selecting {@code redis} without a transport fails at startup, on purpose.</strong> The
 * tempting alternative is to log a warning and fall back to memory, and it is the worse of the two
 * by some distance: the operator who set {@code store=redis} did so because a second instance is
 * running, and a silent fallback gives them exactly the multiplied budget they were trying to fix
 * while telling them it is fixed. That is D158 again, now with a configuration flag claiming
 * otherwise. Refusing to boot is the honest answer and it happens where someone can act on it.
 */
@Configuration
public class RateLimitStoreConfig {

    static final String MEMORY = "memory";
    static final String REDIS = "redis";

    /**
     * @param store       {@code memory} (default) or {@code redis}
     * @param redisEvals  the Redis transport, if one is on the classpath and configured. An
     *                    {@code ObjectProvider} rather than an optional bean parameter so that
     *                    "there is no such bean" is an ordinary value to test rather than a context
     *                    failure with a message about an unsatisfied dependency
     */
    @Bean
    public WriteRateLimitStore.Factory writeRateLimitStores(
            @Value("${punenest.ratelimit.store:" + MEMORY + "}") String store,
            ObjectProvider<RedisEval> redisEvals) {
        return storeFactory(store, redisEvals.getIfAvailable());
    }

    /** Visible for tests, which need to exercise both branches without building a context. */
    static WriteRateLimitStore.Factory storeFactory(String store, RedisEval redisEval) {
        String choice = store == null ? MEMORY : store.trim().toLowerCase(java.util.Locale.ROOT);
        if (MEMORY.equals(choice)) {
            return InMemoryWriteRateLimitStore::new;
        }
        if (REDIS.equals(choice)) {
            if (redisEval == null) {
                throw new IllegalStateException(
                        "punenest.ratelimit.store=redis but no RedisEval bean is available. A Redis "
                                + "client cannot currently be added to this build offline (see "
                                + "RedisEval for the dependency detail), so the shared-counter store "
                                + "has no transport yet. Use punenest.ratelimit.store=memory until "
                                + "one is wired.");
            }
            return (namespace, budget, window) ->
                    new RedisWriteRateLimitStore(redisEval, namespace, budget, window);
        }
        // An unrecognised value is rejected rather than defaulted. Defaulting would make a typo —
        // `redsi`, `Redis-cluster` — silently select the store the operator was trying to move away
        // from, which is the one misconfiguration this setting exists to prevent.
        throw new IllegalArgumentException(
                "punenest.ratelimit.store must be '" + MEMORY + "' or '" + REDIS + "', got: " + store);
    }
}
