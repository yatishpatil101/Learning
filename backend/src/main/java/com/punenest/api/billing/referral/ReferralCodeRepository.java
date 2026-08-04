package com.punenest.api.billing.referral;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Referral codes, by owner and by the code itself (unique in the DB, V23). */
public interface ReferralCodeRepository extends JpaRepository<ReferralCode, UUID> {

    Optional<ReferralCode> findByCode(String code);

    /** Checked before minting — see {@code ReferralService.codeFor} for why, not after. */
    boolean existsByCode(String code);
}
