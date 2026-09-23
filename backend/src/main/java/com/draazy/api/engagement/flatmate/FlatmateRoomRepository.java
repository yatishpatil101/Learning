package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code flatmate_rooms} (V27). */
public interface FlatmateRoomRepository extends JpaRepository<FlatmateRoom, UUID> {

    /** {@code cast(:x as string)} because Hibernate binds an untyped null as {@code bytea}, and
     * PostgreSQL has no {@code lower(bytea)}. {@code verifiedOnly} must match {@code hostVerifiedFor}. */
    @Query(value = """
            select r from FlatmateRoom r
            where r.archived = false
              and r.modStatus in ('live','approved')
              and (cast(:locality as string) is null
                   or lower(r.locality) = lower(cast(:locality as string)))
              and (cast(:gender as string) is null
                   or r.gender = cast(:gender as string) or r.gender = 'any')
              and (cast(:food as string) is null
                   or r.food = cast(:food as string) or r.food = 'any')
              and (cast(:roomType as string) is null or r.roomType = cast(:roomType as string))
              and (cast(:furnishing as string) is null or r.furnishing = cast(:furnishing as string))
              and (cast(:bhk as string) is null or r.bhk = cast(:bhk as string))
              and (:minBudget is null or r.budget >= :minBudget)
              and (:maxBudget is null or r.budget <= :maxBudget)
              and (:verifiedOnly is null or :verifiedOnly = false
                   or r.verificationTier = 'owner'
                   or (r.verificationTier = 'tenant'
                       and exists (select 1 from FlatmateReview fr
                                   where fr.roomId = r.id and fr.status = 'approved')))
            order by r.createdAt desc, r.id desc
            """,
            countQuery = """
                    select count(r) from FlatmateRoom r
                    where r.archived = false
                      and r.modStatus in ('live','approved')
                      and (cast(:locality as string) is null
                           or lower(r.locality) = lower(cast(:locality as string)))
                      and (cast(:gender as string) is null
                           or r.gender = cast(:gender as string) or r.gender = 'any')
                      and (cast(:food as string) is null
                           or r.food = cast(:food as string) or r.food = 'any')
                      and (cast(:roomType as string) is null or r.roomType = cast(:roomType as string))
                      and (cast(:furnishing as string) is null or r.furnishing = cast(:furnishing as string))
                      and (cast(:bhk as string) is null or r.bhk = cast(:bhk as string))
                      and (:minBudget is null or r.budget >= :minBudget)
                      and (:maxBudget is null or r.budget <= :maxBudget)
                      and (:verifiedOnly is null or :verifiedOnly = false
                           or r.verificationTier = 'owner'
                           or (r.verificationTier = 'tenant'
                               and exists (select 1 from FlatmateReview fr
                                           where fr.roomId = r.id and fr.status = 'approved')))
                    """)
    Page<FlatmateRoom> feed(@Param("locality") String locality,
            @Param("gender") String gender, @Param("food") String food,
            @Param("roomType") String roomType, @Param("furnishing") String furnishing,
            @Param("bhk") String bhk, @Param("minBudget") Long minBudget,
            @Param("maxBudget") Long maxBudget, @Param("verifiedOnly") Boolean verifiedOnly,
            Pageable pageable);

    @Query("""
            select r from FlatmateRoom r
            where r.id = :id and r.archived = false
              and r.modStatus in ('live','approved')
            """)
    Optional<FlatmateRoom> findVisible(@Param("id") UUID id);

    /** Sibling rooms of one split flat — occupancy is counted across the whole flat. */
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

    /** {@code FlatmateGuardrails.fingerprint} writes a {@code prop:<uuid>} fingerprint only for
     * owner tier, so that prefix names exactly the flat whose Ops approval bought the badge. */
    @Query("""
            select r from FlatmateRoom r
            where r.archived = false and r.verificationTier = 'owner'
              and r.addressFingerprint like 'prop:%'
            """)
    List<FlatmateRoom> findOwnerTierClaims();

    /** {@code updatedAt} rather than {@code createdAt}: any edit says the room is still going.
     * V01's {@code set_updated_at} trigger maintains it for writes that bypass Hibernate. */
    @Query("select r from FlatmateRoom r where r.archived = false and r.updatedAt < :since")
    List<FlatmateRoom> findStale(@Param("since") Instant since);

    List<FlatmateRoom> findByHostIdAndArchivedFalseOrderByCreatedAtDesc(UUID hostId);

    /** The moderation queue — see {@code FlatmateSeekerPostRepository} for the same finder. */
    Page<FlatmateRoom> findByModStatusAndArchivedFalse(String modStatus, Pageable pageable);

    /** Deliberately not filtered by {@code modStatus} — a re-check means the room stayed visible,
     * so its state is whatever publication left it at. */
    Page<FlatmateRoom> findByRecheckRequestedAtNotNullAndArchivedFalse(Pageable pageable);

    /** Deliberately unfiltered by {@code modStatus}, unlike {@link #feed}: a host who cannot see
     * their own pending room posts it again. {@code archived} is what the host took down. */
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
