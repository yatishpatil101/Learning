package com.draazy.api.engagement.flatmate;

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

    /** {@code cast(:locality as string)} is required: with a bare parameter Hibernate binds a null as
     * {@code bytea} and PostgreSQL has no {@code lower(bytea)}, 500ing the unfiltered feed. */
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
              and (:verifiedOnly is null or :verifiedOnly = false
                   or g.verificationTier = 'owner'
                   or (g.verificationTier = 'tenant'
                       and exists (select 1 from FlatmateReview fr
                                   where fr.groupId = g.id and fr.status = 'approved'))
                   or (g.members is not empty
                       and not exists (select 1 from FlatmateGroupMember m
                                       where m.group = g and m.verified = false)))
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
                      and (:verifiedOnly is null or :verifiedOnly = false
                           or g.verificationTier = 'owner'
                           or (g.verificationTier = 'tenant'
                               and exists (select 1 from FlatmateReview fr
                                           where fr.groupId = g.id and fr.status = 'approved'))
                           or (g.members is not empty
                               and not exists (select 1 from FlatmateGroupMember m
                                               where m.group = g and m.verified = false)))
                    """)
    Page<FlatmateGroup> feed(@Param("locality") String locality, @Param("policy") String policy,
            @Param("minRent") Long minRent, @Param("maxRent") Long maxRent,
            @Param("verifiedOnly") Boolean verifiedOnly, Pageable pageable);

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

    /** The group twin of {@link FlatmateRoomRepository#findOwnerTierClaims}, same prefix, same why. */
    @Query("""
            select g from FlatmateGroup g
            where g.archived = false and g.verificationTier = 'owner'
              and g.addressFingerprint like 'prop:%'
            """)
    List<FlatmateGroup> findOwnerTierClaims();

    /** The moderation queue — see {@code FlatmateSeekerPostRepository} for the same finder. */
    Page<FlatmateGroup> findByModStatusAndArchivedFalse(String modStatus, Pageable pageable);

    /** The re-check queue — see {@code FlatmateRoomRepository} for why it ignores {@code modStatus}. */
    Page<FlatmateGroup> findByRecheckRequestedAtNotNullAndArchivedFalse(Pageable pageable);

    /** Unfiltered by {@code modStatus}, unlike {@link #feed}: a host must see their own group while
     * it is still pending, or it would look to them like it had silently failed. */
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
