package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code flatmate_seeker_posts} (V27). */
public interface FlatmateSeekerPostRepository extends JpaRepository<FlatmateSeekerPost, UUID> {

    /** Native rather than JPQL: the locality filter is a jsonb containment test ({@code @>}) JPQL
     * cannot express. {@code mod_status} is a whitelist — an unconsidered state stays invisible. */
    @Query(value = """
            select * from flatmate_seeker_posts p
            where p.archived = false
              and p.mod_status in ('live','approved')
              and (cast(:locality as text) is null
                   or p.localities @> to_jsonb(cast(:locality as text)))
              and (cast(:gender as text) is null or p.gender = cast(:gender as text))
              and (cast(:flatPref as text) is null
                   or p.flat_pref = cast(:flatPref as text) or p.flat_pref = 'any')
              and (cast(:roomPref as text) is null or p.room_pref = cast(:roomPref as text))
              and (cast(:minBudget as bigint) is null or p.budget >= cast(:minBudget as bigint))
              and (cast(:maxBudget as bigint) is null or p.budget <= cast(:maxBudget as bigint))
            order by p.created_at desc, p.id desc
            """,
            countQuery = """
                    select count(*) from flatmate_seeker_posts p
                    where p.archived = false
                      and p.mod_status in ('live','approved')
                      and (cast(:locality as text) is null
                           or p.localities @> to_jsonb(cast(:locality as text)))
                      and (cast(:gender as text) is null or p.gender = cast(:gender as text))
                      and (cast(:flatPref as text) is null
                           or p.flat_pref = cast(:flatPref as text) or p.flat_pref = 'any')
                      and (cast(:roomPref as text) is null or p.room_pref = cast(:roomPref as text))
                      and (cast(:minBudget as bigint) is null or p.budget >= cast(:minBudget as bigint))
                      and (cast(:maxBudget as bigint) is null or p.budget <= cast(:maxBudget as bigint))
                    """,
            nativeQuery = true)
    Page<FlatmateSeekerPost> feed(@Param("locality") String locality,
            @Param("gender") String gender, @Param("flatPref") String flatPref,
            @Param("roomPref") String roomPref, @Param("minBudget") Long minBudget,
            @Param("maxBudget") Long maxBudget, Pageable pageable);

    /** A visible post by id — the target of an interest. */
    @Query("""
            select p from FlatmateSeekerPost p
            where p.id = :id and p.archived = false
              and p.modStatus in ('live','approved')
            """)
    Optional<FlatmateSeekerPost> findVisible(@Param("id") UUID id);

    /** The caller's own live post, whatever its moderation state — they may always edit their own. */
    Optional<FlatmateSeekerPost> findByUserIdAndArchivedFalse(UUID userId);

    /** The stale sweep's input. {@code uq_flatmate_seeker_posts_live_user} is partial on
     * {@code archived = false}, so a forgotten post blocks its author's next one until this runs. */
    @Query("select p from FlatmateSeekerPost p where p.archived = false and p.updatedAt < :since")
    List<FlatmateSeekerPost> findStale(@Param("since") Instant since);

    /** Backs the one-live-post rule's error message; the unique index is what actually enforces it. */
    boolean existsByUserIdAndArchivedFalse(UUID userId);

    /** Archived rows are excluded because the author already withdrew them — deciding one can only
     * produce a notification about something the seeker has moved on from. */
    Page<FlatmateSeekerPost> findByModStatusAndArchivedFalse(String modStatus, Pageable pageable);

    /** The re-check queue — see {@code FlatmateRoomRepository} for why it ignores {@code modStatus}. */
    Page<FlatmateSeekerPost> findByRecheckRequestedAtNotNullAndArchivedFalse(Pageable pageable);
}
