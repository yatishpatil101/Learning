package com.punenest.api.engagement.flatmate;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code flatmate_seeker_posts} (V27). */
public interface FlatmateSeekerPostRepository extends JpaRepository<FlatmateSeekerPost, UUID> {

    /**
     * The {@code team-up} supply: live, unmoderated-away, newest first, filtered server-side by
     * locality plus the seeker facets the page offers (gender, flat preference, room preference,
     * budget range). {@code flatPref} matches an {@code any} post as well as an exact hit (a
     * flexible seeker fits every filter), while {@code gender} and {@code roomPref} are exact —
     * mirroring the mock, where "women only" and a specific room preference are hard constraints.
     *
     * <p><strong>Native rather than JPQL</strong>, because the locality filter is a jsonb
     * containment test ({@code @>}) that JPQL has no way to express — {@code localities} is a
     * shortlist the seeker typed, stored as a jsonb array and answered by the GIN index. In JPQL
     * this would have meant either loading every row to filter in Java, or a second column
     * duplicating the same data purely to make the query expressible.
     *
     * <p>Null-tolerant on every facet rather than a finder per combination, so the ordering and the
     * visibility predicate exist in exactly one copy.
     *
     * <p>The {@code mod_status} clause is not decoration: a flagged post must <em>disappear</em>
     * from the feed rather than merely render a different badge, or moderation is advisory. It is a
     * whitelist rather than the blacklist it used to be, for the reason
     * {@code FlatmateVocabulary.MOD_PUBLIC} gives — a state nobody thought about must default to
     * invisible, and since D72 {@code pending} is exactly such a state.
     */
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

    /** Backs the one-live-post rule's error message; the unique index is what actually enforces it. */
    boolean existsByUserIdAndArchivedFalse(UUID userId);

    /**
     * The moderation queue (D72), filtered to one state — in practice {@code pending}.
     *
     * <p>Archived rows are excluded because the author has already withdrawn them: deciding a post
     * that no longer exists wastes the moderator's time and can only produce a notification about
     * something the seeker has moved on from.
     */
    Page<FlatmateSeekerPost> findByModStatusAndArchivedFalse(String modStatus, Pageable pageable);
}
