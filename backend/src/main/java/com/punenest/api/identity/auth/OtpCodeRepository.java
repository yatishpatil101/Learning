package com.punenest.api.identity.auth;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
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
}
