package com.punenest.api.engagement.flatmate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code flatmate_groups} (V27). */
public interface FlatmateGroupRepository extends JpaRepository<FlatmateGroup, UUID> {

    /**
     * Live groups, newest first, optionally one locality.
     *
     * <p>{@code left join fetch} on members: every card renders them, and without it a page of
     * twenty groups is twenty-one queries. Left, not inner, because a group with no members yet is
     * still a group — an inner join would silently hide every brand-new one.
     */
    @Query(value = """
            select distinct g from FlatmateGroup g
            left join fetch g.members
            where g.archived = false
              and g.modStatus not in ('flagged','removed','rejected')
              and (:locality is null or lower(g.locality) = lower(:locality))
            order by g.createdAt desc, g.id desc
            """,
            countQuery = """
                    select count(g) from FlatmateGroup g
                    where g.archived = false
                      and g.modStatus not in ('flagged','removed','rejected')
                      and (:locality is null or lower(g.locality) = lower(:locality))
                    """)
    Page<FlatmateGroup> feed(@Param("locality") String locality, Pageable pageable);

    @Query("""
            select g from FlatmateGroup g
            left join fetch g.members
            where g.id = :id and g.archived = false
              and g.modStatus not in ('flagged','removed','rejected')
            """)
    Optional<FlatmateGroup> findVisible(@Param("id") UUID id);

    /** Live non-owner-tier groups this host holds — the other half of the anti-broker cap. */
    @Query("""
            select count(g) from FlatmateGroup g
            where g.hostId = :hostId and g.archived = false
              and g.verificationTier <> 'owner'
            """)
    long countCappedByHost(@Param("hostId") UUID hostId);

    List<FlatmateGroup> findByAddressFingerprintAndArchivedFalse(String fingerprint);
}
