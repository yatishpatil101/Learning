package com.draazy.api.identity.auth;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface StaffCredentialRepository extends JpaRepository<StaffCredential, UUID> {

    @Modifying
    @Query(value = "INSERT INTO staff_credentials (user_id) VALUES (:userId) ON CONFLICT (user_id) DO NOTHING",
            nativeQuery = true)
    void ensureExists(UUID userId);

    /** Row-locked so concurrent guesses cannot share one read of the attempt count, step or codes. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM StaffCredential c WHERE c.userId = :userId")
    Optional<StaffCredential> findForUpdate(UUID userId);
}
