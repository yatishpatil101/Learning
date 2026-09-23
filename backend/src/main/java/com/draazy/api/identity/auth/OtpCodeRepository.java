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

    /** Row-locked so two concurrent verifies cannot both read the same {@code attempts} and slip
     * past the brute-force ceiling. Verify runs in a transaction, so the lock stays tightly scoped. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<OtpCode> findFirstByMobileAndPurposeAndConsumedFalseOrderByCreatedAtDesc(
            String mobile, String purpose);

    /** Per-recipient send budget: counts sends, not live codes. Newest first and unbounded in time
     * — the window test is whether the Nth newest is still inside it. Keyed on family, not purpose. */
    @Query("select c.createdAt from OtpCode c where c.mobile = :mobile"
            + " and (c.purpose = :family or c.purpose like concat(:family, ':%'))"
            + " order by c.createdAt desc")
    List<Instant> findRecentSendTimesForRecipient(@Param("mobile") String mobile,
            @Param("family") String family, Pageable pageable);

    /** Platform-wide ceiling, keyed on nothing so a rotating recipient cannot walk past the
     * per-mobile limits. Oldest first: row one is the send whose expiry reopens a slot. */
    @Query("select c.createdAt from OtpCode c where c.createdAt >= :since order by c.createdAt")
    List<Instant> findSendTimesSince(@Param("since") Instant since, Pageable pageable);

    /** Per-purpose share of that ceiling, so a side flow whose caller names the recipient cannot
     * spend the whole pool. */
    @Query("select c.createdAt from OtpCode c"
            + " where (c.purpose = :family or c.purpose like concat(:family, ':%'))"
            + " and c.createdAt >= :since order by c.createdAt")
    List<Instant> findSendTimesForPurposeSince(@Param("family") String family,
            @Param("since") Instant since, Pageable pageable);

    /** Per-caller quota (V33), keyed on the account that asked rather than the number that
     * received — the only key a caller who names a fresh third party each send cannot rotate. */
    @Query("select c.createdAt from OtpCode c where c.requestedBy = :requestedBy"
            + " and (c.purpose = :family or c.purpose like concat(:family, ':%'))"
            + " and c.createdAt >= :since order by c.createdAt")
    List<Instant> findSendTimesForCallerSince(@Param("requestedBy") UUID requestedBy,
            @Param("family") String family, @Param("since") Instant since, Pageable pageable);
}
