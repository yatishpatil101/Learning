package com.punenest.api.moderation.report;

import java.util.Collection;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The abuse queue.
 *
 * <p>Both finders order newest-first and are index-backed by V18 — {@code idx_reports_created} for
 * the unfiltered read and {@code idx_reports_status_created} for the filtered one. They are separate
 * methods rather than one method with a nullable parameter because a {@code status IS NULL OR
 * status = :s} predicate cannot use either index: the planner has to keep both branches.
 */
public interface ReportRepository extends JpaRepository<Report, UUID> {

    /** The whole queue, newest first. */
    Page<Report> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** One triage state, newest first. */
    Page<Report> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    /**
     * Backs the duplicate check. The V18 partial unique index is the real guard — this exists so the
     * common case gets a clean 409 instead of a constraint violation, and the two must agree on
     * which statuses count as live ({@link ReportStatuses#LIVE}).
     */
    boolean existsByReporterIdAndTargetTypeAndTargetIdAndStatusIn(
            UUID reporterId, String targetType, String targetId, Collection<String> statuses);
}
