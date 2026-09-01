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
     *
     * <p>Merged-away rows are excluded too (V111). A duplicate an operator has already dealt with
     * must not come back asking to be dealt with again -- that is the loop the browser-local merge
     * left every operator in, and putting a resolved duplicate back in the queue is how the second
     * operator merges the same pair in the opposite direction.
     */
    @Query("select s from Society s where s.source = 'community' and s.verifiedAt is null"
            + " and s.mergedInto is null order by s.createdAt asc")
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
     * Write an operator's back-office edit onto the society.
     *
     * <p>Coalesced for the reason {@link #applyDetailSuggestion} is: this is a {@code PATCH}, and an
     * operator who came to fix the conveyance box must not blank the maintenance figure somebody
     * else researched. The casts are explicit for the same reason too — Postgres infers nothing for
     * an untyped bind, and an inferred {@code text} against {@code boolean} or {@code numeric} fails
     * at runtime rather than at compile time.
     *
     * <p><strong>{@code admin_note} is the one column coalesce cannot serve</strong>, because
     * clearing the note is a thing an operator does and {@code coalesce(null, admin_note)} would
     * make it the one edit the form silently refuses. So the caller says whether the note was in the
     * request at all, and the value itself is then free to be null and mean "erase it".
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                registration = coalesce(cast(:registration as boolean), registration),
                conveyance = coalesce(cast(:conveyance as boolean), conveyance),
                maintenance_per_sqft = coalesce(cast(:maintenance as numeric), maintenance_per_sqft),
                claim_status = coalesce(cast(:claimStatus as text), claim_status),
                admin_note = case when cast(:noteGiven as boolean)
                                  then cast(:adminNote as text) else admin_note end,
                updated_at = now()
            where id = :societyId""", nativeQuery = true)
    int applyAdminEdit(@Param("societyId") UUID societyId,
            @Param("registration") Boolean registration,
            @Param("conveyance") Boolean conveyance,
            @Param("maintenance") java.math.BigDecimal maintenance,
            @Param("claimStatus") String claimStatus,
            @Param("noteGiven") boolean noteGiven,
            @Param("adminNote") String adminNote);

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
     *
     * <p>{@code mint_origin} is written in the insert rather than patched afterwards. A follow-up
     * update would be skipped by exactly the caller that loses the {@code on conflict} race — and
     * the queue would then show the winner's surface as though it were the only one, which is the
     * distinction this column exists to keep.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into societies
                (id, slug, name, locality_slug, lat, lng, registration, conveyance,
                 amenities, source, mint_origin, claim_status, created_by, created_at, updated_at)
            values
                (gen_random_uuid(), :slug, :name, cast(:localitySlug as text),
                 cast(:lat as double precision), cast(:lng as double precision),
                 false, false, '[]'::jsonb, 'community', cast(:mintOrigin as text),
                 'unclaimed', :createdBy, now(), now())
            on conflict (slug) do nothing""", nativeQuery = true)
    int mintCommunity(@Param("slug") String slug,
            @Param("name") String name,
            @Param("localitySlug") String localitySlug,
            @Param("lat") Double lat,
            @Param("lng") Double lng,
            @Param("mintOrigin") String mintOrigin,
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

    /**
     * Point a duplicate society at the one that survives it.
     *
     * <p>Guarded on {@code merged_into is null} in the statement rather than by reading the row
     * first, exactly as {@link #markVerified} is. Two operators working the same duplicate pair is
     * the case this whole feature exists for, and the loser of that race must be told somebody
     * already decided -- and, crucially, which way. Silently overwriting the pointer would let the
     * second operator reverse the first one's judgement without either of them ever knowing.
     *
     * <p>All three merge columns move in one statement because {@code ck_society_merged_trio}
     * requires it, and the constraint requires it because a merge with no operator and no timestamp
     * is a decision nobody signed.
     *
     * <p>Nothing is moved off the losing society. Its listings, follows, reviews and residency
     * records stay on it and are unioned in on read -- see {@link Society#getMergedInto()} for why
     * rewriting them would make this irreversible.
     *
     * @return 1 when the merge was recorded, 0 when the society was already merged into something
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                merged_into = :survivorId,
                merged_at = now(),
                merged_by = :operatorId,
                updated_at = now()
            where id = :societyId and merged_into is null""", nativeQuery = true)
    int recordMerge(@Param("societyId") UUID societyId,
            @Param("survivorId") UUID survivorId,
            @Param("operatorId") UUID operatorId);

    /**
     * Undo a merge, restoring a society to standing on its own.
     *
     * <p>One statement, and it can be one statement only because nothing was moved when the merge
     * was recorded. That is the entire argument for the pointer: an operator merging the wrong pair
     * is a realistic mistake -- they are looking at two rows that differ by a typo -- and this is
     * the difference between a mistake that costs a click and one that costs a data recovery.
     *
     * <p>The three columns are cleared together for the same reason they are set together. Guarded
     * on {@code merged_into is not null} so an undo racing another undo reports honestly rather than
     * claiming to have reversed something that was already reversed.
     *
     * @return 1 when a merge was undone, 0 when the society was not merged into anything
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                merged_into = null,
                merged_at = null,
                merged_by = null,
                updated_at = now()
            where id = :societyId and merged_into is not null""", nativeQuery = true)
    int undoMerge(@Param("societyId") UUID societyId);

    /**
     * The societies merged into any of these, for the page being rendered.
     *
     * <p>The read side of the pointer, and page-scoped for the reason every aggregate in
     * {@link SocietyService} is: {@code GET /societies} is unauthenticated, so a question asked once
     * per row is a denial-of-service a client can trigger for free. One query answers it for the
     * whole page, and {@code idx_society_merged_into} is partial, so it is a lookup into tens of
     * rows however large the catalogue grows.
     *
     * @return rows of {@code [survivorId, mergedAwaySocietyId]}; survivors that absorbed nothing are
     *     absent, which is almost all of them
     */
    @Query(value = """
            select merged_into, id
            from societies
            where merged_into in (:survivorIds)""", nativeQuery = true)
    List<Object[]> findMergedInto(@Param("survivorIds") Collection<UUID> survivorIds);

    /**
     * Every merge currently in force, most recent first -- the ops merge list.
     *
     * <p>The screen an operator needs before they can undo anything. Without it a merge is
     * technically reversible and practically not: you cannot undo a decision you cannot find, and
     * the merged-away society is by design absent from the directory and unreachable by its own
     * slug.
     *
     * <p>Sorted in the database rather than by {@link org.springframework.data.domain.Pageable} so
     * the order is a property of the queue and not of whatever the caller happened to send -- the
     * same choice {@link #candidates} makes.
     */
    @Query("select s from Society s where s.mergedInto is not null order by s.mergedAt desc")
    org.springframework.data.domain.Page<Society> merged(org.springframework.data.domain.Pageable pageable);

    /**
     * The societies that have been merged into this one, most recently merged first.
     *
     * <p>Asked before merging a society away. This was a {@code count} until a live run showed what
     * that cost the operator: the refusal could say "already has 1 society(s) merged into it" and
     * nothing more, so the person told to undo a merge first had no way to know <em>which</em> one
     * without going to the merge list and reading it. That is an investigation standing in for a
     * sentence, and it made this branch strictly less useful than the forward-chain branch beside
     * it, which has always named the real survivor and its slug so the operator can correct the
     * request in one go. Returning the rows makes the two symmetrical.
     *
     * <p>Unbounded on purpose. The caller names only the first few and counts the rest, but the
     * bound belongs to the sentence rather than to the query: a survivor with fifty duplicates
     * behind it is a fact an operator should be able to discover, and a {@code LIMIT} here would
     * quietly turn "and 47 more" into a smaller number that reads as the truth.
     */
    List<Society> findByMergedIntoOrderByMergedAtDesc(UUID survivorId);
}
