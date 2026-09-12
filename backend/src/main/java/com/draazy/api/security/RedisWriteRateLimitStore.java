package com.draazy.api.security;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The write rate limit counted in Redis, so the budget is the platform's rather than each
 * instance's (tech-debt D158).
 *
 * <p><strong>What this fixes.</strong> {@link WriteRateLimiter} keeps its counters in the JVM, so
 * the real limit is the configured one multiplied by the number of running instances, and every
 * deploy hands the platform a fresh allowance. With one instance that is not a defect — it is the
 * correct answer computed cheaply. It becomes one silently, the moment a second instance starts:
 * the limit does not fail, it just becomes a larger number nobody chose.
 *
 * <h2>Why the counter must be one command</h2>
 *
 * <p>The obvious implementation is {@code INCR} followed by {@code EXPIRE} when the count came back
 * as 1. It is wrong, and wrong in the direction that does not show up in testing.
 *
 * <p>Those are two round trips with a gap between them. If the process dies in that gap — a deploy,
 * an OOM kill, a network partition, a pod eviction — the key exists, holds the value 1, and has no
 * expiry. Nothing will ever remove it. The next request from that caller increments it to 2, the one
 * after to 3, and once it passes the budget that caller is refused permanently, by a key that will
 * outlive every instance that could have explained it. The same gap also leaks memory: a key per
 * unlucky caller, immortal, in a store whose whole eviction model assumes TTLs.
 *
 * <p>So the increment, the expiry and the remaining-time read are one Lua script. Redis executes a
 * script to completion with nothing interleaved, which makes the three a single atomic step: either
 * all of it happened or none of it did, and there is no state in between for a crash to strand.
 * The script also repairs a key it finds without a TTL, so a counter stranded by an older
 * implementation heals on next contact instead of refusing that caller forever.
 *
 * <h2>Why a Redis outage fails open — the opposite of {@link BotDefence}</h2>
 *
 * <p>These two controls sit next to each other in the same filter chain and make opposite choices
 * when their backend is unreachable, which is worth stating plainly because it looks inconsistent
 * and is not.
 *
 * <p>A challenge that fails open can be switched off by anyone who can break it, so it fails closed.
 * A rate limiter that fails closed refuses every write on the platform the moment Redis blinks — it
 * converts a degraded dependency into a total outage, and it does so for every legitimate user at
 * once, to prevent an abuse that may not even be happening. So this fails open. Not to nothing,
 * though: it falls back to a local in-memory counter with the same budget, which is exactly the
 * protection the platform had before this class existed. Degrading to per-instance limiting is a
 * far better answer than degrading to none, and it is loud — the fallback logs at error, because a
 * limiter quietly counting somewhere other than where the operator thinks it is counting is the
 * whole reason D158 was written down.
 */
public final class RedisWriteRateLimitStore implements WriteRateLimitStore {

    /**
     * Increment, arm the expiry, and report the remaining window — atomically.
     *
     * <p>{@code PEXPIRE}/{@code PTTL} in milliseconds rather than {@code EXPIRE}/{@code TTL} in
     * seconds: a sub-second window is a legal configuration, and second granularity would round it
     * to zero and hand out an unlimited budget.
     *
     * <p>The {@code t < 0} branch covers both of Redis's negative replies — {@code -1} for "exists,
     * no expiry" and {@code -2} for "does not exist" — and cannot normally be reached for a key just
     * incremented. It is the self-repair for a key stranded by a non-atomic predecessor, and it is
     * cheap: one comparison on a value already fetched.
     */
    static final String SCRIPT = """
            local n = redis.call('INCR', KEYS[1])
            local t = redis.call('PTTL', KEYS[1])
            if t < 0 then
              redis.call('PEXPIRE', KEYS[1], ARGV[1])
              t = tonumber(ARGV[1])
            end
            return {n, t}
            """;

    private static final Logger log = LoggerFactory.getLogger(RedisWriteRateLimitStore.class);

    /**
     * Prefix on every key.
     *
     * <p>Present so that a Redis shared with anything else — a cache, another service, a future
     * feature — cannot collide with a counter, and so an operator can see at a glance what these
     * keys are and delete them wholesale without touching anything that matters.
     */
    private static final String KEY_PREFIX = "pn:rl:";

    private final RedisEval redis;
    private final String namespace;
    private final int budget;
    private final Duration window;

    /**
     * Per-instance counter used only while Redis is unreachable.
     *
     * <p>Constructed eagerly rather than on first failure: allocating a limiter on the error path
     * means the error path is the one path never exercised until the day it runs, and it would need
     * synchronising to avoid two threads racing to create it during exactly the incident it exists
     * for.
     */
    private final WriteRateLimitStore fallback;

    public RedisWriteRateLimitStore(RedisEval redis, String namespace, int budget, Duration window) {
        // Validated here as well as in the fallback's constructor, and for the same reasons given
        // there: a zero window means nothing is ever limited while the app looks healthy, and a
        // budget below one refuses every write. Neither should be discoverable in production, and
        // relying on the fallback to catch it would make the check depend on the fallback being
        // constructed first.
        if (budget < 1) {
            throw new IllegalArgumentException("rate-limit budget must be at least 1, got " + budget);
        }
        if (window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("rate-limit window must be positive, got " + window);
        }
        this.redis = redis;
        this.namespace = namespace;
        this.budget = budget;
        this.window = window;
        this.fallback = new InMemoryWriteRateLimitStore(namespace, budget, window);
    }

    @Override
    public int tryAcquire(String key, Instant now) {
        List<Long> reply;
        try {
            reply = redis.eval(SCRIPT,
                    List.of(KEY_PREFIX + namespace + ':' + key),
                    List.of(Long.toString(window.toMillis())));
        } catch (RuntimeException e) {
            // See the class comment: open, but degraded to per-instance counting, and loud.
            log.error("Redis rate-limit store unavailable; falling back to per-instance counting", e);
            return fallback.tryAcquire(key, now);
        }
        if (reply == null || reply.size() < 2 || reply.get(0) == null || reply.get(1) == null) {
            // A reply of the wrong shape means the script this class assumes is not the script that
            // ran — a Redis proxy rewriting replies, or a future edit to SCRIPT that changed its
            // return without changing this. Treated as unavailability rather than as a count,
            // because guessing at a malformed answer is how a limiter ends up enforcing a number
            // nobody chose.
            log.error("Redis rate-limit store returned an unexpected reply: {}", reply);
            return fallback.tryAcquire(key, now);
        }

        long used = reply.get(0);
        if (used <= budget) {
            return 0;
        }
        long remainingMillis = reply.get(1);
        // Ceiling division, floored at 1, matching WriteRateLimiter exactly: a client that waits the
        // number of seconds it was told must not arrive one millisecond early and earn a second 429.
        return (int) Math.max(1, (remainingMillis + 999) / 1000);
    }
}
