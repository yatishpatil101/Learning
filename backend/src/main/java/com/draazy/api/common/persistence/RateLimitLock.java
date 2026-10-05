package com.draazy.api.common.persistence;

import jakarta.persistence.EntityManager;
import jakarta.persistence.FlushModeType;
import jakarta.persistence.Query;
import java.util.Objects;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Makes a count-then-insert rate limit atomic by serialising every writer sharing the limiting key.
 * Depends on {@code READ COMMITTED}: above it the post-lock count reuses the stale snapshot. */
@Component
public class RateLimitLock {

    /** Each value is a namespace occupying the high 32 bits of the lock id, so two different limits
     * can never collide however their keys hash. */
    public enum Limit {

        OTP_SEND(1),

        FLATMATE_INTEREST(3),

        SERVICE_WAITLIST(4),

        OTP_SEND_CALLER(5),

        LISTING_CREATE(6);

        /** Distinct from {@link #OTP_SEND}, which keys on the recipient a caller can rotate freely.
         * Both are taken on one send, always in namespace order, so the pair cannot deadlock. */
        // Distinct from `#OTP_SEND`, which keys on the recipient a caller can rotate freely.
        // Both are taken on one send, always in namespace order, so the pair cannot deadlock.
        private final int namespace;

        Limit(int namespace) {
            this.namespace = namespace;
        }
    }

    private final EntityManager em;

    public RateLimitLock(EntityManager em) {
        this.em = em;
    }

    /** Must be called <em>before</em> reading the count it guards, with the insert in the same
     * transaction; either half missing guards nothing. */
    public void holdUntilCommit(Limit limit, String key) {

        acquire(limit, key, "select 1 from (select pg_advisory_xact_lock(:lockId)) as acquired");
    }

    /** Non-blocking variant, for holders that span something slow: waiting queues N gateway
     * round-trips on pooled connections, and {@code pg_advisory_xact_lock} has no timeout. */
    public boolean tryHoldUntilCommit(Limit limit, String key) {
        return Boolean.TRUE.equals(
                acquire(limit, key, "select pg_try_advisory_xact_lock(:lockId)"));
    }

    private Object acquire(Limit limit, String key, String sql) {
        require(limit, key);
        Query query = em.createNativeQuery(sql);

        // Nothing this lock protects is pending in the persistence context, so the automatic
        // pre-native-query flush would only move somebody else's writes earlier than they asked.
        query.setFlushMode(FlushModeType.COMMIT);
        query.setParameter("lockId", lockId(limit, key));
        return query.getSingleResult();
    }

    private static void require(Limit limit, String key) {
        Objects.requireNonNull(limit, "limit");
        Objects.requireNonNull(key, "key");
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {

            throw new IllegalStateException(
                    "RateLimitLock." + limit + " needs an active transaction — a transaction-scoped "
                            + "advisory lock taken outside one is released immediately and enforces "
                            + "nothing");
        }
    }

    /** Namespace in the high half, key hash in the low half — the partition holds only because the
     * mask keeps the hash below 32 bits. Package-private so that can be asserted. */
    static long lockId(Limit limit, String key) {
        return ((long) limit.namespace << 32) | (key.hashCode() & 0xFFFF_FFFFL);
    }
    }
