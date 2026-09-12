package com.draazy.api.common.persistence;

import jakarta.persistence.EntityManager;
import jakarta.persistence.FlushModeType;
import jakarta.persistence.Query;
import java.util.Objects;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Makes a count-then-insert rate limit atomic, by serialising every writer that shares the limiting
 * key for the rest of the transaction (D73).
 *
 * <p><strong>The bug this exists to close.</strong> Three limits on this platform were written the
 * obvious way — count the rows in the window, refuse if the count has reached the ceiling, otherwise
 * insert. Under concurrency that is not a limit at all: every request in a burst reads the same
 * pre-insert count, every one of them passes, and every one of them inserts. A cap of three lets
 * through as many simultaneous writers as the caller can open connections for. The window is narrow
 * — microseconds — but it is exactly the window a script aims at, and the caps it defeats are the
 * ones that stop an SMS gateway becoming a billing tap and a stranger's phone becoming a doorbell.
 *
 * <p><strong>Why a lock and not a unique index.</strong> D153, D160 and D170 closed the same class
 * of bug with a partial unique index and {@link ConstraintViolations#isOn}: the database refuses the
 * second row and the catch block translates the named collision into a business error. That works
 * when the rule is "at most one", because "one" has a key. It does not transfer to "at most N in the
 * last hour" — there is no column, and no expression over columns, whose uniqueness expresses a
 * count over a moving window. Nor does the tempting one-statement form,
 * {@code INSERT … SELECT … WHERE (SELECT count(…)) < N}: under {@code READ COMMITTED} the subquery
 * reads the statement's snapshot, so two concurrent inserts both see the pre-insert count and both
 * proceed. It looks atomic because it is one statement, which makes it a worse bug than the one it
 * replaces.
 *
 * <p><strong>Why an advisory lock and not {@code SELECT … FOR UPDATE}.</strong> Row locks only lock
 * rows that exist. Locking the rows already in the window does serialise two writers against each
 * other, but the loser resumes with the snapshot it took before it blocked — it never sees the row
 * the winner inserted, because the insert created a row its snapshot cannot contain and nothing it
 * locked was modified. That is the classic phantom, and it leaves the cap exactly as leaky as
 * before. Locking an <em>owning</em> row instead would work, but two of the three call sites have no
 * owning row to lock: a society-lead submit is anonymous and an OTP send names a mobile that usually
 * has no account. {@code pg_advisory_xact_lock} needs no row, takes an arbitrary key, and is
 * released by Postgres itself when the transaction ends — so there is no path, including a thrown
 * exception or a connection dropped mid-flight, on which it leaks.
 *
 * <p><strong>Why not {@code WriteRateLimiter}.</strong> That class (D2) is the right answer to a
 * different question — how fast one principal may arrive at the API at all — and it counts in
 * memory, per instance, resetting on every deploy (D158). Two of the three limits here explicitly
 * rejected an in-memory counter when they were written, and they were right to: an OTP budget that
 * resets on deploy is not a budget, and a public form with no session has nothing to hang a bucket
 * off. Folding these into it would have deleted three limiters and the guarantee they exist for.
 *
 * <p><strong>What it costs.</strong> Contention is per key, so two callers limited on different
 * mobiles never meet. Two callers on the <em>same</em> key serialise for the remainder of the
 * transaction, which for an OTP send includes the call to the SMS gateway — concurrent sends to one
 * number therefore queue behind one another rather than all firing. That is the traffic the limit
 * exists to stop, and the queue drains at the speed of a refusal once the first send commits.
 *
 * <p><strong>It depends on {@code READ COMMITTED}, which is the default and is not overridden
 * anywhere.</strong> The point of taking the lock is that the count issued after it is a new
 * statement with a new snapshot, so it sees the row the previous holder committed. Under
 * {@code REPEATABLE READ} the whole transaction shares one snapshot and the lock would serialise the
 * writers while leaving every one of them reading the same stale count — the lock would be held,
 * paid for, and useless. Anyone raising the isolation level on these paths has to revisit this.
 */
@Component
public class RateLimitLock {

    /**
     * The independent counters this platform locks on.
     *
     * <p>Each is a namespace occupying the high 32 bits of the lock id, so two different limits can
     * never collide however their keys hash — the {@code 3} here and the {@code 1} there are not a
     * shared numbering scheme anyone has to remember, they are a partition. Ids are permanent:
     * changing one only means an old and a new deploy briefly fail to serialise against each other,
     * but there is no reason to.
     */
    public enum Limit {

        /** {@code OtpService} — codes per (mobile, purpose) per hour, plus the send cooldown. */
        OTP_SEND(1),

        /** {@code SocietyLeadService} — public lead submissions per mobile per hour. */
        SOCIETY_LEAD_SUBMIT(2),

        /**
         * Flatmate interests per requester per hour.
         *
         * <p>Deliberately one value for two services: {@code FlatmateSeekerService.express} and
         * {@code FlatmateSupplyService.record} count the same rows of {@code flatmate_requests}
         * against the same ceiling, so they are one counter with two entrances. Giving them a
         * namespace each would let a caller run both entrances concurrently and clear the cap they
         * share — the original bug, reintroduced by tidiness.
         */
        FLATMATE_INTEREST(3),

        /**
         * {@code TicketService.joinWaitlist} — public service-waitlist signups per mobile per hour.
         *
         * <p>Keyed on the mobile alone rather than on {@code (mobile, service)}, which would be the
         * tidier partition and the wrong one: the budget exists to protect the ops board, and the
         * board does not care which form filled it. A per-service key would let one number open a
         * new allowance for every service the catalogue ever gains, so the cap would loosen every
         * time the product grew.
         */
        SERVICE_WAITLIST(4);

        private final int namespace;

        Limit(int namespace) {
            this.namespace = namespace;
        }
    }

    private final EntityManager em;

    public RateLimitLock(EntityManager em) {
        this.em = em;
    }

    /**
     * Block until nobody else holds {@code limit} for {@code key}, then hold it until this
     * transaction commits or rolls back.
     *
     * <p>Call this <em>before</em> reading the count it guards, and let the insert happen in the same
     * transaction. Both halves matter: a lock taken after the read guards nothing, and a lock
     * released before the insert commits guards nothing either.
     *
     * @param limit which counter — the namespace, so unrelated limits never contend
     * @param key   what identifies the limited principal within that counter: a mobile, a user id,
     *              a {@code (mobile, purpose)} pair. Keys are hashed to 32 bits, so two distinct
     *              keys can collide and serialise needlessly; that costs throughput on a write path
     *              and cannot cost correctness.
     */
    public void holdUntilCommit(Limit limit, String key) {
        Objects.requireNonNull(limit, "limit");
        Objects.requireNonNull(key, "key");
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            // Not defensive noise. Without a transaction the statement below runs in its own
            // autocommit transaction, which ends the instant it returns — the lock is taken and
            // released before the caller reads anything, and the limit silently goes back to being
            // check-then-write. That is a fail-open with no symptom, so it is worth a loud failure
            // at the one moment it can be noticed: the first time somebody drops @Transactional
            // from a caller, or calls one of these services from a path that has none.
            throw new IllegalStateException(
                    "RateLimitLock." + limit + " needs an active transaction — a transaction-scoped "
                            + "advisory lock taken outside one is released immediately and enforces "
                            + "nothing");
        }
        Query query = em.createNativeQuery(
                // The function returns void, which is not a type a result-set mapping can name, so
                // it is called in a subquery whose column is never selected.
                "select 1 from (select pg_advisory_xact_lock(:lockId)) as acquired");
        // Nothing this lock protects is pending in the persistence context — the caller reads and
        // then writes — so the automatic pre-native-query flush would only move somebody else's
        // unrelated writes earlier than they asked for.
        query.setFlushMode(FlushModeType.COMMIT);
        query.setParameter("lockId", lockId(limit, key));
        query.getSingleResult();
    }

    /**
     * The 64-bit lock id: namespace in the high half, key hash in the low half.
     *
     * <p>Package-private so the partition can be asserted rather than assumed — the property that
     * matters is that no two {@link Limit}s can ever produce the same id, which the shift guarantees
     * only because the mask keeps the hash inside the low 32 bits.
     */
    static long lockId(Limit limit, String key) {
        return ((long) limit.namespace << 32) | (key.hashCode() & 0xFFFF_FFFFL);
    }
}
