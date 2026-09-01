package com.punenest.api.engagement.society;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Residency requests, by society (the review queue) and by person (the permission check). */
public interface SocietyResidentRepository extends JpaRepository<SocietyResident, UUID> {

    Optional<SocietyResident> findBySocietyIdAndUserId(UUID societyId, UUID userId);

    /**
     * The review queue for one society, newest first, optionally narrowed to one status.
     *
     * <p>{@code status} is nullable rather than overloaded into two methods: the console's default
     * view is "everything", and a second finder would be the same query with one predicate removed.
     */
    @Query("""
            select r from SocietyResident r
            where r.societyId = :societyId
              and (:status is null or r.status = :status)
            order by r.createdAt desc
            """)
    Page<SocietyResident> queueFor(@Param("societyId") UUID societyId,
            @Param("status") String status, Pageable pageable);

    /**
     * The verified holder of one unit, if there is one.
     *
     * <p>Returns a list because {@code ux_society_residents_unit_verified} guarantees at most one
     * row and a repository that says {@code Optional} would be asserting the constraint a second
     * time in a place that cannot enforce it. The caller takes the first.
     */
    @Query("""
            select r from SocietyResident r
            where r.societyId = :societyId
              and r.unitKey = :unitKey
              and r.status = 'verified'
            """)
    List<SocietyResident> verifiedHoldersOf(@Param("societyId") UUID societyId,
            @Param("unitKey") String unitKey);

    /** How many people are verified residents here — the hub's "N residents verified" line. */
    long countBySocietyIdAndStatus(UUID societyId, String status);

    /**
     * Which of these people are verified residents of this society.
     *
     * <p>One query for a whole page of authors. The community surfaces badge every name they draw,
     * and asking per author is the read that would turn a twenty-post board into twenty-one
     * queries. Returns a {@code Set} of user ids rather than rows because the caller only ever asks
     * {@code contains}.
     */
    @Query("""
            select r.userId from SocietyResident r
            where r.societyId = :societyId
              and r.userId in :userIds
              and r.status = 'verified'
            """)
    java.util.Set<UUID> verifiedAmong(@Param("societyId") UUID societyId,
            @Param("userIds") List<UUID> userIds);

    /**
     * Hand the society's still-undecided residency requests to a different queue.
     *
     * <p>Run when a claim is approved. Scoped to {@code pending} because a decided row records who
     * decided it, and re-homing that would rewrite history to say the committee did work ops did.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update SocietyResident r
            set r.assignedTo = :queue
            where r.societyId = :societyId and r.status = 'pending'
            """)
    int reassignPendingQueue(@Param("societyId") UUID societyId, @Param("queue") String queue);
}
