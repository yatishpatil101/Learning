package com.draazy.api.moderation.report;

import java.util.Collection;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * The abuse queue.
 *
 * <p>Both simple finders order newest-first and are index-backed by V18 —
 * {@code idx_reports_created} for the unfiltered read and {@code idx_reports_status_created} for the
 * filtered one. They are separate methods rather than one method with a nullable parameter because a
 * {@code status IS NULL OR status = :s} predicate cannot use either index: the planner has to keep
 * both branches.
 *
 * <p>{@link #search} is the deliberate exception, and the reason it is an exception rather than a
 * replacement. Reason and target type have no index, so a query that filters on them is a scan
 * whichever way it is written — there is nothing for the nullable-parameter form to lose. Keeping
 * the two indexed shapes as their own methods means the paths a moderator actually walks all day
 * (the whole queue, and "what is still open") stay index-only, and only the narrowing filters pay.
 */
public interface ReportRepository extends JpaRepository<Report, UUID> {

    /** The whole queue, newest first. */
    Page<Report> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** One triage state, newest first. */
    Page<Report> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    /**
     * The queue narrowed by any combination of status, reason and target type, newest first.
     *
     * <p>Only called when at least one of reason or target type is present — see the class Javadoc.
     * A blank filter must arrive here as {@code null}, not as {@code ""}: an empty string is a value
     * the column can legally hold, so it would match nothing rather than everything.
     */
    @Query("""
            select r from Report r
            where (:status is null or r.status = :status)
              and (:reason is null or r.reason = :reason)
              and (:targetType is null or r.targetType = :targetType)
            order by r.createdAt desc
            """)
    Page<Report> search(@Param("status") String status,
            @Param("reason") String reason,
            @Param("targetType") String targetType,
            Pageable pageable);

    /**
     * How many complaints are still awaiting a decision — the backlog figure the ops scorecard shows
     * beside the listing queue (tech debt D68). Counts {@link ReportStatuses#LIVE}, so a report a
     * moderator has claimed but not decided still counts as outstanding work: it is, and a tile that
     * dropped it the moment somebody opened it would report the backlog as smaller than it is.
     */
    long countByStatusIn(Collection<String> statuses);

    /**
     * Backs the duplicate check. The V18 partial unique index is the real guard — this exists so the
     * common case gets a clean 409 instead of a constraint violation, and the two must agree on
     * which statuses count as live ({@link ReportStatuses#LIVE}).
     */
    boolean existsByReporterIdAndTargetTypeAndTargetIdAndStatusIn(
            UUID reporterId, String targetType, String targetId, Collection<String> statuses);
}
