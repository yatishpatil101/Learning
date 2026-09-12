package com.draazy.api.billing.referral;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Referral codes, by owner and by the code itself (unique in the DB, V23). */
public interface ReferralCodeRepository extends JpaRepository<ReferralCode, UUID> {

    Optional<ReferralCode> findByCode(String code);

    /** Checked before minting — see {@code ReferralService.codeFor} for why, not after. */
    boolean existsByCode(String code);

    /**
     * Blank the referrer-side correlation digests once they pass their retention window (D55).
     *
     * <p>Keyed on {@code signalsAt} rather than {@code createdAt}: the row outlives the digests by
     * design — the code itself is permanent and is what every shared link points at — so this
     * expires the personal data without touching the thing the row exists for.
     *
     * <p>A bulk update for the same reason as {@link ReferralRepository#clearSignalsOlderThan}:
     * nobody is holding these rows and loading them would be an unbounded read for a job whose whole
     * output is three nulls. {@code signalsAt} is cleared along with the digests, and a null never
     * satisfies {@code <}, so a second tick skips the rows the first one already emptied.
     */
    @Modifying
    @Query("""
            update ReferralCode c
               set c.referrerIpHash = null, c.referrerDeviceHash = null, c.signalsAt = null
             where c.signalsAt < :cutoff
            """)
    int clearSignalsOlderThan(@Param("cutoff") Instant cutoff);
}
