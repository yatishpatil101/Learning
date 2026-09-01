package com.punenest.api.catalog.property;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Spring Data access for {@link Property}. Extends {@link JpaSpecificationExecutor} so the public
 * search composes its facets as a {@link org.springframework.data.jpa.domain.Specification}
 * ({@link PropertySpecs}) rather than a combinatorial explosion of derived-query methods — the
 * predicate it builds (forced {@code archived=false AND status='approved'} + the equality/range
 * facets) is exactly what the partial {@code idx_properties_search} covers.
 *
 * <p>The detail/owner-scoped finders pull the owner via an {@link EntityGraph} so the owner summary
 * is initialized inside the service transaction — the DTO can be mapped at the controller edge
 * without a lazy-load blowing up, and without an N+1 across a page of listings.
 */
public interface PropertyRepository
        extends JpaRepository<Property, UUID>, JpaSpecificationExecutor<Property> {

    /** By-id with the owner eagerly attached, for the public detail projection. */
    @Override
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findById(UUID id);

    /** By-slug with the owner attached — the contract path param accepts a slug or id. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlug(String slug);

    /**
     * Does a direct link to this listing resolve for an anonymous caller? The existence-check form of
     * {@link Property#isDirectlyReachable()}, for public reads that only need 404-or-not.
     *
     * <p>Pass {@link PropertyStatus#DIRECTLY_REACHABLE}. Deliberately not {@code existsById}: that
     * answers "is there a row", which is a different and more generous question. A public endpoint
     * asking it becomes an existence oracle — someone holding a UUID from a cached page or an old
     * sitemap gets a 404 from the detail route and a 200 here, which tells them a listing moderation
     * rejected, or an owner archived, is still on file. No {@link EntityGraph}, no hydration: this is
     * an index probe, so applying the floor costs nothing over the check it replaces.
     */
    boolean existsByIdAndArchivedFalseAndStatusIn(UUID id, Collection<String> statuses);

    /** Owner-scoped single fetch by id (returns empty for another owner's row → 404, never a leak). */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findByIdAndOwner_Id(UUID id, UUID ownerId);

    /** Owner-scoped single fetch by slug. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlugAndOwner_Id(String slug, UUID ownerId);

    /**
     * Load a listing for an ops write against its verification state, holding a row lock until the
     * transaction commits (D202).
     *
     * <p>Granting the ownership badge is check-then-act: read the evidence, decide whether the gate
     * is clear, and write {@code ownership_verified*} — and the write is conditional on what the
     * read saw, including whether the listing was <em>already</em> verified. Two ops users acting at
     * the same moment both read "not yet verified", both grant, and both announce; the referral
     * credit downstream is only saved from paying twice by a second lock of its own
     * ({@code ReferralRepository#findPendingForQualification}), which is a guarantee this path
     * should not be borrowing. The lock makes the read and the write one step, so the second caller
     * sees the first one's decision.
     *
     * <p>No {@link EntityGraph} here on purpose: {@code select ... for update} and an outer join do
     * not mix in PostgreSQL, and the owner is reachable lazily inside the same transaction.
     *
     * <p><strong>Lock order: {@code properties} then {@code referrals}, never the reverse.</strong>
     * Granting the badge announces inside the same transaction, and the announcement takes a
     * pessimistic lock on {@code referrals}. Nothing today locks a referral and then reaches a
     * listing, so the order is acyclic — but it is a two-lock protocol now, and it is only visible
     * by reading three files. An ops feature that decides a referral and then touches its property
     * closes the cycle.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Property p where p.id = :id")
    Optional<Property> findForVerificationDecision(@Param("id") UUID id);

    /** The caller's own listings (all statuses incl. archived), owner-scoped; hits idx_properties_owner. */
    @EntityGraph(attributePaths = "owner")
    Page<Property> findByOwner_Id(UUID ownerId, Pageable pageable);

    /**
     * Just the ids of an owner's listings — the key set the contacts feature needs to scope an owner's
     * inbox, since {@code contact_requests} has no {@code owner_id} column of its own.
     *
     * <p>A projection rather than {@code findByOwner_Id(...).map(Property::getId)} because the caller
     * wants none of the 40-odd listing columns and none of the owner graph; this is an index-only read
     * against {@code idx_properties_owner}.
     */
    @Query("select p.id from Property p where p.owner.id = :ownerId")
    List<UUID> findIdsByOwnerId(@Param("ownerId") UUID ownerId);

    /**
     * Listings by <em>other</em> owners that look like the same unit as the one being written (V79).
     *
     * <p>Two independent signals, OR'd, because they fail in opposite directions and neither is
     * available on every listing:
     *
     * <ul>
     *   <li>the electricity meter number — near-certain when both sides have one, and most do not;</li>
     *   <li>normalised address within a locality — the one that fires when the meter is null, which
     *       is the common case. See {@link AddressKey} for what "normalised" means.</li>
     * </ul>
     *
     * <p><strong>Why there is no society arm.</strong> {@code (society_id, floor, bhk)} is the
     * highest-precision signal available for flats, and it was here, and it had to come out. The
     * reason is that {@code society_id} is <em>asserted by the client</em> on create and update.
     * There is a foreign key, so the id has to name a society that exists — but that is a check on
     * the id, not on the claim, and nothing links an owner to the society they name. Every real
     * society in Pune is an id an attacker may legitimately supply. Feed the probe one with a floor
     * and a BHK and the flag it raises tells you whether that unit is listed — including listings
     * still {@code pending}, which no public route will admit exist. Repeat, and you have a
     * unit-by-unit census of the building. A signal an attacker can supply in full is not a signal
     * about the world; it is a query. Bring it back when an owner has to prove they belong to a
     * society before naming it, and the arm becomes what its precision suggests.
     *
     * <p><strong>Absent signals match nothing, and no guard is needed to make that true.</strong>
     * The obvious worry is that a listing with no meter number matches every other listing with no
     * meter number. It does not: SQL equality against {@code NULL} is <em>unknown</em>, never true,
     * so an arm whose parameter is null simply drops out of the OR. Explicit {@code :param is not
     * null} guards were tried here and removed — they read as load-bearing while doing nothing, and
     * a guard that cannot fail is worse than no guard, because the next reader trusts it. What this
     * does depend on is every arm staying a plain {@code =}; a {@code coalesce} added later to
     * "handle nulls" would turn absence into a match. {@code ListingNoticesTest} holds that line.
     *
     * <p><strong>Only other owners, and only live listings.</strong> {@code owner.id <> :ownerId}
     * because the same person listing their own flat twice is a housekeeping mistake, not fraud, and
     * flagging it to ops teaches them to ignore the flag. Rejected and archived listings are
     * excluded because a duplicate of something already taken down is not a live conflict.
     *
     * <p>Capped by the caller via {@link Pageable}: the answer to "is this a duplicate" needs one
     * row, and the ops note names a couple. An unbounded {@code List} here is one bad address key
     * away from loading a locality into memory.
     *
     * <p><strong>Deliberately unordered.</strong> Both OR arms are backed by their own partial index
     * (V79), which Postgres combines with a bitmap OR — but only while it is free to return rows in
     * whatever order it finds them. Adding {@code order by p.created_at} makes an ordered walk of
     * {@code properties} the cheapest way to produce the first two rows, so the common case, a
     * create that matches nothing, scans the whole table before answering "no". Every create and
     * every signal-changing edit would pay it. The caller sorts the couple of rows it gets back,
     * which is where sorting two things belongs.
     */
    @Query("""
            select p from Property p
            where p.owner.id <> :ownerId
              and p.archived = false
              and p.status in :statuses
              and (
                    p.electricityMeterNo = :meter
                 or (p.addressKey = :addressKey and p.localitySlug = :localitySlug)
              )
            """)
    List<Property> findDuplicateCandidates(
            @Param("ownerId") UUID ownerId,
            @Param("statuses") Collection<String> statuses,
            @Param("meter") String meter,
            @Param("addressKey") String addressKey,
            @Param("localitySlug") String localitySlug,
            Pageable pageable);

    /**
     * Recently created listings that carry something for the duplicate probe to compare — the input
     * to the catch-up sweep.
     *
     * <p><strong>Why a sweep exists at all.</strong> {@link #findDuplicateCandidates} runs inside
     * the transaction that creates the listing, under {@code READ COMMITTED}, so it cannot see a
     * sibling submission that has not committed yet. Two identical listings posted in the same
     * second therefore each read a world without the other and neither is flagged — which is the
     * precise shape of the abuse the probe exists to catch, since a broker uploading one flat twice
     * does it from a script, not by hand a day apart.
     *
     * <p>The window is deliberately generous relative to the sweep's period, so that a listing is
     * re-read a couple of times rather than exactly once: a sweep tick that dies mid-run, or a
     * deploy that lands between two ticks, would otherwise leave a permanent hole in coverage at a
     * cost of one indexed range scan.
     *
     * <p>The signal predicate is the same early-out {@code ListingDuplicateProbe#flag} applies for
     * itself, hoisted into SQL: most listings carry neither a meter number nor an address key, and
     * fetching them only to return immediately would make the sweep's cost the create rate rather
     * than the rate of listings it can actually say something about.
     *
     * <p><strong>The ordering is load-bearing, unlike {@link #findDuplicateCandidates}'s absence of
     * one.</strong> There the result is capped at two rows and order is genuinely irrelevant. Here
     * the caller passes a per-tick ceiling, and an unordered page under a stable plan returns the
     * <em>same</em> arbitrary subset every tick — so once the window holds more listings than the
     * ceiling (a bulk import, a seed backfill, a launch-day spike) the remainder is never swept and
     * then ages out of the window forever. Oldest-first makes the overflow a backlog the next tick
     * inherits rather than rows that are silently dropped, and the only symptom of getting this
     * wrong would have been a log line that reads like a queue catching up.
     *
     * <p>There is no index on {@code created_at}; the plan is a bitmap-OR over the two partial
     * signal indexes with the window applied as a filter, so cost tracks the total number of
     * signal-carrying listings rather than the window. That is fine at this size and is the thing
     * to look at first if this ever shows up in slow-query logs.
     */
    @Query("""
            select p from Property p
            where p.createdAt >= :since
              and p.archived = false
              and p.status in :statuses
              and (p.electricityMeterNo is not null or p.addressKey is not null)
            order by p.createdAt asc
            """)
    List<Property> findRecentSignalCarrying(
            @Param("since") Instant since,
            @Param("statuses") Collection<String> statuses,
            Pageable pageable);

    /**
     * Stamp {@code owner_verified} onto every listing an owner holds — the write that makes the
     * identity badge visible to buyers, called when DigiLocker confirms.
     *
     * <p><strong>Every listing, deliberately.</strong> No {@code status} filter and no
     * {@code archived} filter: the badge belongs to the <em>owner</em>, not to any one listing's
     * lifecycle. A pending listing owned by a verified person has a verified owner, and an archived
     * one must not come back from restore claiming otherwise.
     *
     * <p>A bulk update rather than a read-modify-write loop because the caller wants none of the
     * forty-odd listing columns and none of the owner graph; it is also the only form that stays one
     * statement for an owner with a large portfolio.
     *
     * <p><strong>{@code clearAutomatically} is not optional here.</strong> A bulk update runs as SQL
     * and the persistence context never hears about it, so any {@link Property} already managed in
     * the same transaction keeps serving the pre-update value from the first-level cache. That is
     * invisible in production, where the webhook transaction has no listing attached — and fatal in
     * the tests, which are {@code @Transactional} and hold the very rows they are about to assert on.
     * A version without this reads {@code false} straight after a successful write. {@code flush}
     * pairs with it so pending changes are not lost to the clear.
     *
     * @return how many listings were stamped — zero for a verified user who owns nothing
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Property p set p.ownerVerified = true where p.owner.id = :ownerId and p.ownerVerified = false")
    int markOwnerVerified(@Param("ownerId") UUID ownerId);

    /**
     * Withdraw the denormalised owner badge from every listing this owner holds.
     *
     * <p>The exact mirror of {@link #markOwnerVerified}, down to the absence of a {@code status} or
     * {@code archived} filter and the {@code clearAutomatically}/{@code flushAutomatically} pair —
     * both are load-bearing for the same reasons documented there, and diverging them would leave
     * one direction correct and the other subtly not.
     *
     * @return how many listings were cleared — zero for an owner who owns nothing
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Property p set p.ownerVerified = false where p.owner.id = :ownerId and p.ownerVerified = true")
    int markOwnerUnverified(@Param("ownerId") UUID ownerId);

    /**
     * Featured-first live listings for the homepage strip. Featured desc puts {@code true} ahead of
     * {@code false}; the {@link Pageable} caps the result (the contract endpoint takes no limit).
     * Summary projection only, so no owner graph.
     */
    List<Property> findByStatusAndArchivedFalseOrderByFeaturedDescCreatedAtDesc(
            String status, Pageable limit);

    /**
     * Live listings for one society, newest first — the {@code homes} array on the society hub.
     * Summary projection, so no owner graph and no contact data.
     */
    List<Property> findBySocietyIdAndStatusAndArchivedFalseOrderByCreatedAtDesc(
            UUID societyId, String status, Pageable limit);

    /**
     * Live-listing counts grouped by locality slug — the whole catalogue in one query.
     *
     * <p><strong>Why counts are computed and not stored.</strong> {@code localities.listing_count}
     * (and its siblings on {@code societies} and {@code cities}) exists in the schema and has never
     * had a writer. At the time slice 7 was planned, three of fifteen rows already disagreed with
     * reality — and the disagreement was not drift: the stored number counts <em>every</em>
     * property, while every surface that displays it means approved and unarchived ones. A stale
     * counter can be refreshed; a counter that measures the wrong thing was wrong the day it was
     * written.
     *
     * <p>One grouped aggregate per list endpoint, never one count per row. On a catalogue of tens of
     * localities this is cheaper than the join it replaces, and — unlike a stored column — it cannot
     * be wrong.
     *
     * @return rows of {@code [localitySlug, count]}; localities with no live listing are absent
     */
    @Query("""
            select p.localitySlug, count(p)
            from Property p
            where p.status = :status and p.archived = false and p.localitySlug is not null
            group by p.localitySlug""")
    List<Object[]> countLiveByLocalitySlug(@Param("status") String status);

    /** Live-listing counts grouped by society id. See {@link #countLiveByLocalitySlug}. */
    @Query("""
            select p.societyId, count(p)
            from Property p
            where p.status = :status and p.archived = false and p.societyId is not null
            group by p.societyId""")
    List<Object[]> countLiveBySocietyId(@Param("status") String status);

    /** Live-listing counts grouped by city name. See {@link #countLiveByLocalitySlug}. */
    @Query("""
            select lower(p.city), count(p)
            from Property p
            where p.status = :status and p.archived = false
            group by lower(p.city)""")
    List<Object[]> countLiveByCity(@Param("status") String status);

    /**
     * Live-listing count for a single locality.
     *
     * <p>The grouped queries above are right for a list endpoint and wrong for a detail one: a
     * detail read needs one number, and aggregating the whole catalogue to find it does work
     * proportional to the catalogue rather than to the answer.
     */
    long countByLocalitySlugAndStatusAndArchivedFalse(String localitySlug, String status);

    /** Live-listing count for a single society. See {@link #countByLocalitySlugAndStatusAndArchivedFalse}. */
    long countBySocietyIdAndStatusAndArchivedFalse(UUID societyId, String status);

    /**
     * Count live listings created after a baseline, filtered by optional deal/locality/bhk facets.
     *
     * <p>Used by D7 sweep to avoid loading full listing rows into memory for each alert.
     */
    @Query("""
            select count(p)
            from Property p
            where p.status = :status
              and p.archived = false
              and p.createdAt is not null
              and p.createdAt > :baseline
              and (:deal is null or lower(p.deal) = :deal)
              and (:localitiesEmpty = true
                   or lower(coalesce(p.localitySlug, p.locality)) in :localities)
              and (:bhkEmpty = true or cast(p.bhk as integer) in :bhkValues)
            """)
    long countVisibleCreatedAfterWithFilters(
            @Param("status") String status,
            @Param("baseline") Instant baseline,
            @Param("deal") String deal,
            @Param("localitiesEmpty") boolean localitiesEmpty,
            @Param("localities") List<String> localities,
            @Param("bhkEmpty") boolean bhkEmpty,
            @Param("bhkValues") List<Integer> bhkValues);
}
