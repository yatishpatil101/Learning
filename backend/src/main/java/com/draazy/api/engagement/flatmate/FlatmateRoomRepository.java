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
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FlatmateRoomRepository extends JpaRepository<FlatmateRoom, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from FlatmateRoom r where r.id = :id and r.archived = false")
    Optional<FlatmateRoom> lockLive(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select r from FlatmateRoom r
            where r.propertyId = :propertyId and r.archived = false
            order by r.id
            """)
    List<FlatmateRoom> lockFlat(@Param("propertyId") UUID propertyId);

    @Query("select r.propertyId from FlatmateRoom r where r.id = :id and r.propertyId is not null")
    Optional<UUID> findPropertyId(@Param("id") UUID id);

    @Query("""
            select r from FlatmateRoom r
            where r.id = :id and r.archived = false
              and r.modStatus in ('live','approved')
            """)
    Optional<FlatmateRoom> findVisible(@Param("id") UUID id);

    List<FlatmateRoom> findByPropertyIdAndArchivedFalse(UUID propertyId);

    /** Filtered on {@code archived} only, matching {@link #findByPropertyIdAndArchivedFalse}:
     * occupancy is a physical fact, so moderation decides what is shown, never what is counted. */
    @Query("""
            select r.propertyId, sum(r.occupants) from FlatmateRoom r
            where r.propertyId in :propertyIds and r.archived = false
            group by r.propertyId
            """)
    List<Object[]> committedByFlat(@Param("propertyIds") Collection<UUID> propertyIds);

    /** Half of the anti-broker cap. Owner tier is excluded because a verified owner letting a flat
     * room by room legitimately holds several; they are still subject to the address dedupe. */
    @Query("""
            select count(r) from FlatmateRoom r
            where r.hostId = :hostId and r.archived = false
              and r.verificationTier <> 'owner'
              and (r.seatsOpen is null or r.seatsOpen > 0)
            """)
    long countCappedByHost(@Param("hostId") UUID hostId);

    /** Live claims on one physical address, for the duplicate/contested check. */
    List<FlatmateRoom> findByAddressFingerprintAndArchivedFalse(String fingerprint);

    /** {@code FlatmateGuardrails.fingerprint} writes a {@code prop:} fingerprint only for
     * owner tier, so that prefix names exactly the flat whose Ops approval bought the badge. */
    @Query("""
            select r from FlatmateRoom r
            where r.archived = false and r.verificationTier = 'owner'
              and r.addressFingerprint like 'prop:%'
            """)
    List<FlatmateRoom> findOwnerTierClaims();

    @Query("""
            select r from FlatmateRoom r
            where r.archived = false and r.modStatus in ('live','approved')
              and r.expiry.activeUntil < :before and (r.expiry.reminded = false or :remindedToo = true)
            """)
    List<FlatmateRoom> findPublicActiveUntil(@Param("before") Instant before,
            @Param("remindedToo") boolean remindedToo);

    List<FlatmateRoom> findByHostIdAndArchivedFalseOrderByCreatedAtDesc(UUID hostId);

    Page<FlatmateRoom> findByModStatusInAndArchivedFalse(Collection<String> modStatuses,
            Pageable pageable);

    /** Deliberately not filtered by {@code modStatus} — a re-check means the room stayed visible,
     * so its state is whatever publication left it at. */
    Page<FlatmateRoom> findByRecheckRequestedAtNotNullAndArchivedFalse(Pageable pageable);

    long countByModStatusInAndArchivedFalse(Collection<String> modStatuses);

    long countByRecheckRequestedAtNotNullAndArchivedFalse();

    /** Deliberately unfiltered by {@code modStatus}, unlike {@link #feed}: a host who cannot see
     * their own pending room posts it again. {@code archived} is what the host took down. */
    /** {@code cast(:x as string)} because Hibernate binds an untyped null as {@code bytea}, and
     * PostgreSQL has no {@code lower(bytea)}. {@code verifiedOnly} must match {@code hostVerifiedFor}. */
    @Query(value = """
            select r from FlatmateRoom r
            where r.hostId = :hostId and r.archived = false
            order by r.createdAt desc, r.id desc
            """,
            countQuery = """
                    select count(r) from FlatmateRoom r
                    where r.hostId = :hostId and r.archived = false
                    """)
    Page<FlatmateRoom> findMine(@Param("hostId") UUID hostId, Pageable pageable);
}
