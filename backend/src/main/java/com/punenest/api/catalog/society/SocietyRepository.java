package com.punenest.api.catalog.society;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Spring Data access for {@link Society}, plus the two follower aggregates the contract's
 * {@code followerCount} / {@code followedByMe} need.
 *
 * <p><strong>Why the follow queries are native and there is no {@code SocietyFollow} entity.</strong>
 * {@code society_follows} is a two-column join table with a composite primary key and no surrogate
 * id, so mapping it means an {@code @IdClass} or {@code @EmbeddedId} — real design work whose only
 * consumer today is two counts. The writes ({@code PUT|DELETE /me/societies/{slug}/follow}) belong to
 * the Engagement slice, and that slice should get to choose the mapping when it needs one. Reading a
 * count does not oblige this slice to decide it first.
 *
 * <p>Both queries are scoped to the ids on the current page and served by the table's primary key,
 * so neither grows with the size of the follow table.
 */
public interface SocietyRepository
        extends JpaRepository<Society, UUID>, JpaSpecificationExecutor<Society> {

    /** One society by its public URL key. */
    Optional<Society> findBySlug(String slug);

    /**
     * A society whose name matches, ignoring case and surrounding space.
     *
     * <p>The duplicate guard the mint needs, and deliberately not a slug lookup. The slug folds the
     * locality in, so "Kumar Pinnacle" typed without one produces a different slug from the RERA
     * row's "kumar-pinnacle-wakad" and the slug check alone would happily mint a second copy of a
     * society we already hold verified. That duplicate is unrecoverable without an operator finding
     * and merging it by hand.
     */
    @Query("select s from Society s where lower(trim(s.name)) = lower(trim(:name))")
    List<Society> findByNameIgnoringCase(@Param("name") String name);

    /**
     * Community societies nobody has checked yet, oldest first.
     *
     * <p>The ops "Candidates" queue. Curated and RERA rows are verified by construction and are
     * excluded by the {@code source} filter rather than by a backfilled timestamp -- see V105.
     */
    @Query("select s from Society s where s.source = 'community' and s.verifiedAt is null"
            + " order by s.createdAt asc")
    org.springframework.data.domain.Page<Society> candidates(org.springframework.data.domain.Pageable pageable);

    /**
     * Follower counts for the societies on this page.
     *
     * @return rows of {@code [societyId, count]}; societies with no followers are absent
     */
    @Query(value = """
            select society_id, count(*)
            from society_follows
            where society_id in (:societyIds)
            group by society_id""", nativeQuery = true)
    List<Object[]> countFollowersFor(@Param("societyIds") Collection<UUID> societyIds);

    /**
     * Which of these societies the given user follows.
     *
     * <p>Answers {@code followedByMe} for a whole page in one query. The obvious alternative — an
     * {@code exists} check per row — is an N+1 on a public endpoint.
     */
    @Query(value = """
            select society_id
            from society_follows
            where user_id = :userId and society_id in (:societyIds)""", nativeQuery = true)
    List<UUID> findFollowedAmong(@Param("userId") UUID userId,
            @Param("societyIds") Collection<UUID> societyIds);

    /**
     * Move a society between {@code unclaimed} / {@code pending} / {@code claimed}.
     *
     * <p>A write on a deliberately setter-less entity, and so deliberately a query rather than a
     * mapped field. {@link Society}'s own documentation says it is read-only because rows are
     * seeded and provenance is not ours to edit — that is still true of every other column, and
     * widening the entity to make one of them mutable would quietly withdraw the guarantee for all
     * of them. The claim decision in {@code engagement.society} is the only caller.
     *
     * <p>{@code updated_at} is set here too: the {@code trg_set_updated_at} trigger covers raw SQL,
     * but naming it makes the intent readable at the call site rather than depending on a migration
     * three years old.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "update societies set claim_status = :status, updated_at = now() where id = :societyId",
            nativeQuery = true)
    int updateClaimStatus(@Param("societyId") UUID societyId, @Param("status") String status);

    /**
     * Write an approved community detail suggestion onto the society.
     *
     * <p>Every parameter is coalesced, so a suggestion that offers a builder and nothing else
     * leaves the other five columns exactly as they were. A resident correcting one fact must not
     * blank the four somebody else corrected last month, and a null-overwriting update is the
     * commonest way that happens — silently, because the row still exists and still looks fine.
     *
     * <p>The amenities cast is explicit because the parameter arrives as a JSON string: Postgres
     * will not infer {@code jsonb} for an untyped bind, and an inferred {@code text} against a
     * {@code jsonb} column is an operator-does-not-exist error at runtime rather than at compile
     * time.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                builder = coalesce(cast(:builder as text), builder),
                year = coalesce(cast(:buildYear as integer), year),
                towers = coalesce(cast(:towers as integer), towers),
                units = coalesce(cast(:units as integer), units),
                maintenance_per_sqft = coalesce(cast(:maintenance as numeric), maintenance_per_sqft),
                amenities = coalesce(cast(:amenities as jsonb), amenities),
                updated_at = now()
            where id = :societyId""", nativeQuery = true)
    int applyDetailSuggestion(@Param("societyId") UUID societyId,
            @Param("builder") String builder,
            @Param("buildYear") Integer buildYear,
            @Param("towers") Integer towers,
            @Param("units") Integer units,
            @Param("maintenance") java.math.BigDecimal maintenance,
            @Param("amenities") String amenities);

    /**
     * Write an approved resident location correction onto the society.
     *
     * <p>{@code loc_source} is stamped in the same statement as the coordinates rather than left to
     * a later write. Coordinates whose provenance is a separate update can be observed without it,
     * and the hub renders that state as "imported from a RERA filing" beside a pin a neighbour
     * walked to — the exact confusion the column exists to prevent.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                lat = :lat,
                lng = :lng,
                place_id = coalesce(cast(:placeId as text), place_id),
                loc_source = 'community',
                updated_at = now()
            where id = :societyId""", nativeQuery = true)
    int applyLocationFix(@Param("societyId") UUID societyId,
            @Param("lat") Double lat,
            @Param("lng") Double lng,
            @Param("placeId") String placeId);

    /**
     * Mint a community society.
     *
     * <p>A write on a deliberately setter-less entity, for the reason {@link #updateClaimStatus}
     * gives: every other column really is read-only, and widening the entity to make four of them
     * mutable would withdraw that guarantee for all thirty.
     *
     * <p>{@code amenities} is seeded to an empty array rather than left null because the column is
     * {@code not null} and the entity maps it as a list -- a null there is a
     * {@code NullPointerException} on the first read of the row that was just created.
     *
     * <p>{@code on conflict (slug) do nothing} rather than a check-then-insert: two people adding
     * the same missing society within the same second is not a rare case, it is what happens the
     * day a new tower gets possession. The caller re-reads by slug afterwards and hands back
     * whichever row won, so the loser is told their society exists rather than shown an error about
     * a race they were not part of.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into societies
                (id, slug, name, locality_slug, lat, lng, registration, conveyance,
                 amenities, source, claim_status, created_by, created_at, updated_at)
            values
                (gen_random_uuid(), :slug, :name, cast(:localitySlug as text),
                 cast(:lat as double precision), cast(:lng as double precision),
                 false, false, '[]'::jsonb, 'community', 'unclaimed', :createdBy, now(), now())
            on conflict (slug) do nothing""", nativeQuery = true)
    int mintCommunity(@Param("slug") String slug,
            @Param("name") String name,
            @Param("localitySlug") String localitySlug,
            @Param("lat") Double lat,
            @Param("lng") Double lng,
            @Param("createdBy") UUID createdBy);

    /**
     * Stamp a community society as checked by ops.
     *
     * <p>Guarded on {@code verified_at is null} in the statement itself rather than by reading the
     * row first, so two operators clearing the same queue cannot both claim the verification. The
     * second gets zero rows back and a 409, which is the truth: somebody already did this.
     *
     * <p>{@code registration} and {@code conveyance} are untouched on purpose. They describe the
     * building's legal state, not our confidence in the record, and conflating the two is how a
     * community-minted row would start telling a buyer its conveyance deed is done because an
     * operator confirmed the society exists.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                verified_at = now(),
                verified_by = :operatorId,
                updated_at = now()
            where id = :societyId and verified_at is null""", nativeQuery = true)
    int markVerified(@Param("societyId") UUID societyId, @Param("operatorId") UUID operatorId);
}
