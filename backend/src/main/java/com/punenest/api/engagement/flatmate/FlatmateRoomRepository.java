package com.punenest.api.engagement.flatmate;

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

    /** The {@code move-in} supply: live, unmoderated-away, newest first, optionally one locality. */
    @Query(value = """
            select r from FlatmateRoom r
            where r.archived = false
              and r.modStatus not in ('flagged','removed','rejected')
              and (:locality is null or lower(r.locality) = lower(:locality))
            order by r.createdAt desc, r.id desc
            """,
            countQuery = """
                    select count(r) from FlatmateRoom r
                    where r.archived = false
                      and r.modStatus not in ('flagged','removed','rejected')
                      and (:locality is null or lower(r.locality) = lower(:locality))
                    """)
    Page<FlatmateRoom> feed(@Param("locality") String locality, Pageable pageable);

    @Query("""
            select r from FlatmateRoom r
            where r.id = :id and r.archived = false
              and r.modStatus not in ('flagged','removed','rejected')
            """)
    Optional<FlatmateRoom> findVisible(@Param("id") UUID id);

    /**
     * Sibling rooms of one split flat. Every occupancy calculation has to count people across the
     * whole flat, so this sits on the hot path of both reading and writing a split room.
     */
    List<FlatmateRoom> findByPropertyIdAndArchivedFalse(UUID propertyId);

    /**
     * Live non-owner-tier rooms this host holds — half of the anti-broker cap.
     *
     * <p>Owner-tier rooms are excluded from the count on purpose: a verified owner letting a flat
     * room by room legitimately holds several, and counting them would penalise exactly the supply
     * the platform most wants. They are still subject to the address dedupe.
     */
    @Query("""
            select count(r) from FlatmateRoom r
            where r.hostId = :hostId and r.archived = false
              and r.verificationTier <> 'owner'
              and (r.seatsOpen is null or r.seatsOpen > 0)
            """)
    long countCappedByHost(@Param("hostId") UUID hostId);

    /** Live claims on one physical address, for the duplicate/contested check. */
    List<FlatmateRoom> findByAddressFingerprintAndArchivedFalse(String fingerprint);

    List<FlatmateRoom> findByHostIdAndArchivedFalseOrderByCreatedAtDesc(UUID hostId);
}
