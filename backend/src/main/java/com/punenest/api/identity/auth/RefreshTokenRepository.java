package com.punenest.api.identity.auth;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    /**
     * Take the per-user family lock for the rest of the current transaction.
     *
     * <p>Every row lock below is taken on a row chosen by the <em>request</em> — a token hash, a
     * predecessor id — so two concurrent calls for the same user acquire the same rows in whatever
     * order their tokens happen to give them. That is a lock-order inversion, and it has teeth: tab
     * A rotates token 1 and trips the tripwire, tab B rotates token 2 and trips it too, each holds
     * the row the other needs to revoke, and Postgres resolves it by aborting one of them. The
     * aborted one is a <em>family burn</em>, and it is rolled back in a way {@code noRollbackFor}
     * cannot save, because the abort is the database's and not the exception's. Reuse-detection
     * would then be a control that fails open exactly when two sessions are contending — which is
     * the shape of the attack it watches for.
     *
     * <p>An advisory lock keyed on the user fixes it by being a <em>single</em> lock taken before
     * any row lock, which is enough to give every family-level operation one total order. It is not
     * an optimisation of the row locks; they still do the work of serialising a rotation against
     * itself. This only removes the ordering freedom that made them deadlock.
     *
     * <p>{@code _xact_} rather than the manual variant: the lock is released when the transaction
     * ends, however it ends. There is no unlock to forget on a throw, and the reuse path throws by
     * design.
     *
     * <p>The key is folded from the UUID in Java rather than by {@code hashtext} in SQL, so that it
     * cannot change under us — {@code hashtext} is an internal function with no compatibility
     * promise. Two users colliding on one long is possible and harmless: the two families would
     * occasionally serialise against each other, costing nothing but a little concurrency. This is
     * the only advisory lock in the codebase, so the whole 64-bit space is ours and no namespace
     * argument is needed.
     */
    @Query(value = "SELECT pg_advisory_xact_lock(:key)", nativeQuery = true)
    void lockFamily(@Param("key") long key);

    /**
     * Look up a token by its hash for rotation, taking a {@code PESSIMISTIC_WRITE} (SELECT … FOR
     * UPDATE) row lock. This closes a concurrent-rotation replay window: without the lock, two
     * simultaneous {@code /auth/refresh} calls presenting the same token both read {@code revoked=false}
     * under READ COMMITTED and each mint a fresh token from one presentation. The lock serializes them
     * so the second caller observes the just-revoked row and trips reuse-detection (ADR-008). Only
     * called from {@link RefreshTokenService#rotate}, which runs in a transaction, so the lock is scoped
     * to that path and never penalizes other reads.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    /**
     * Who owns the token with this hash, read without any lock.
     *
     * <p>Exists solely so {@link RefreshTokenService#rotate} can pick the family lock to wait on
     * before it takes a row lock — the ordering the deadlock fix depends on, and impossible through
     * {@link #findByTokenHash}, which takes its lock by definition. Deliberately projects the one
     * column instead of returning the entity, so it cannot drift into being used for a decision:
     * {@code user_id} is written at insert and never updated, which makes it the only field on this
     * row that an unlocked read can report without the answer being able to go stale.
     */
    @Query("select t.userId from RefreshToken t where t.tokenHash = :tokenHash")
    Optional<UUID> findUserIdByTokenHash(@Param("tokenHash") String tokenHash);

    /**
     * Every refresh token a user holds, under the same {@code PESSIMISTIC_WRITE} lock as the
     * lookups above, because its only caller is about to revoke all of them.
     *
     * <p>Unlocked, this was a plain READ COMMITTED snapshot, and the burn revoked the rows that
     * existed at the instant it read. A sibling tab rotating concurrently commits a <em>new</em>
     * row that the snapshot never saw, so the token the attacker is holding survives the burn that
     * exists to kill it — silently, since every row the burn did see was revoked and the operation
     * reports success. The family lock makes the race impossible rather than merely narrow, and
     * this lock states the intent at the point of the read.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<RefreshToken> findByUserId(UUID userId);

    /**
     * The token minted from {@code predecessorId}, i.e. the next link in a rotation chain, under the
     * same {@code PESSIMISTIC_WRITE} lock as {@link #findByTokenHash}.
     *
     * <p>Used only by the grace window in {@link RefreshTokenService#rotate}, to tell a benign replay
     * (two tabs racing, one of them a moment late) from a genuine one. The lock is needed for the
     * same reason it is there: the heir is about to be rotated, and a rotation that read it unlocked
     * could race the tab that legitimately holds it and leave two live tokens in one family. Chains
     * are acyclic and only ever walked forward, so taking locks along one cannot deadlock against a
     * caller rotating a link further down.
     *
     * <p>{@code rotated_from} is not unique, but it is unique <em>in practice</em> — only
     * {@code rotate} writes it, and it writes one successor per predecessor under that lock.
     * {@code Optional} rather than {@code List} says so; a second row would be a bug, and
     * {@code IncorrectResultSizeDataAccessException} is the right way to hear about it.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<RefreshToken> findByRotatedFrom(UUID predecessorId);

    /**
     * Delete refresh tokens that have already expired.
     *
     * <p>Expired rows cannot be used for rotation and only grow table size over time, so pruning is
     * safe and keeps lookups/indexes bounded.
     *
     * @return number of deleted rows
     */
    long deleteByExpiresAtBefore(Instant cutoff);
}
