package com.punenest.api.engagement.flatmate;

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
     *
     * <p><strong>{@code verifiedOnly} matches {@code roomMatches} in {@code helpers.js} branch for
     * branch.</strong> The board keeps a room when the listing itself is verified <em>or</em> its
     * host is: owner tier outright, tenant tier once Ops has approved the agreement behind the
     * claim. Only the first branch used to be here, because the Ops verdict lived in
     * {@code localStorage} and no server-side query could see it — so an approved tenant-tier host
     * was dropped by the filter no matter what Ops decided. The verdict now travels on the wire
     * ({@link FlatmateReviewStatuses}), so the clause can finally say what the board says. Keeping
     * the two in step matters more than it looks: they are applied to the same page, one before it
     * is sent and one after, so any disagreement shows up as a card count that changes for no
     * visible reason.
     */
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
              and (:verifiedOnly is null or :verifiedOnly = false or r.verified = true
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
                      and (:verifiedOnly is null or :verifiedOnly = false or r.verified = true
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

    /**
     * Sibling rooms of one split flat. Every occupancy calculation has to count people across the
     * whole flat, so this sits on the hot path of both reading and writing a split room.
     */
    List<FlatmateRoom> findByPropertyIdAndArchivedFalse(UUID propertyId);

    /**
     * The same ledger, for many flats at once (D212) — {@code propertyId → people committed}.
     *
     * <p>A page of room cards can span twenty flats, and each card's {@code occupancy},
     * {@code flatCommitted} and {@code shareMax} are derived from its flat's total. Asking
     * {@link #findByPropertyIdAndArchivedFalse} per row is not merely N queries: each row would see
     * a ledger built from a separate read, so two cards of the same flat could disagree.
     *
     * <p><strong>{@code archived} only, deliberately</strong> — the same width as the single-flat
     * finder, and for the same reason. Occupancy is a physical fact: a room still awaiting
     * moderation has people asleep in it, and leaving it out of the sum would report a full flat as
     * half empty. Moderation decides what is <em>shown</em>, never what is counted.
     */
    @Query("""
            select r.propertyId, sum(r.occupants) from FlatmateRoom r
            where r.propertyId in :propertyIds and r.archived = false
            group by r.propertyId
            """)
    List<Object[]> committedByFlat(@Param("propertyIds") Collection<UUID> propertyIds);

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

    /** The moderation queue (D72) — see {@code FlatmateSeekerPostRepository} for the same finder. */
    Page<FlatmateRoom> findByModStatusAndArchivedFalse(String modStatus, Pageable pageable);

    /**
     * Rooms this caller posted — {@code GET /me/flatmate-rooms}. The mirror of
     * {@code FlatmateGroupRepository.findMine}, down to the ordering.
     *
     * <p><strong>Deliberately unfiltered by {@code modStatus}, unlike {@link #feed}.</strong> The
     * public feed's {@code in ('live','approved')} floor is a statement about what a stranger may
     * see; the host is not a stranger, and a host who could not see their own pending or rejected
     * room would read D72 as the post having silently failed and would simply post it again — which
     * is the duplicate the guardrails then have to catch. Hiding a rejected room is also how a host
     * never learns why it was rejected.
     *
     * <p>{@code archived} <em>is</em> filtered, and that is not the same rule wearing a different
     * hat: a withdrawn room is one the host themselves took down, so leaving it out is showing them
     * the state they asked for rather than concealing a decision made about them.
     *
     * <p>No {@code join fetch} here, where the group's twin has one: a room owns no collection that
     * needs it. The two joins a room card wants — the host's name and the flat's occupancy ledger —
     * are batched a level up in {@link FlatmateRoomCards}, once for the whole window.
     */
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
