package com.draazy.api.engagement.flatmate;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads over {@code flatmate_owner_consents} (V27). */
public interface FlatmateOwnerConsentRepository extends JpaRepository<FlatmateOwnerConsent, UUID> {

    /**
     * Has this tenant already recorded consent from this owner? Keyed on the pair so a tenant who
     * reopens the form is not asked to re-OTP an owner who already agreed — the consent is a fact
     * about two people, not about one post.
     */
    Optional<FlatmateOwnerConsent> findByOwnerMobileAndGrantedBy(String ownerMobile, UUID grantedBy);

    boolean existsByOwnerMobileAndGrantedBy(String ownerMobile, UUID grantedBy);
}
