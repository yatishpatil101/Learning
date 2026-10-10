package com.draazy.api.moderation.report;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Unfiltered and status-filtered finders stay separate because a nullable {@code status IS NULL OR ...} predicate
 * cannot use the V18 indexes; {@link #search} hits unindexed columns, so it is a scan regardless. */
public interface ReportRepository extends JpaRepository<Report, UUID> {

    /** The whole queue, newest first. */
    Page<Report> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** One triage state, newest first. */
    Page<Report> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    /** A blank filter must arrive as {@code null}: {@code ""} is a legal column value and would match nothing. */
    @Query("""
            select r from Report r
            where (:status is null or r.status = :status)
              and (:reason is null or r.reason = :reason)
              and (:targetType is null or r.targetType = :targetType)
              and r.createdAt >= :since
              and (:like is null or lower(r.targetId) like :like or lower(r.reason) like :like
                   or lower(coalesce(r.details, '')) like :like or lower(cast(r.id as string)) like :like)
            order by r.createdAt desc
            """)
    Page<Report> search(@Param("status") String status,
            @Param("reason") String reason,
            @Param("targetType") String targetType,
            @Param("like") String like,
            @Param("since") Instant since,
            Pageable pageable);

    /** Undecided reports per target type, for the tab badges. */
    @Query("select r.targetType, count(r) from Report r where r.status in :statuses group by r.targetType")
    List<Object[]> countByTargetType(@Param("statuses") Collection<String> statuses);

    /** Reports per status within one target type (or all), for the status chips. */
    @Query("select r.status, count(r) from Report r where (:targetType is null or r.targetType = :targetType) group by r.status")
    List<Object[]> countByStatus(@Param("targetType") String targetType);

    /** Every report ever filed against each of these targets, whatever its status - the repeat-offender tally. */
    @Query("select r.targetId, count(r) from Report r where r.targetId in :targetIds group by r.targetId")
    List<Object[]> countByTarget(@Param("targetIds") Collection<String> targetIds);

    /** Counts {@link ReportStatuses#LIVE} so a claimed-but-undecided report still counts as backlog. */
    long countByStatusIn(Collection<String> statuses);

    /** The V18 partial unique index is the real guard; this gives the common case a clean 409 and must
     * agree with it on which statuses are live ({@link ReportStatuses#LIVE}). */
    boolean existsByReporterIdAndTargetTypeAndTargetIdAndStatusIn(
            UUID reporterId, String targetType, String targetId, Collection<String> statuses);
}
