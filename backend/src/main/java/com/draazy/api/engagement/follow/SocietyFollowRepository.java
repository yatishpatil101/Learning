package com.draazy.api.engagement.follow;

import com.draazy.api.catalog.society.Society;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * Native access to the {@code society_follows} join table.
 *
 * <p>The two <em>page-scoped</em> reads — how many followers these societies have, and which of
 * them this caller follows — live in {@code SocietyRepository} where they are consumed. The read
 * here is the other direction: not "is this society followed" for a page of societies, but "which
 * societies do I follow" with no page of societies to scope it to. That question has no page to
 * borrow, so it brings its own (D227).
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

    /**
     * The caller's followed society ids, newest first, paged. The join to {@code societies} happens
     * in the service, which fetches full entities so the mapper can produce {@code SocietyResponse}.
     *
     * <p>Same shape as {@code SavedPropertyRepository.findSavedPropertyIds} and for the same
     * reasons: the slice is applied here rather than to the entity fetch, so {@code findAllById}
     * only ever loads one page's worth of rows, and a native paged query needs an explicit
     * {@code countQuery} because Spring Data can derive one from JPQL but not from raw SQL.
     *
     * <p>Ordering by {@code created_at desc} makes "the society I followed most recently" the first
     * thing the dashboard panel shows, which is the only ordering a follow list has any claim to —
     * alphabetical would bury a fresh follow the user made ten seconds ago.
     */
    @Query(value = "select society_id from society_follows where user_id = :userId order by created_at desc",
            countQuery = "select count(*) from society_follows where user_id = :userId",
            nativeQuery = true)
    Page<UUID> findFollowedSocietyIds(@Param("userId") UUID userId, Pageable pageable);

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
