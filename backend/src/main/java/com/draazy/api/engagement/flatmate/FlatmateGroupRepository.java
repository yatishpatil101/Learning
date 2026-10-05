package com.draazy.api.engagement.flatmate;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FlatmateGroupRepository extends JpaRepository<FlatmateGroup, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from FlatmateGroup g where g.id = :id and g.archived = false")
    Optional<FlatmateGroup> lockLive(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select g from FlatmateGroup g
            where g.id = :id and g.archived = false
              and g.modStatus in ('live','approved')
            """)
    Optional<FlatmateGroup> lockVisible(@Param("id") UUID id);

    @Query("""
            select g from FlatmateGroup g
            left join fetch g.members
            where g.id = :id and g.archived = false
              and g.modStatus in ('live','approved')
            """)
    Optional<FlatmateGroup> findVisible(@Param("id") UUID id);

    @Query("""
            select count(g) from FlatmateGroup g
            where g.hostId = :hostId and g.archived = false
              and g.verificationTier <> 'owner'
            """)
    long countCappedByHost(@Param("hostId") UUID hostId);

    List<FlatmateGroup> findByAddressFingerprintAndArchivedFalse(String fingerprint);

    @Query("""
            select g from FlatmateGroup g
            where g.archived = false and g.verificationTier = 'owner'
              and g.addressFingerprint like 'prop:%'
            """)
    List<FlatmateGroup> findOwnerTierClaims();

    @Query("""
            select g from FlatmateGroup g
            where g.archived = false and g.modStatus in ('live','approved')
              and g.expiry.activeUntil < :before and (g.expiry.reminded = false or :remindedToo = true)
            """)
    List<FlatmateGroup> findPublicActiveUntil(@Param("before") Instant before,
            @Param("remindedToo") boolean remindedToo);

    Page<FlatmateGroup> findByModStatusInAndArchivedFalse(Collection<String> modStatuses,
            Pageable pageable);

    Page<FlatmateGroup> findByRecheckRequestedAtNotNullAndArchivedFalse(Pageable pageable);

    /** {@code cast(:locality as string)} is required: with a bare parameter Hibernate binds a null as
     * {@code bytea} and PostgreSQL has no {@code lower(bytea)}, 500ing the unfiltered feed. */
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

    @Query("""
            select count(distinct m.group) from FlatmateGroupMember m
            where m.userId = :userId and m.group.archived = false and m.group.hostId <> :userId
            """)
    long countJoinedBy(@Param("userId") UUID userId);

    @Query("""
            select count(m) > 0 from FlatmateGroupMember m
            where m.group.id = :groupId and m.userId = :userId and m.group.archived = false
            """)
    boolean hasMember(@Param("groupId") UUID groupId, @Param("userId") UUID userId);

    @Query("""
            select m.userId from FlatmateGroupMember m
            where m.group.id = :groupId and m.userId is not null and m.group.archived = false
            """)
    List<UUID> memberUserIds(@Param("groupId") UUID groupId);

    @Query("""
            select distinct m.group.id from FlatmateGroupMember m
            where m.userId = :userId and m.group.archived = false
            """)
    List<UUID> groupIdsWithMember(@Param("userId") UUID userId);

    @Query("select g.id, g.title, size(g.members) from FlatmateGroup g where g.id in :ids")
    List<Object[]> titlesAndSizes(@Param("ids") Collection<UUID> ids);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update FlatmateGroupMember m set m.verified = :verified where m.userId = :userId and m.verified <> :verified")
    int copyMemberBadge(@Param("userId") UUID userId, @Param("verified") boolean verified);
}
