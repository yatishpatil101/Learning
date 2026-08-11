package com.punenest.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Which rate-limit store the configuration selects (tech-debt D158).
 *
 * <p>The property under test is not really "does it return the right class" — it is that none of the
 * ways this can be misconfigured ends in the platform quietly counting somewhere other than where
 * the operator believes it is.
 */
@DisplayName("Rate limit store selection (D158)")
class RateLimitStoreConfigTest {

    private static final Duration WINDOW = Duration.ofSeconds(60);
    private static final RedisEval REDIS = (script, keys, args) -> List.of(1L, 60_000L);

    @Test
    @DisplayName("defaults to counting in memory")
    void defaultsToMemory() {
        WriteRateLimitStore store =
                RateLimitStoreConfig.storeFactory("memory", null).create("w", 5, WINDOW);

        assertThat(store).isInstanceOf(InMemoryWriteRateLimitStore.class);
    }

    @Test
    @DisplayName("keeps the in-memory limiter working exactly as before")
    void inMemoryStillEnforces() {
        WriteRateLimitStore store =
                RateLimitStoreConfig.storeFactory("memory", null).create("w", 2, WINDOW);
        Instant now = Instant.parse("2026-01-01T00:00:00Z");

        assertThat(store.tryAcquire("ip:1", now)).isZero();
        assertThat(store.tryAcquire("ip:1", now)).isZero();
        assertThat(store.tryAcquire("ip:1", now)).isPositive();
        assertThat(store.tryAcquire("ip:2", now))
                .as("a different caller has their own budget")
                .isZero();
    }

    @Test
    @DisplayName("selects Redis when asked and a transport exists")
    void selectsRedis() {
        WriteRateLimitStore store =
                RateLimitStoreConfig.storeFactory("redis", REDIS).create("w", 5, WINDOW);

        assertThat(store).isInstanceOf(RedisWriteRateLimitStore.class);
    }

    @Test
    @DisplayName("refuses to start on redis with no transport, rather than falling back silently")
    void redisWithoutTransportFailsFast() {
        assertThatThrownBy(() -> RateLimitStoreConfig.storeFactory("redis", null))
                .as("a silent fallback hands back the multiplied budget the operator was fixing")
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("RedisEval");
    }

    @Test
    @DisplayName("rejects a typo instead of defaulting it to memory")
    void rejectsUnknownStore() {
        assertThatThrownBy(() -> RateLimitStoreConfig.storeFactory("redsi", REDIS))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("ignores surrounding whitespace and case, which YAML makes easy to introduce")
    void toleratesFormatting() {
        assertThat(RateLimitStoreConfig.storeFactory("  Redis ", REDIS).create("w", 5, WINDOW))
                .isInstanceOf(RedisWriteRateLimitStore.class);
    }
}
