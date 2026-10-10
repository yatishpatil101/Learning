package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FlatmateSeekerPostRepository extends JpaRepository<FlatmateSeekerPost, UUID> {

    @Query("""
            select p from FlatmateSeekerPost p
            where p.id = :id and p.archived = false
              and p.modStatus in ('live','approved')
            """)
    Optional<FlatmateSeekerPost> findVisible(@Param("id") UUID id);

    Optional<FlatmateSeekerPost> findByUserIdAndArchivedFalse(UUID userId);

    @Query("""
            select p from FlatmateSeekerPost p
            where p.archived = false and p.modStatus in ('live','approved')
              and p.expiry.activeUntil < :before and (p.expiry.reminded = false or :remindedToo = true)
            """)
    List<FlatmateSeekerPost> findPublicActiveUntil(@Param("before") Instant before,
            @Param("remindedToo") boolean remindedToo);

    boolean existsByUserIdAndArchivedFalse(UUID userId);

    Page<FlatmateSeekerPost> findByModStatusInAndArchivedFalse(Collection<String> modStatuses,
            Pageable pageable);

    Page<FlatmateSeekerPost> findByRecheckRequestedAtNotNullAndArchivedFalse(Pageable pageable);

    long countByModStatusInAndArchivedFalse(Collection<String> modStatuses);

    long countByRecheckRequestedAtNotNullAndArchivedFalse();

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update FlatmateSeekerPost p set p.verified = :verified where p.userId = :userId and p.verified <> :verified")
    int copyBadge(@Param("userId") UUID userId, @Param("verified") boolean verified);
}
