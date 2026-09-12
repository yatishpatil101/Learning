package com.draazy.api.engagement.society;

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
     * The same queue with the society taken off, for the ops console that spans all of them.
     *
     * <p><strong>One query, joined and paged in the database.</strong> The alternative the console
     * has been living with is a request per society to find the handful with anything pending — a
     * read whose cost grows with the catalogue rather than with the backlog, and which cannot page
     * or order the result it assembles. The society and the applicant are joined rather than looked
     * up per row for the same reason: twenty rows must not be twenty-one reads.
     *
     * <p>Projected straight into {@link SocietyResidentQueueRow} because nothing on this path needs
     * a managed entity — the caller publishes the row and forgets it, and loading three entity
     * graphs to copy fifteen columns out of them is work with no reader.
     *
     * <p>Oldest first, which is the opposite of every consumer feed here and is right for a work
     * queue: the person who has waited longest is the one still waiting.
     */
    @Query(value = """
            select new com.draazy.api.engagement.society.SocietyResidentQueueRow(
                r.id, s.slug, s.name, u.name, u.mobile, r.wing, r.flat, r.unitKey,
                r.relation, r.status, r.assignedTo, r.flagged, r.note, r.createdAt, r.decidedAt)
            from SocietyResident r
            join Society s on s.id = r.societyId
            join User u on u.id = r.userId
            where (:status is null or r.status = :status)
            order by r.createdAt asc
            """,
            countQuery = """
            select count(r) from SocietyResident r
            join Society s on s.id = r.societyId
            join User u on u.id = r.userId
            where (:status is null or r.status = :status)
            """)
    Page<SocietyResidentQueueRow> opsQueue(@Param("status") String status, Pageable pageable);

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
