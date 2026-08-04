package com.punenest.api.content;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Active-announcements query. The filtering condition (active, not archived, in window) is
 * encoded in a single JPQL query so it cannot drift from the contract's "Active announcements"
 * spec.
 */
public interface AnnouncementRepository extends JpaRepository<AnnouncementEntity, UUID> {

    @Query("""
            select a from AnnouncementEntity a
            where a.active = true and a.archived = false
              and (a.startsAt is null or a.startsAt <= :now)
              and (a.endsAt is null or a.endsAt >= :now)
            order by a.createdAt desc""")
    List<AnnouncementEntity> findActive(@Param("now") Instant now);
}
