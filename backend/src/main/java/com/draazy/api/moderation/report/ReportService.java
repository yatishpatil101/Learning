package com.draazy.api.moderation.report;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.engagement.flatmate.FlatmateModerationService;
import com.draazy.api.moderation.property.PropertyModerationService;
import com.draazy.api.moderation.user.UserAdminService;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Any signed-in user may file; only ops read or act. Filing is unaudited to keep reporters out of audit_log. */
@Service
public class ReportService {

    private final ReportRepository reports;
    private final ReportMapper mapper;
    private final AuditService audit;
    private final PropertyModerationService propertyModeration;
    private final UserAdminService userAdmin;
    private final FlatmateModerationService flatmateModeration;

    public ReportService(ReportRepository reports, ReportMapper mapper, AuditService audit,
            PropertyModerationService propertyModeration, UserAdminService userAdmin,
            FlatmateModerationService flatmateModeration) {
        this.reports = reports;
        this.mapper = mapper;
        this.audit = audit;
        this.propertyModeration = propertyModeration;
        this.userAdmin = userAdmin;
        this.flatmateModeration = flatmateModeration;
    }

    /** Target is deliberately not resolved: a scammer deleting the listing must not also delete the complaint. */
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
            // Concurrent submissions both pass the check above; the V18 partial unique index is the serialiser.
            throw new ConflictException("You have already reported this, and it is still being reviewed");
        }
    }

    /** Filters are validated: an unknown value would give an empty page that reads as "queue clear".
     * Each row carries how many reports its target has drawn, counted for this page only. */
    @Transactional(readOnly = true)
    public Page<ReportResponse> list(String status, String reason, String targetType, String q,
            Integer sinceDays, Pageable pageable) {
        String wantedStatus = blankToNull(status);
        String wantedReason = blankToNull(reason);
        String wantedTargetType = blankToNull(targetType);
        String like = blankToNull(q) == null ? null : "%" + q.strip().toLowerCase(Locale.ROOT) + "%";
        Instant since = sinceDays == null || sinceDays <= 0 ? null : Instant.now().minus(sinceDays, ChronoUnit.DAYS);

        if (wantedStatus != null && !ReportStatuses.isValid(wantedStatus)) {
            throw new BadRequestException("Unknown report status: " + wantedStatus);
        }
        if (wantedTargetType != null && !ReportTargetTypes.isValid(wantedTargetType)) {
            throw new BadRequestException("Unknown report target type: " + wantedTargetType);
        }
        if (wantedReason != null && !ReportReasons.isKnown(wantedReason)) {
            throw new BadRequestException("Unknown report reason: " + wantedReason);
        }

        Page<Report> page;
        if (wantedReason == null && wantedTargetType == null && like == null && since == null) {
            page = wantedStatus == null
                    ? reports.findAllByOrderByCreatedAtDesc(pageable)
                    : reports.findByStatusOrderByCreatedAtDesc(wantedStatus, pageable);
        } else {
            page = reports.search(wantedStatus, wantedReason, wantedTargetType, like,
                    since == null ? Instant.EPOCH : since, pageable);
        }
        Map<String, Long> perTarget = targetTallies(page.getContent());
        return page.map(r -> mapper.toResponse(r).withTargetReportCount(perTarget.getOrDefault(r.getTargetId(), 1L)));
    }

    /** Undecided per target type for the tab badges, and per status within {@code targetType} for the chips. */
    @Transactional(readOnly = true)
    public Map<String, Long> counts(String targetType) {
        String wantedTargetType = blankToNull(targetType);
        if (wantedTargetType != null && !ReportTargetTypes.isValid(wantedTargetType)) {
            throw new BadRequestException("Unknown report target type: " + wantedTargetType);
        }
        Map<String, Long> out = new LinkedHashMap<>();
        for (String type : List.of(ReportTargetTypes.PROPERTY, ReportTargetTypes.USER, ReportTargetTypes.POST)) {
            out.put("undecided." + type, 0L);
        }
        for (Object[] row : reports.countByTargetType(ReportStatuses.LIVE)) {
            out.put("undecided." + row[0], ((Number) row[1]).longValue());
        }
        for (String s : List.of(ReportStatuses.OPEN, ReportStatuses.REVIEWING, ReportStatuses.ACTIONED,
                ReportStatuses.DISMISSED)) {
            out.put("status." + s, 0L);
        }
        long all = 0;
        for (Object[] row : reports.countByStatus(wantedTargetType)) {
            long n = ((Number) row[1]).longValue();
            out.put("status." + row[0], n);
            all += n;
        }
        out.put("status.all", all);
        return out;
    }

    private Map<String, Long> targetTallies(List<Report> rows) {
        Set<String> ids = rows.stream().map(Report::getTargetId).collect(Collectors.toSet());
        Map<String, Long> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] row : reports.countByTarget(ids)) {
            out.put((String) row[0], ((Number) row[1]).longValue());
        }
        return out;
    }

    /** Defined here so "outstanding" stays with the status vocabulary and the tile matches the screen. */
    @Transactional(readOnly = true)
    public long openCount() {
        return reports.countByStatusIn(ReportStatuses.LIVE);
    }

    /** Decision and enforcement commit in one transaction; only {@code actioned} may enforce, since "dismissed
     * and taken down" would leave a self-contradicting audit trail. */
    @Transactional
    public ReportResponse triage(AuthPrincipal actor, String id, ReportTriageRequest body) {
        if (!ReportStatuses.isValid(body.status())) {
            throw new BadRequestException("Unknown report status: " + body.status());
        }
        String enforcement = body.enforcementOrNone();
        if (!ReportEnforcement.isValid(enforcement)) {
            throw new BadRequestException("Unknown enforcement: " + enforcement);
        }
        Report report = reports.findById(parseId(id))
                .orElseThrow(() -> NotFoundException.of("Report"));
        String from = report.getStatus();
        if (!ReportStatuses.canTransition(from, body.status())) {
            throw new ConflictException(
                    "Cannot move a report from %s to %s. A decided report is not reopened — file a new one."
                            .formatted(from, body.status()));
        }
        if (!ReportEnforcement.NONE.equals(enforcement)
                && !ReportStatuses.ACTIONED.equals(body.status())) {
            throw new BadRequestException(
                    "An enforcement can only accompany status=actioned. A report moved to '%s' has"
                            .formatted(body.status())
                            + " not been upheld, so there is nothing to enforce.");
        }
        if (!ReportEnforcement.isSupported(report.getTargetType(), enforcement)) {
            throw new BadRequestException(
                    ReportEnforcement.refusalFor(report.getTargetType(), enforcement));
        }

        report.triage(body.status());
        enforce(actor, report, enforcement, body.note());
        audit.record(actor, "report.triage", "report", id, "from", from, "to", body.status(),
                "enforcement", enforcement, "target", report.getTargetType(),
                "targetId", report.getTargetId(), "note", body.note());
        return mapper.toResponse(report);
    }

    /** Delegates to the moderation services that own these transitions so their self-dealing guards and audit rows
     * apply; a missing target is a 404 so the moderator never closes a report believing something was done. */
    private void enforce(AuthPrincipal actor, Report report, String enforcement, String note) {
        String because = "Reported: " + report.getReason()
                + (note == null || note.isBlank() ? "" : " — " + note.trim());
        switch (enforcement) {
            case ReportEnforcement.HIDE_CONTENT -> {
                if (ReportTargetTypes.POST.equals(report.getTargetType())) {
                    flatmateModeration.moderate(actor, parseId(report.getTargetId()), "removed", because);
                } else {
                    propertyModeration.flag(actor, report.getTargetId(), because);
                }
            }
            case ReportEnforcement.SUSPEND_ACCOUNT ->
                    userAdmin.archive(actor, report.getTargetId(), because);
            default -> {
                // ReportEnforcement.NONE — the moderator decided the complaint and touched nothing.
            }
        }
    }

    /** A malformed id is a 404 for the same reason somebody else's is: it does not exist for you. */
    private static UUID parseId(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Report"));
    }

    /** A blank filter means "no filter": {@code ""} is a legal column value and would match nothing. */
    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
