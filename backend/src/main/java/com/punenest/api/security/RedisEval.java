package com.punenest.api.security;

import java.util.List;

/**
 * The one Redis operation the rate limiter needs: run a script, get numbers back (tech-debt D158).
 *
 * <p><strong>Why the limiter talks to this and not to a Redis client.</strong> Two reasons, and the
 * second is the one that decided it.
 *
 * <p>First, it is the entire surface. {@link RedisWriteRateLimitStore} issues exactly one command
 * per request and reads two integers from it. Depending on a full client API to do that would let
 * the limiter reach for {@code INCR}, {@code EXPIRE} or a pipeline later — which is precisely how a
 * counter stops being atomic — and it would make the store impossible to test without a server.
 *
 * <p>Second, this build resolves offline, and no Redis client can currently be added to it. The
 * Boot 4.1.0 BOM manages {@code spring-boot-starter-data-redis} at 4.1.0, which is not in the local
 * repository, and neither is anything it needs: Boot 4.1.0 manages {@code lettuce-core} at
 * 7.5.2.RELEASE (cache has 6.3.2.RELEASE) and, via {@code reactor-bom} 2025.0.6,
 * {@code reactor-core} at 3.8.6 (cache tops out at 3.8.1). {@code redis.clients:jedis} is absent
 * altogether, so there is no second client to fall back on. Pinning the cached
 * {@code spring-data-redis} 3.3.5 instead only moves the wall — the same one the AWS SDK's
 * {@code netty-nio-client} exclusion in {@code pom.xml} already documents. Adding the dependency
 * would break {@code mvn -o} for everyone. So the transport is a one-method interface with no
 * implementation shipped yet, and the part that is genuinely hard to get right — atomicity, key
 * layout, TTL, the retry-after arithmetic and the failure policy — is real, here, and tested.
 *
 * <p><strong>Re-check in one command rather than re-reading this paragraph</strong>, because a
 * cache moves under you: {@code mvnw dependency:get -Dartifact=org.springframework.boot:
 * spring-boot-starter-data-redis:4.1.0}. Verified 2026-08-12 — it fails offline with
 * {@code (absent) ... in offline mode}, and online with a connect timeout to the configured
 * mirror, so the "first time the build runs online" trigger has not fired yet. One detail there
 * has already gone stale once: {@code io.netty:*:4.2.15.Final} was recorded as a blocker and is
 * now cached, which is exactly why the command beats the prose.
 *
 * <p>An implementation is a few lines over {@code StringRedisTemplate}:
 * {@code template.execute(new DefaultRedisScript<>(script, List.class), keys, args)}. It belongs in
 * {@code com.punenest.api.provider}, not here, and can be written the day the build may fetch from
 * the network.
 */
@FunctionalInterface
public interface RedisEval {

    /**
     * Evaluate a Lua script on the Redis server.
     *
     * <p>Implementations must let failures propagate as exceptions rather than returning
     * {@code null} or an empty list. The caller distinguishes "Redis said no" from "Redis did not
     * answer" and handles them differently; an implementation that swallowed the difference would
     * make the second look like the first, which here means a hard outage looking like a caller who
     * is merely over budget.
     *
     * @param script Lua source
     * @param keys   values for {@code KEYS[n]}, so the server can route them in a cluster
     * @param args   values for {@code ARGV[n]}
     * @return the script's return value; Redis converts Lua numbers to integers, so this is the
     *         list of longs the script returned, in order
     * @throws RuntimeException if the server is unreachable, times out, or rejects the script
     */
    List<Long> eval(String script, List<String> keys, List<String> args);
}
