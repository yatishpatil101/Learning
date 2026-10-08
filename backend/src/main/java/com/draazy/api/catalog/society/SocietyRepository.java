package com.draazy.api.catalog.society;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Native: {@code society_follows} has a composite key, and mapping it is the Engagement slice's call. */
public interface SocietyRepository
        extends JpaRepository<Society, UUID>, JpaSpecificationExecutor<Society> {

    /** One society by its public URL key. */
    Optional<Society> findBySlug(String slug);

    /** The society, its merge survivor and everything merged into that survivor. */
    @Query("""
            select s.id from Society s
            where s.id = :id or s.mergedInto = :id
               or s.id = (select m.mergedInto from Society m where m.id = :id)
               or s.mergedInto = (select m.mergedInto from Society m where m.id = :id)""")
    List<UUID> familyIds(@Param("id") UUID id);

    /** A society still in the public catalogue; archived rows answer empty. */
    Optional<Society> findBySlugAndArchivedAtIsNull(String slug);

    /** The society a Google Place ID names; at most one row, by the unique index. */
    Optional<Society> findByPlaceId(String placeId);

    /** Live societies whose pin falls in a lat/lng box, for the caller to narrow to an exact radius. */
    @Query("""
            select s from Society s
            where s.archivedAt is null and s.mergedInto is null
              and s.lat between :minLat and :maxLat and s.lng between :minLng and :maxLng""")
    List<Society> withinBox(@Param("minLat") double minLat, @Param("maxLat") double maxLat,
            @Param("minLng") double minLng, @Param("maxLng") double maxLng);

    /** Ranked in the database; homes and rating total over the whole merge family, and ties fall to name then slug so offset paging stays stable. */
    @Query(value = """
            with base as (
                select s.id from societies s
                where s.merged_into is null and s.archived_at is null
                  and (cast(:locality as text) is null or s.locality_slug = cast(:locality as text))
                  and (cast(:like as text) is null or lower(s.name || ' ' || coalesce(s.builder, '')
                       || ' ' || replace(coalesce(s.locality_slug, ''), '-', ' ')) like cast(:like as text))
            ), fam as (
                select b.id as sid, b.id as fid from base b
                union all
                select b.id, f.id from base b join societies f on f.merged_into = b.id
            ), homes as (
                select fam.sid, count(*) as n
                from fam join properties p on p.society_id = fam.fid
                where p.status = 'approved' and p.archived = false
                group by fam.sid
            ), rated as (
                select fam.sid, sum(r.avg_rating * r.cnt) as weighted, sum(r.cnt) as cnt
                from fam join (
                    select target_id, round(avg(rating), 1) as avg_rating, count(*) as cnt
                    from reviews
                    where target_type = 'society' and status = 'published'
                      and target_id in (select cast(fid as text) from fam)
                    group by target_id
                ) r on r.target_id = cast(fam.fid as text)
                group by fam.sid
            )
            select s.id, count(*) over () as total
            from base b
            join societies s on s.id = b.id
            left join homes h on h.sid = b.id
            left join rated r on r.sid = b.id
            where (not :hasListings or coalesce(h.n, 0) > 0)
            order by
                case cast(:mode as text)
                    when 'homes' then cast(coalesce(h.n, 0) as numeric)
                    when 'rating' then coalesce(round(r.weighted / r.cnt, 2), 0)
                    else least(coalesce(h.n, 0), 3) + coalesce(round(r.weighted / r.cnt, 2), 0) / 5
                end desc,
                case when cast(:mode as text) = 'rating' then coalesce(r.cnt, 0) else 0 end desc,
                lower(s.name), s.slug
            limit :limit offset :offset""", nativeQuery = true)
    List<Object[]> rankedIds(@Param("like") String like, @Param("locality") String locality,
            @Param("hasListings") boolean hasListings, @Param("mode") String mode,
            @Param("limit") int limit, @Param("offset") long offset);

    /** Merged-away rows are excluded, so a duplicate an operator has dealt with does not come back. */
    @Query("select s from Society s where s.source = 'community' and s.mergedInto is null"
            + " and s.archivedAt is null order by s.createdAt desc")
    org.springframework.data.domain.Page<Society> candidates(org.springframework.data.domain.Pageable pageable);

    /** Unpaged projection, as a duplicate on page 2 would never be found; merged-away rows are excluded, or the scan would propose chains. */
    @Query("""
            select s.slug, s.name, s.localitySlug, s.lat, s.lng
            from Society s
            where s.mergedInto is null and s.archivedAt is null and s.id <> :excludeId""")
    List<Object[]> duplicateScan(@Param("excludeId") UUID excludeId);

    /** Rows of {@code [societyId, count]}; societies with no followers are absent. */
    @Query(value = """
            select society_id, count(*)
            from society_follows
            where society_id in (:societyIds)
            group by society_id""", nativeQuery = true)
    List<Object[]> countFollowersFor(@Param("societyIds") Collection<UUID> societyIds);

    /** Which of these societies the user follows: {@code followedByMe} for a page in one query, not an N+1 {@code exists} per row on a public endpoint. */
    @Query(value = """
            select society_id
            from society_follows
            where user_id = :userId and society_id in (:societyIds)""", nativeQuery = true)
    List<UUID> findFollowedAmong(@Param("userId") UUID userId,
            @Param("societyIds") Collection<UUID> societyIds);

    /** Coalesced for PATCH, with explicit casts as Postgres infers nothing for an untyped bind; {@code admin_note} is the
     * exception, as {@code coalesce} could not clear it, so the caller says whether it was in the request. */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                registration = coalesce(cast(:registration as boolean), registration),
                conveyance = coalesce(cast(:conveyance as boolean), conveyance),
                maintenance_per_sqft = coalesce(cast(:maintenance as numeric), maintenance_per_sqft),
                admin_note = case when cast(:noteGiven as boolean)
                                  then cast(:adminNote as text) else admin_note end,
                updated_at = now()
            where id = :societyId""", nativeQuery = true)
    int applyAdminEdit(@Param("societyId") UUID societyId,
            @Param("registration") Boolean registration,
            @Param("conveyance") Boolean conveyance,
            @Param("maintenance") java.math.BigDecimal maintenance,
            @Param("noteGiven") boolean noteGiven,
            @Param("adminNote") String adminNote);

    /** {@code on conflict do nothing} with no target covers both the slug and the unique {@code place_id}, so a same-second race loses
     * cleanly; {@code mint_origin} is in the insert so the loser's surface cannot overwrite the winner's. Returns 1 if created. */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into societies
                (id, slug, name, place_id, locality_slug, lat, lng, registration, conveyance,
                 amenities, source, mint_origin, created_by, created_at, updated_at)
            values
                (gen_random_uuid(), :slug, :name, :placeId, cast(:localitySlug as text),
                 cast(:lat as double precision), cast(:lng as double precision),
                 false, false, '[]'::jsonb, 'community', cast(:mintOrigin as text),
                 :createdBy, now(), now())
            on conflict do nothing""", nativeQuery = true)
    int mintCommunity(@Param("slug") String slug,
            @Param("name") String name,
            @Param("placeId") String placeId,
            @Param("localitySlug") String localitySlug,
            @Param("lat") Double lat,
            @Param("lng") Double lng,
            @Param("mintOrigin") String mintOrigin,
            @Param("createdBy") UUID createdBy);

    /** Guarded on {@code merged_into is null} in the statement, so the loser of a two-operator race is told and cannot silently
     * reverse the first judgement; all three merge columns move together because of {@code ck_society_merged_trio}. */
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

    /** One statement, as a merge moves nothing, so a wrong-pair merge costs a click, not a recovery; the three columns clear together and
     * {@code merged_into is not null} guards so a racing undo returns 0. Returns 1 when a merge was undone. */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update societies set
                merged_into = null,
                merged_at = null,
                merged_by = null,
                updated_at = now()
            where id = :societyId and merged_into is not null""", nativeQuery = true)
    int undoMerge(@Param("societyId") UUID societyId);

    /** Page-scoped, as {@code GET /societies} is unauthenticated and a per-row query would be a free denial of service; rows are
     * {@code [survivorId, mergedAwaySocietyId]}, and the partial {@code idx_society_merged_into} keeps it a lookup into tens of rows. */
    @Query(value = """
            select merged_into, id
            from societies
            where merged_into in (:survivorIds)""", nativeQuery = true)
    List<Object[]> findMergedInto(@Param("survivorIds") Collection<UUID> survivorIds);

    /** Most recent first, sorted in the database like {@link #candidates} so the order belongs to the queue; the only place a merge can be found to undo. */
    @Query("select s from Society s where s.mergedInto is not null order by s.mergedAt desc")
    org.springframework.data.domain.Page<Society> merged(org.springframework.data.domain.Pageable pageable);

    /** The societies merged into this one, newest first, so the refusal can name them; unbounded because a {@code LIMIT} would turn "and 47 more" into a smaller number. */
    List<Society> findByMergedIntoOrderByMergedAtDesc(UUID survivorId);

    @Query("select count(s) from Society s where s.source = 'community' and s.mergedInto is null"
            + " and s.archivedAt is null")
    long countCandidates();
}
