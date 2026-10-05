package com.draazy.api.moderation.user;

import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface BadgeGrantRequestRepository extends JpaRepository<BadgeGrantRequest, UUID> {

    boolean existsByUserIdAndStatus(UUID userId, String status);

    Optional<BadgeGrantRequest> findFirstByUserIdAndStatus(UUID userId, String status);

    Page<BadgeGrantRequest> findByStatusOrderByCreatedAtAsc(String status, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from BadgeGrantRequest r where r.id = :id")
    Optional<BadgeGrantRequest> findByIdForUpdate(@Param("id") UUID id);
}
