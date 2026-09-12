package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The Redis-backed write rate limit (tech-debt D158), against a scripted fake.
 *
 * <p><strong>What this proves, and what it does not.</strong> There is no Redis server in this
 * project and no Testcontainers, so nothing here touches a real one. What is verified is everything
 * on this side of the wire: that exactly one command is issued per request, that the command is a
 * script containing the increment, the expiry and the remaining-time read together, that the count
 * is compared against the budget correctly at the boundary, that the retry hint is derived from the
 * key's actual remaining time, that the two families of counters use different keys, and that an
 * unavailable Redis degrades to per-instance counting rather than to nothing.
 *
 * <p>What it cannot prove is that the Lua is valid Lua, that Redis accepts it, that the reply really
 * arrives as two integers, or that the script is atomic in practice. Those are properties of the
 * server, and the fake will agree with whatever this class assumes — including if the assumption is
 * wrong. The atomicity argument here rests on Redis's documented execution model, not on this test.
 */
@DisplayName("Redis write rate limit store (D158)")
class RedisWriteRateLimitStoreTest {

    private static final Duration WINDOW = Duration.ofSeconds(60);
    private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");

    /** A fake Redis that counts per key and reports a fixed remaining time. */
    private static final class FakeRedis implements RedisEval {

        private final List<String> keysSeen = new ArrayList<>();
        private final List<String> scriptsSeen = new ArrayList<>();
        private final AtomicInteger count = new AtomicInteger();
        private long remainingMillis = WINDOW.toMillis();

        @Override
        public List<Long> eval(String script, List<String> keys, List<String> args) {
            scriptsSeen.add(script);
            keysSeen.add(keys.get(0));
            return List.of((long) count.incrementAndGet(), remainingMillis);
        }
    }

    private static RedisWriteRateLimitStore store(RedisEval redis, int budget) {
        return new RedisWriteRateLimitStore(redis, "w", budget, WINDOW);
    }

    @Test
    @DisplayName("allows requests up to the budget and refuses the one after")
    void enforcesTheBudgetAtTheBoundary() {
        FakeRedis redis = new FakeRedis();
        RedisWriteRateLimitStore store = store(redis, 3);

        assertThat(store.tryAcquire("ip:1", NOW)).isZero();
        assertThat(store.tryAcquire("ip:1", NOW)).isZero();
        assertThat(store.tryAcquire("ip:1", NOW))
                .as("the third of a budget of three is still inside it")
                .isZero();
        assertThat(store.tryAcquire("ip:1", NOW))
                .as("the fourth is not")
                .isPositive();
    }

    @Test
    @DisplayName("issues exactly one Redis command per request")
    void issuesOneCommandPerRequest() {
        FakeRedis redis = new FakeRedis();
        RedisWriteRateLimitStore store = store(redis, 1);

        store.tryAcquire("ip:1", NOW);
        store.tryAcquire("ip:1", NOW);

        assertThat(redis.scriptsSeen)
                .as("a second round trip is a gap another request can interleave into")
                .hasSize(2);
    }

    @Test
    @DisplayName("increments, sets the expiry and reads the remaining time in one script")
    void countsAtomically() {
        FakeRedis redis = new FakeRedis();
        store(redis, 1).tryAcquire("ip:1", NOW);

        assertThat(redis.scriptsSeen.getFirst())
                .as("INCR then a separate EXPIRE leaks a key with no TTL if the gap is not survived")
                .contains("INCR")
                .contains("PEXPIRE")
                .contains("PTTL");
    }

    @Test
    @DisplayName("repairs a key found without a TTL instead of refusing that caller forever")
    void scriptSelfHeals() {
        assertThat(RedisWriteRateLimitStore.SCRIPT)
                .as("-1 (no expiry) and -2 (missing) must both re-arm the window")
                .contains("t < 0");
    }

    @Test
    @DisplayName("derives the retry hint from the key's remaining time, rounded up")
    void retryHintComesFromTheKeysTtl() {
        FakeRedis redis = new FakeRedis();
        redis.remainingMillis = 4200;
        RedisWriteRateLimitStore store = store(redis, 1);

        store.tryAcquire("ip:1", NOW);

        assertThat(store.tryAcquire("ip:1", NOW))
                .as("rounded up, so a client obeying it exactly does not earn a second 429")
                .isEqualTo(5);
    }

    @Test
    @DisplayName("never returns a retry hint of zero seconds for a refused request")
    void retryHintIsNeverZero() {
        FakeRedis redis = new FakeRedis();
        redis.remainingMillis = 1;
        RedisWriteRateLimitStore store = store(redis, 1);

        store.tryAcquire("ip:1", NOW);

        assertThat(store.tryAcquire("ip:1", NOW)).isEqualTo(1);
    }

    @Test
    @DisplayName("namespaces and prefixes the key, so two counter families cannot merge")
    void keysAreNamespaced() {
        FakeRedis redis = new FakeRedis();
        new RedisWriteRateLimitStore(redis, "w", 5, WINDOW).tryAcquire("ip:1", NOW);
        new RedisWriteRateLimitStore(redis, "cb", 5, WINDOW).tryAcquire("ip:1", NOW);

        assertThat(redis.keysSeen).containsExactly("pn:rl:w:ip:1", "pn:rl:cb:ip:1");
    }

    @Test
    @DisplayName("passes the window to the script in milliseconds, so a sub-second window survives")
    void windowIsSentInMilliseconds() {
        List<String> args = new ArrayList<>();
        RedisEval capture = (script, keys, argv) -> {
            args.addAll(argv);
            return List.of(1L, 500L);
        };
        new RedisWriteRateLimitStore(capture, "w", 5, Duration.ofMillis(500)).tryAcquire("k", NOW);

        assertThat(args).containsExactly("500");
    }

    @Test
    @DisplayName("falls back to per-instance counting when Redis is unreachable, not to nothing")
    void failsOpenButDegraded() {
        RedisEval broken = (script, keys, args) -> {
            throw new IllegalStateException("connection refused");
        };
        RedisWriteRateLimitStore store = new RedisWriteRateLimitStore(broken, "w", 2, WINDOW);

        assertThat(store.tryAcquire("ip:1", NOW)).as("first is inside the budget").isZero();
        assertThat(store.tryAcquire("ip:1", NOW)).isZero();
        assertThat(store.tryAcquire("ip:1", NOW))
                .as("a Redis outage must not become an unlimited write budget")
                .isPositive();
    }

    @Test
    @DisplayName("treats a reply of the wrong shape as unavailability rather than as a count")
    void malformedReplyFallsBack() {
        RedisEval nonsense = (script, keys, args) -> List.of(7L);
        RedisWriteRateLimitStore store = new RedisWriteRateLimitStore(nonsense, "w", 2, WINDOW);

        assertThat(store.tryAcquire("ip:1", NOW))
                .as("guessing at a malformed answer enforces a number nobody chose")
                .isZero();
        store.tryAcquire("ip:1", NOW);
        assertThat(store.tryAcquire("ip:1", NOW)).isPositive();
    }

    @Test
    @DisplayName("rejects a misconfiguration that would silently switch the limit off")
    void rejectsAnImpossibleConfiguration() {
        RedisEval any = (script, keys, args) -> List.of(1L, 1L);

        assertThatThrownBy(() -> new RedisWriteRateLimitStore(any, "w", 0, WINDOW))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RedisWriteRateLimitStore(any, "w", 5, Duration.ZERO))
                .as("a zero window restarts on every request, so nothing is ever limited")
                .isInstanceOf(IllegalArgumentException.class);
    }
}
