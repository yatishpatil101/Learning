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
