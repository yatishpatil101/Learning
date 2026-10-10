package com.draazy.api.engagement.saved;

import com.draazy.api.catalog.property.Property;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** No entity: the composite key only supports one list, one insert and one hard delete. */
public interface SavedPropertyRepository extends Repository<Property, UUID> {

    @Query(value = """
            select sp.property_id
              from saved_properties sp
              join properties p on p.id = sp.property_id
             where sp.user_id = :userId
               and p.archived = false
               and p.status in ('approved', 'sold', 'rented')
             order by sp.created_at desc
            """,
            countQuery = """
            select count(*)
              from saved_properties sp
              join properties p on p.id = sp.property_id
             where sp.user_id = :userId
               and p.archived = false
               and p.status in ('approved', 'sold', 'rented')
            """,
            nativeQuery = true)
    Page<UUID> findSavedPropertyIds(@Param("userId") UUID userId, Pageable pageable);

    /** Same rows and order as {@link #findSavedPropertyIds}, as {@code [id, slug]} pairs and unpaged. */
    @Query(value = """
            select p.id, p.slug
              from saved_properties sp
              join properties p on p.id = sp.property_id
             where sp.user_id = :userId
               and p.archived = false
               and p.status in ('approved', 'sold', 'rented')
             order by sp.created_at desc
            """, nativeQuery = true)
    List<Object[]> findSavedKeys(@Param("userId") UUID userId);

    /** {@code ON CONFLICT DO NOTHING} makes save idempotent: 1 if inserted, 0 if already present,
     * never a duplicate-key exception. */
    @Modifying
    @Query(value = "insert into saved_properties (user_id, property_id) values (:userId, :propertyId) on conflict do nothing",
            nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("propertyId") UUID propertyId);

    @Modifying
    @Query(value = "delete from saved_properties where user_id = :userId and property_id = :propertyId",
            nativeQuery = true)
    int deleteByUserAndProperty(@Param("userId") UUID userId, @Param("propertyId") UUID propertyId);
}
