package com.punenest.api.catalog.society;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Spring Data access for {@link Society}, plus the two follower aggregates the contract's
 * {@code followerCount} / {@code followedByMe} need.
 *
 * <p><strong>Why the follow queries are native and there is no {@code SocietyFollow} entity.</strong>
 * {@code society_follows} is a two-column join table with a composite primary key and no surrogate
 * id, so mapping it means an {@code @IdClass} or {@code @EmbeddedId} — real design work whose only
 * consumer today is two counts. The writes ({@code PUT|DELETE /me/societies/{slug}/follow}) belong to
 * the Engagement slice, and that slice should get to choose the mapping when it needs one. Reading a
 * count does not oblige this slice to decide it first.
 *
 * <p>Both queries are scoped to the ids on the current page and served by the table's primary key,
 * so neither grows with the size of the follow table.
 */
public interface SocietyRepository
        extends JpaRepository<Society, UUID>, JpaSpecificationExecutor<Society> {

    /** One society by its public URL key. */
    Optional<Society> findBySlug(String slug);

    /**
     * Follower counts for the societies on this page.
     *
     * @return rows of {@code [societyId, count]}; societies with no followers are absent
     */
    @Query(value = """
            select society_id, count(*)
            from society_follows
            where society_id in (:societyIds)
            group by society_id""", nativeQuery = true)
    List<Object[]> countFollowersFor(@Param("societyIds") Collection<UUID> societyIds);

    /**
     * Which of these societies the given user follows.
     *
     * <p>Answers {@code followedByMe} for a whole page in one query. The obvious alternative — an
     * {@code exists} check per row — is an N+1 on a public endpoint.
     */
    @Query(value = """
            select society_id
            from society_follows
            where user_id = :userId and society_id in (:societyIds)""", nativeQuery = true)
    List<UUID> findFollowedAmong(@Param("userId") UUID userId,
            @Param("societyIds") Collection<UUID> societyIds);
}
