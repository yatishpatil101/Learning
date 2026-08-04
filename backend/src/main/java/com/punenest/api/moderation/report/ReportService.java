package com.punenest.api.moderation.report;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The trust &amp; safety queue: filing a complaint, reading the queue, and triaging.
 *
 * <p>The asymmetry between the three is the design. <strong>Anyone signed in may file</strong> — an
 * abuse queue that only privileged users can write to reports nothing — while <strong>only ops may
 * read or act</strong>, because the queue contains unproven allegations about named people.
 *
 * <p>Triage is audited and filing is not. That is deliberate: {@code audit_log} exists to hold
 * <em>privileged</em> action to account, and writing an entry for every report a member of the
 * public files would bury the moderator decisions in reporter noise — while also copying the
 * reporter's identity into a second table that ops can read, which is exactly what
 * {@link ReportResponse} takes care not to do.
 */
@Service
public class ReportService {

    private final ReportRepository reports;
    private final ReportMapper mapper;
    private final AuditService audit;

    public ReportService(ReportRepository reports, ReportMapper mapper, AuditService audit) {
        this.reports = reports;
        this.mapper = mapper;
        this.audit = audit;
    }

    /**
     * File a report. Any authenticated caller.
     *
     * <p>The target is <em>not</em> resolved against its table. A complaint about a listing that is
     * withdrawn a second later is still worth reading, and refusing to record one because the thing
     * complained about cannot currently be found would discard precisely the reports that matter —
     * a scammer deleting the evidence must not also delete the complaint.
     *
     * @throws BadRequestException if the target type is unknown, or the reason is not one of the
     *                             complaints that can be made about that kind of target
     * @throws ConflictException   if the caller already has a live report on the same target
     */
    @Transactional
    public ReportResponse create(UUID reporterId, ReportCreateRequest body) {
        String targetType = body.targetType();
        if (!ReportTargetTypes.isValid(targetType)) {
            throw new BadRequestException("Unknown report target type: " + targetType);
        }
        if (!ReportReasons.isValid(targetType, body.reason())) {
            throw new BadRequestException("Reason '%s' is not a valid complaint about a %s. Expected one of %s"
                    .formatted(body.reason(), targetType, ReportReasons.forTarget(targetType)));
        }
        if (reports.existsByReporterIdAndTargetTypeAndTargetIdAndStatusIn(
                reporterId, targetType, body.targetId(), ReportStatuses.LIVE)) {
            throw new ConflictException("You have already reported this, and it is still being reviewed");
        }
        Report report = new Report(targetType, body.targetId(), reporterId, body.reason(), body.details());
        try {
            return mapper.toResponse(reports.saveAndFlush(report));
        } catch (DataIntegrityViolationException duplicate) {
            // The V18 partial unique index, not the check above: two concurrent submissions both
            // passed it before either committed. Same answer, arrived at by the only participant
            // that can serialise them.
            throw new ConflictException("You have already reported this, and it is still being reviewed");
        }
    }

    /**
     * Read the queue, newest first. Staff/admin.
     *
     * @param status optional triage state to filter to; blank or {@code null} returns everything
     */
    @Transactional(readOnly = true)
    public Page<ReportResponse> list(String status, Pageable pageable) {
        if (status == null || status.isBlank()) {
            return reports.findAllByOrderByCreatedAtDesc(pageable).map(mapper::toResponse);
        }
        if (!ReportStatuses.isValid(status)) {
            throw new BadRequestException("Unknown report status: " + status);
        }
        return reports.findByStatusOrderByCreatedAtDesc(status, pageable).map(mapper::toResponse);
    }

    /**
     * Move a report through triage (spec fix S30). Staff/admin.
     *
     * <p>Writes an audit entry naming the moderator, the report, both ends of the transition and
     * any internal note. This is the point of the endpoint: a queue whose decisions are anonymous
     * is a queue nobody can be held to.
     *
     * @throws NotFoundException   if no such report — including when {@code id} is not a UUID, since
     *                             a malformed id and a stranger's id should be indistinguishable
     * @throws ConflictException   if the transition is illegal (a decided report is never reopened)
     * @throws BadRequestException if the target status is not one of the four
     */
    @Transactional
    public ReportResponse triage(AuthPrincipal actor, String id, ReportTriageRequest body) {
        if (!ReportStatuses.isValid(body.status())) {
            throw new BadRequestException("Unknown report status: " + body.status());
        }
        Report report = reports.findById(parseId(id))
                .orElseThrow(() -> NotFoundException.of("Report"));
        String from = report.getStatus();
        if (!ReportStatuses.canTransition(from, body.status())) {
            throw new ConflictException(
                    "Cannot move a report from %s to %s. A decided report is not reopened — file a new one."
                            .formatted(from, body.status()));
        }
        report.triage(body.status());
        audit.record(actor, "report.triage", "report", id, "from", from, "to", body.status(), "note", body.note());
        return mapper.toResponse(report);
    }

    /** A malformed id is a 404 for the same reason somebody else's is: it does not exist for you. */
    private static UUID parseId(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Report"));
    }
}
