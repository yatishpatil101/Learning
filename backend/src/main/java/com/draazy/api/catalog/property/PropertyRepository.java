package com.draazy.api.catalog.property;

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
 * Spring Data access for {@link Property}: {@link JpaSpecificationExecutor} for the faceted public
 * search, {@link EntityGraph} finders against N+1. Rationale: docs/system/data-model.md.
 */
public interface PropertyRepository
        extends JpaRepository<Property, UUID>, JpaSpecificationExecutor<Property>,
        PropertySearchFragment {

    /** By-id with the owner eagerly attached, for the public detail projection. */
    @Override
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findById(UUID id);

    /** By-slug with the owner attached — the contract path param accepts a slug or id. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlug(String slug);

    /**
     * Does a direct link resolve for an anonymous caller? Pass {@link PropertyStatus#DIRECTLY_REACHABLE};
     * {@code existsById} would make a public endpoint an existence oracle (docs/system/data-model.md).
     */
    boolean existsByIdAndArchivedFalseAndStatusIn(UUID id, Collection<String> statuses);

    /** Owner-scoped single fetch by id (returns empty for another owner's row → 404, never a leak). */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findByIdAndOwner_Id(UUID id, UUID ownerId);

    /** Owner-scoped single fetch by slug. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlugAndOwner_Id(String slug, UUID ownerId);

    /**
     * Load a listing for an ops write against its verification state under a row lock (check-then-act).
     * <strong>Lock order: {@code properties} then {@code referrals}, never the reverse.</strong>
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Property p where p.id = :id")
    Optional<Property> findForVerificationDecision(@Param("id") UUID id);

    /** The caller's own listings (all statuses incl. archived), owner-scoped; hits idx_properties_owner. */
    @EntityGraph(attributePaths = "owner")
    Page<Property> findByOwner_Id(UUID ownerId, Pageable pageable);

    /**
     * Just the ids of an owner's listings - the key set contacts needs, since {@code contact_requests}
     * has no {@code owner_id}. A projection: an index-only read against {@code idx_properties_owner}.
     */
    @Query("select p.id from Property p where p.owner.id = :ownerId")
    List<UUID> findIdsByOwnerId(@Param("ownerId") UUID ownerId);

    /**
     * Listings by <em>other</em> owners that look like the same unit: two OR'd signals, each a plain
     * {@code =} so a null arm matches nothing. No society arm, no {@code ORDER BY}: data-model.md.
     */
    @Query("""
            select p from Property p
            where p.owner.id <> :ownerId
              and p.archived = false
              and p.status in :statuses
              and (
                    p.electricityMeterKey = :meter
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
     * The same question turned around: this owner's own near-duplicates. Every clause matches
     * {@link #findDuplicateCandidates} except the owner comparison, and the two must not diverge.
     */
    @Query("""
            select p from Property p
            where p.owner.id = :ownerId
              and p.archived = false
              and p.status in :statuses
              and (
                    p.electricityMeterKey = :meter
                 or (p.addressKey = :addressKey and p.localitySlug = :localitySlug)
              )
            """)
    List<Property> findOwnDuplicateCandidates(
            @Param("ownerId") UUID ownerId,
            @Param("statuses") Collection<String> statuses,
            @Param("meter") String meter,
            @Param("addressKey") String addressKey,
            @Param("localitySlug") String localitySlug,
            Pageable pageable);

    /**
     * Recently created listings carrying a duplicate signal - the catch-up sweep for siblings the
     * create-time probe could not see. <strong>Oldest first is load-bearing</strong>: data-model.md.
     */
    @Query("""
            select p from Property p
            where p.createdAt >= :since
              and p.archived = false
              and p.status in :statuses
              and (p.electricityMeterKey is not null
                or p.addressKey is not null
                or exists (select 1 from PropertyPhotoHash h where h.propertyId = p.id))
            order by p.createdAt asc
            """)
    List<Property> findRecentSignalCarrying(
            @Param("since") Instant since,
            @Param("statuses") Collection<String> statuses,
            Pageable pageable);

    /**
     * Every listing carrying a duplicate signal - the ops desk's clustering read. <strong>A full page
     * must be treated as truncation</strong>, since clustering is pairwise: data-model.md.
     */
    @Query("""
            select p from Property p
            where p.archived = false
              and p.status in :statuses
              and (p.electricityMeterKey is not null
                or p.addressKey is not null
                or exists (select 1 from PropertyPhotoHash h where h.propertyId = p.id))
            order by p.createdAt desc
            """)
    List<Property> findSignalCarrying(
            @Param("statuses") Collection<String> statuses,
            Pageable pageable);

    /**
     * Stamp {@code owner_verified} onto <em>every</em> listing an owner holds: the badge belongs to
     * the owner, not to a listing's lifecycle. {@code clearAutomatically} is load-bearing.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Property p set p.ownerVerified = true where p.owner.id = :ownerId and p.ownerVerified = false")
    int markOwnerVerified(@Param("ownerId") UUID ownerId);

    /**
     * Withdraw the denormalised owner badge from every listing this owner holds - the exact mirror of
     * {@link #markOwnerVerified}, and diverging them would leave one direction subtly wrong.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Property p set p.ownerVerified = false where p.owner.id = :ownerId and p.ownerVerified = true")
    int markOwnerUnverified(@Param("ownerId") UUID ownerId);

    /**
     * Featured-first live listings for the homepage strip; the {@link Pageable} caps the result
     * because the contract endpoint takes no limit. Summary projection, so no owner graph.
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
     * The same over a society and everything merged into it: a merge moves nothing, so the survivor's
     * hub finds those listings only by asking for the whole family (docs/flows/consumer/societies.md).
     */
    List<Property> findBySocietyIdInAndStatusAndArchivedFalseOrderByCreatedAtDesc(
            Collection<UUID> societyIds, String status, Pageable limit);

    /**
     * Live-listing counts grouped by locality slug. Computed, never {@code localities.listing_count},
     * which counts every property while every surface showing it means the live ones.
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
     * Live-listing count for a single locality: the grouped queries above aggregate the whole
     * catalogue, which is work proportional to the catalogue rather than to the answer.
     */
    long countByLocalitySlugAndStatusAndArchivedFalse(String localitySlug, String status);

    /** Live-listing count for a single society. See {@link #countByLocalitySlugAndStatusAndArchivedFalse}. */
    long countBySocietyIdAndStatusAndArchivedFalse(UUID societyId, String status);

    /**
     * Listings the resolver could not place - the curation queue, and the exact complement of
     * {@link #countLiveByLocalitySlug}: a null slug is invisible to every locality-keyed read.
     */
    @Query("""
            select p from Property p
            where p.localitySlug is null and p.archived = false and p.status in :statuses
            order by p.createdAt asc""")
    List<Property> findAwaitingLocality(@Param("statuses") Collection<String> statuses,
            Pageable limit);

    /** How many listings {@link #findAwaitingLocality} would return uncapped, for honest truncation. */
    @Query("""
            select count(p) from Property p
            where p.localitySlug is null and p.archived = false and p.status in :statuses""")
    long countAwaitingLocality(@Param("statuses") Collection<String> statuses);

    /**
     * How many listings this owner currently has live. Counted, never {@code users.listings_count},
     * which tallies every row ever posted (docs/system/data-model.md).
     */
    long countByOwnerIdAndStatusAndArchivedFalse(UUID ownerId, String status);

    /**
     * How many of this owner's listings occupy a freemium slot - deliberately not
     * {@link #countByOwnerIdAndStatusAndArchivedFalse}; see {@link PropertyStatus#OCCUPIES_LISTING_SLOT}.
     */
    @Query("""
            select count(p) from Property p
            where p.owner.id = :ownerId and p.archived = false and p.status in :statuses""")
    long countOccupyingListingSlots(@Param("ownerId") UUID ownerId,
            @Param("statuses") Collection<String> statuses);

    /**
     * The three homepage trust numbers in one statement so they cannot straddle a moderation write;
     * the ownership clause spells out the lapse rule and {@code verifiedOwners} counts people.
     */
    @Query("""
            select new com.draazy.api.catalog.property.TrustTally(
                count(p),
                count(case when p.ownerVerified = true
                             or (p.ownershipVerified = true
                                 and (p.ownershipVerifiedUntil is null
                                      or p.ownershipVerifiedUntil > :now))
                           then 1 end),
                count(distinct case when p.ownerVerified = true then p.owner.id end))
            from Property p
            where p.status = :status
              and p.archived = false
              and (:all = true or p.localitySlug = :slug)""")
    TrustTally tallyTrust(
            @Param("status") String status,
            @Param("now") Instant now,
            @Param("all") boolean all,
            @Param("slug") String slug);

    /**
     * Count live listings matching a saved search's facets; the alert sweep and the saved-search list
     * share one query so the two readings cannot drift. {@code unbounded} drops the recency predicate.
     */
    @Query("""
            select count(p)
            from Property p
            where p.status = :status
              and p.archived = false
              and (:unbounded = true
                   or (p.createdAt is not null and p.createdAt > :baseline))
              and (:deal is null or lower(p.deal) = :deal)
              and (:localitiesEmpty = true
                   or lower(coalesce(p.localitySlug, p.locality)) in :localities)
              and (:bhkEmpty = true or cast(p.bhk as integer) in :bhkValues)
            """)
    long countVisibleWithFilters(
            @Param("status") String status,
            @Param("unbounded") boolean unbounded,
            @Param("baseline") Instant baseline,
            @Param("deal") String deal,
            @Param("localitiesEmpty") boolean localitiesEmpty,
            @Param("localities") List<String> localities,
            @Param("bhkEmpty") boolean bhkEmpty,
            @Param("bhkValues") List<Integer> bhkValues);
}
