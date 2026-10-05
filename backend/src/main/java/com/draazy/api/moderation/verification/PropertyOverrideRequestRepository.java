package com.draazy.api.moderation.verification;

import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PropertyOverrideRequestRepository extends JpaRepository<PropertyOverrideRequest, UUID> {

    Optional<PropertyOverrideRequest> findFirstByPropertyIdAndStatusOrderByCreatedAtDesc(
            UUID propertyId, String status);

    boolean existsByPropertyIdAndActionAndStatus(UUID propertyId, String action, String status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select r from PropertyOverrideRequest r
            where r.id = :id
            """)
    Optional<PropertyOverrideRequest> findByIdForUpdate(@Param("id") UUID id);
}
