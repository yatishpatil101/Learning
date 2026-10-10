package com.draazy.api.engagement.follow;

import com.draazy.api.catalog.society.Society;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** Bare {@link Repository}: {@code JpaRepository}'s findAll()/delete() would silently hit the societies table.
 * Follows are hard-deleted: a preference, not a business record. */
public interface SocietyFollowRepository extends Repository<Society, UUID> {

    /** Slices ids here, with an explicit {@code countQuery}, so {@code findAllById} loads one page.
     * A follow of a merged-away society reads as its survivor, once. */
    @Query(value = """
            select coalesce(s.merged_into, s.id) from society_follows f join societies s on s.id = f.society_id
            where f.user_id = :userId group by 1 order by max(f.created_at) desc""",
            countQuery = """
            select count(distinct coalesce(s.merged_into, s.id)) from society_follows f
            join societies s on s.id = f.society_id where f.user_id = :userId""",
            nativeQuery = true)
    Page<UUID> findFollowedSocietyIds(@Param("userId") UUID userId, Pageable pageable);

    /** Followers still owed this alert: not the owner, nobody with match alerts off, nobody already told. */
    @Query(value = """
            select distinct f.user_id from society_follows f
            left join notification_preferences np on np.user_id = f.user_id
            where f.society_id in (:societyIds) and f.user_id <> :excludedUserId
              and coalesce(np.match_alerts, true)
              and not exists (select 1 from notifications n
                              where n.user_id = f.user_id and n.type = :type and n.link = :link)""",
            nativeQuery = true)
    List<UUID> findUnalertedFollowerIds(@Param("societyIds") Collection<UUID> societyIds,
            @Param("excludedUserId") UUID excludedUserId, @Param("type") String type,
            @Param("link") String link);

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
