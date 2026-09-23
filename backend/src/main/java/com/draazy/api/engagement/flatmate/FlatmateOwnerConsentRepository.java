package com.draazy.api.engagement.flatmate;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code flatmate_owner_consents} (V13), plus the one write — {@link #insertIfAbsent},
 * whose javadoc states why recording a consent cannot be a JPA {@code save}. */
public interface FlatmateOwnerConsentRepository extends JpaRepository<FlatmateOwnerConsent, UUID> {

    /** All three parts matter: the pair alone says only that the two people once spoke, so one OTP
     * would vouch for every later post the same tenant made. */
    Optional<FlatmateOwnerConsent> findByOwnerMobileAndGrantedByAndAddressFingerprint(
            String ownerMobile, UUID grantedBy, String addressFingerprint);

    boolean existsByOwnerMobileAndGrantedByAndAddressFingerprint(
            String ownerMobile, UUID grantedBy, String addressFingerprint);

    /** Not find-then-save: under READ COMMITTED the loser's failed flush aborts the transaction and
     * discards the OTP. The conflict target must match V30's index exactly, {@code coalesce} included. */
    @Modifying
    @Query(value = """
            insert into flatmate_owner_consents (owner_mobile, granted_by, group_id,
                                                 address_fingerprint)
                 values (:ownerMobile, cast(:grantedBy as uuid), cast(:groupId as uuid),
                         :fingerprint)
            on conflict (owner_mobile, granted_by, coalesce(address_fingerprint, ''))
             do nothing""", nativeQuery = true)
    void insertIfAbsent(@Param("ownerMobile") String ownerMobile,
            @Param("grantedBy") String grantedBy, @Param("groupId") String groupId,
            @Param("fingerprint") String fingerprint);
}
