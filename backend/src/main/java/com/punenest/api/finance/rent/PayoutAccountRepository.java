package com.punenest.api.finance.rent;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads and writes {@link PayoutAccount}. One row per owner (V14). */
public interface PayoutAccountRepository extends JpaRepository<PayoutAccount, UUID> {

    /** The owner's payout destination, if they have set one. */
    Optional<PayoutAccount> findByOwnerId(UUID ownerId);
}
