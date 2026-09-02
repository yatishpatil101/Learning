package com.draazy.api.identity.auth;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface OtpCodeRepository extends JpaRepository<OtpCode, UUID> {

    /**
     * Fetch the active login code for verification, taking a {@code PESSIMISTIC_WRITE} (SELECT … FOR
     * UPDATE) row lock. Without it, two concurrent verify attempts could both read {@code attempts=4},
     * each increment to 5, and both slip past the brute-force ceiling. The lock serializes verifies on
     * the same code so the attempt cap is honored under concurrency — the companion to the durable
     * (cross-transaction) cap that {@code noRollbackFor} provides in {@link OtpService#verifyLoginCode}.
     * Only called from that verify path, which runs in a transaction, so the lock is tightly scoped.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<OtpCode> findFirstByMobileAndPurposeAndConsumedFalseOrderByCreatedAtDesc(
            String mobile, String purpose);

    /**
     * The most recent codes issued to {@code mobile}, newest first, bounded by the caller's page size.
     * Backs the send-rate limit in {@link OtpService#sendLoginCode}.
     *
     * <p>One row is written per send, so the send history is <em>already</em> recorded here — the rate
     * limiter needs no counter table, no cache and no new infrastructure, and it stays correct across
     * restarts and multiple nodes because the state is the same durable row the OTP itself lives in.
     *
     * <p>Deliberately ignores {@code consumed} and {@code expiresAt}: this counts <em>sends</em> — an
     * SMS dispatched, money spent, somebody's phone buzzed — and a code that was later used or left to
     * expire was still sent. Filtering those out would let an attacker reset the budget by verifying.
     *
     * <p>Index-backed by {@code idx_otp_codes_mobile (mobile, purpose)}; rows per mobile are few, so
     * the residual sort-and-limit is cheap and needs no new index.
     */
    List<OtpCode> findByMobileAndPurposeOrderByCreatedAtDesc(
            String mobile, String purpose, Pageable pageable);
}
