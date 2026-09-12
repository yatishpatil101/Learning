package com.draazy.api.identity.auth;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OtpCodeRepository extends JpaRepository<OtpCode, UUID> {

    /**
     * Row-locked so two concurrent verifies cannot both read the same {@code attempts} and slip past
     * the brute-force ceiling. Verify runs in a transaction, so the lock stays tightly scoped.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<OtpCode> findFirstByMobileAndPurposeAndConsumedFalseOrderByCreatedAtDesc(
            String mobile, String purpose);

    /**
     * Backs the per-recipient send budget in {@link OtpService#sendLoginCode}. Counts <em>sends</em>,
     * not live codes — rationale in docs/flows/consumer/auth.md.
     */
    List<OtpCode> findByMobileAndPurposeOrderByCreatedAtDesc(
            String mobile, String purpose, Pageable pageable);

    /**
     * Backs the platform-wide spend ceiling in {@link OtpService#sendCode}, keyed on nothing so a
     * rotating recipient cannot walk past the per-mobile limits. Oldest first: row one reopens.
     */
    @Query("select c.createdAt from OtpCode c where c.createdAt >= :since order by c.createdAt")
    List<Instant> findSendTimesSince(@Param("since") Instant since, Pageable pageable);
}
