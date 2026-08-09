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

    /**
     * The {@code move-in} supply: live, unmoderated-away, newest first, filtered server-side by
     * locality and the room facets the page offers (gender, food, room type, furnishing, BHK,
     * budget range). Every facet is null-tolerant, so an absent one widens rather than narrows —
     * the unfiltered feed is the default page load and must stay a single query. {@code gender} and
     * {@code food} match a room whose own value is {@code any} as well as an exact hit, mirroring
     * the mock: a no-preference room is a candidate for every preference.
     *
     * <p><strong>Why {@code cast(:locality as string)}.</strong> With a bare {@code :locality}
     * Hibernate cannot infer the parameter type when the value is {@code null}, so it binds it as
     * {@code bytea} — and PostgreSQL has no {@code lower(bytea)}. The result is a 500 on the
     * <em>unfiltered</em> feed, which is the default page load: the one request that must never
     * fail. The cast tells Hibernate the type up front, so a null binds as a null string.
     *
     * <p><strong>Keep the cast, but do not expect a test to prove it.</strong> Removing it and
     * running the flatmate suites was tried (2026-08-08) and everything stayed green, with and
     * without seeded rows — the Hibernate version on the current Boot 4.1 line infers the type from
     * the {@code = lower(r.locality)} comparison on its own. So the cast is now defensive rather
     * than load-bearing <em>on this stack</em>. It stays because the inference is a version detail
     * nobody should have to re-derive, and because it costs nothing; but a mutation test on it
     * cannot go red, and that is expected rather than a gap in the suite.
     * {@code FlatmateNullFacetTest} therefore guards the observable contract — these feeds answer
     * 200 unfiltered — which is the thing that actually matters to a caller.
     */
    @Query(value = """
            select r from FlatmateRoom r
            where r.archived = false
              and r.modStatus not in ('flagged','removed','rejected')
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
            order by r.createdAt desc, r.id desc
            """,
            countQuery = """
                    select count(r) from FlatmateRoom r
                    where r.archived = false
                      and r.modStatus not in ('flagged','removed','rejected')
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
                    """)
    Page<FlatmateRoom> feed(@Param("locality") String locality,
            @Param("gender") String gender, @Param("food") String food,
            @Param("roomType") String roomType, @Param("furnishing") String furnishing,
            @Param("bhk") String bhk, @Param("minBudget") Long minBudget,
            @Param("maxBudget") Long maxBudget, Pageable pageable);

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
