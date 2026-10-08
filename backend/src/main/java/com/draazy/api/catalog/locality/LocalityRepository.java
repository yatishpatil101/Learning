package com.draazy.api.catalog.locality;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Consumer finders return live localities only; archived rows must not receive new listings. */
public interface LocalityRepository extends JpaRepository<Locality, String> {

    Optional<Locality> findByPlaceId(String placeId);

    List<Locality> findByNameIgnoreCaseAndArchivedAtIsNull(String name);

    Optional<Locality> findBySlugAndArchivedAtIsNull(String slug);

    @Query("""
            select l from Locality l
            where l.archivedAt is null and lower(l.name) like concat('%', lower(:q), '%')
            order by case when lower(l.name) like concat(lower(:q), '%') then 0 else 1 end, l.name
            """)
    List<Locality> searchLive(@Param("q") String q, Pageable page);

    /** Inserts a live row; 0 means the slug or the place is already taken, and nothing was written. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            insert into localities (slug, name, city, lat, lng, place_id, active)
            values (:slug, :name, :city, :lat, :lng, :placeId, true)
            on conflict do nothing""", nativeQuery = true)
    int mint(@Param("slug") String slug, @Param("name") String name, @Param("city") String city,
            @Param("placeId") String placeId, @Param("lat") double lat, @Param("lng") double lng);

    /** Gives a row with no place the one just picked; 0 means somebody else got there first. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            update localities
            set place_id = :placeId, name = :name, lat = :lat, lng = :lng, active = true, archived_at = null
            where slug = :slug and place_id is null""", nativeQuery = true)
    int adopt(@Param("slug") String slug, @Param("placeId") String placeId, @Param("name") String name,
            @Param("lat") double lat, @Param("lng") double lng);

    /** The directory: live rows, plus non-live ones that still have approved listings bound to them. */
    @Query("""
            select l from Locality l
            where l.archivedAt is null
               or exists (select 1 from Property p
                          where p.localitySlug = l.slug and p.status = :status and p.archived = false)
            order by l.name
            """)
    List<Locality> findDirectory(@Param("status") String status);
}
