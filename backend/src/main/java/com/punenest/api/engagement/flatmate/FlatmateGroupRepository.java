package com.punenest.api.engagement.flatmate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code flatmate_groups} (V27). */
public interface FlatmateGroupRepository extends JpaRepository<FlatmateGroup, UUID> {

    /**
     * Live groups, newest first, filtered server-side by locality plus the two group facets the
     * page offers: join policy and per-flat rent range. Null-tolerant like the room feed, and
     * {@code policy} matches an {@code any}/open group as well as an exact hit, mirroring the mock.
     *
     * <p>{@code left join fetch} on members: every card renders them, and without it a page of
     * twenty groups is twenty-one queries. Left, not inner, because a group with no members yet is
     * still a group — an inner join would silently hide every brand-new one.
     *
     * <p><strong>Why {@code cast(:locality as string)}.</strong> With a bare {@code :locality}
     * Hibernate cannot infer the parameter type when the value is {@code null}, so it binds it as
     * {@code bytea} — and PostgreSQL has no {@code lower(bytea)}. The result is a 500 on the
     * <em>unfiltered</em> feed, which is the default page load. See
     * {@link FlatmateRoomRepository#feed} for why this is defensive rather than load-bearing on the
     * current stack, and why no test can prove it.
     */
    @Query(value = """
            select distinct g from FlatmateGroup g
            left join fetch g.members
            where g.archived = false
              and g.modStatus in ('live','approved')
              and (cast(:locality as string) is null
                   or lower(g.locality) = lower(cast(:locality as string)))
              and (cast(:policy as string) is null
                   or g.policy = cast(:policy as string) or g.policy = 'any')
              and (:minRent is null or g.rent >= :minRent)
              and (:maxRent is null or g.rent <= :maxRent)
            order by g.createdAt desc, g.id desc
            """,
            countQuery = """
                    select count(g) from FlatmateGroup g
                    where g.archived = false
                      and g.modStatus in ('live','approved')
                      and (cast(:locality as string) is null
                           or lower(g.locality) = lower(cast(:locality as string)))
                      and (cast(:policy as string) is null
                           or g.policy = cast(:policy as string) or g.policy = 'any')
                      and (:minRent is null or g.rent >= :minRent)
                      and (:maxRent is null or g.rent <= :maxRent)
                    """)
    Page<FlatmateGroup> feed(@Param("locality") String locality, @Param("policy") String policy,
            @Param("minRent") Long minRent, @Param("maxRent") Long maxRent, Pageable pageable);

    @Query("""
            select g from FlatmateGroup g
            left join fetch g.members
            where g.id = :id and g.archived = false
              and g.modStatus in ('live','approved')
            """)
    Optional<FlatmateGroup> findVisible(@Param("id") UUID id);

    /** Live non-owner-tier groups this host holds — the other half of the anti-broker cap. */
    @Query("""
            select count(g) from FlatmateGroup g
            where g.hostId = :hostId and g.archived = false
              and g.verificationTier <> 'owner'
            """)
    long countCappedByHost(@Param("hostId") UUID hostId);

    List<FlatmateGroup> findByAddressFingerprintAndArchivedFalse(String fingerprint);

    /** The moderation queue (D72) — see {@code FlatmateSeekerPostRepository} for the same finder. */
    Page<FlatmateGroup> findByModStatusAndArchivedFalse(String modStatus, Pageable pageable);

    /**
     * Groups this caller started — {@code GET /me/flatmate-groups}.
     *
     * <p>Unfiltered by {@code modStatus}, unlike {@link #feed}: a host must be able to see their own
     * group while it is still waiting on moderation, or D72 would look to them like the post having
     * silently failed. The public feed's filter is about what strangers may see, and this is not a
     * stranger.
     *
     * <p>{@code left join fetch} on members for the same reason {@link #feed} has it — every caller
     * of this renders the member list, and without it a host with four groups pays five queries.
     */
    @Query(value = """
            select distinct g from FlatmateGroup g
            left join fetch g.members
            where g.hostId = :hostId and g.archived = false
            order by g.createdAt desc, g.id desc
            """,
            countQuery = """
                    select count(g) from FlatmateGroup g
                    where g.hostId = :hostId and g.archived = false
                    """)
    Page<FlatmateGroup> findMine(@Param("hostId") UUID hostId, Pageable pageable);
}
