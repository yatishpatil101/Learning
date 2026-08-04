package com.punenest.api.engagement.follow;

import com.punenest.api.catalog.society.Society;
import java.util.UUID;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * Native access to the {@code society_follows} join table — the write side. The read side
 * (follower counts, followedByMe) lives in {@code SocietyRepository} where it is consumed.
 *
 * <p><strong>D8.9 — hard delete.</strong> Same rationale as {@code SavedPropertyRepository}:
 * a follow is a preference, not a business record, and the composite PK dedupe requires
 * no tombstone.
 *
 * <p>Extends the bare {@link Repository} marker rather than {@code JpaRepository}. The domain type
 * parameter is {@code Society} only because Spring Data requires one and {@code society_follows}
 * has no entity; inheriting the full CRUD surface would publish {@code findAll()} and
 * {@code delete()} methods that silently operate on the <em>societies</em> table, which is not what
 * anyone calling a repository named "SocietyFollow" would expect. Nothing here needs them.
 */
public interface SocietyFollowRepository extends Repository<Society, UUID> {

    /** Idempotent follow (D8.10). Returns 1 if inserted, 0 if already following. */
    @Modifying
    @Query(value = "insert into society_follows (user_id, society_id) values (:userId, :societyId) on conflict do nothing",
            nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("societyId") UUID societyId);

    /** Hard delete. Returns 0 if nothing existed — controller answers 204 either way. */
    @Modifying
    @Query(value = "delete from society_follows where user_id = :userId and society_id = :societyId",
            nativeQuery = true)
    int deleteByUserAndSociety(@Param("userId") UUID userId, @Param("societyId") UUID societyId);
}
