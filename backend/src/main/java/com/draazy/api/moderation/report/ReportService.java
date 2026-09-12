package com.draazy.api.moderation.report;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.moderation.property.PropertyModerationService;
import com.draazy.api.moderation.user.UserAdminService;
import com.draazy.api.security.AuthPrincipal;
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
    private final PropertyModerationService propertyModeration;
    private final UserAdminService userAdmin;
    private final com.draazy.api.moderation.society.SocietyContentModerationService societyContent;

    public ReportService(ReportRepository reports, ReportMapper mapper, AuditService audit,
            PropertyModerationService propertyModeration, UserAdminService userAdmin,
            com.draazy.api.moderation.society.SocietyContentModerationService societyContent) {
        this.reports = reports;
        this.mapper = mapper;
        this.audit = audit;
        this.propertyModeration = propertyModeration;
        this.userAdmin = userAdmin;
        this.societyContent = societyContent;
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
     * <p>All three filters are optional and combine. The two indexed shapes — the whole queue, and
     * one status — keep their dedicated finders; anything narrower falls through to
     * {@link ReportRepository#search}, which is a scan either way because neither {@code reason} nor
     * {@code target_type} is indexed (V18). See that repository's Javadoc for why the split is worth
     * keeping rather than collapsing into one query.
     *
     * <p>Every filter value is validated against its vocabulary rather than passed through. An
     * unknown value would otherwise return an empty page, and an empty page is the same thing a
     * moderator sees when there is genuinely nothing to do — so a typo would read as "queue clear".
     *
     * @param status     optional triage state; blank or {@code null} returns every state
     * @param reason     optional complaint code; blank or {@code null} returns every reason
     * @param targetType optional reportable kind; blank or {@code null} returns every kind
     */
    @Transactional(readOnly = true)
    public Page<ReportResponse> list(String status, String reason, String targetType,
            Pageable pageable) {
        String wantedStatus = blankToNull(status);
        String wantedReason = blankToNull(reason);
        String wantedTargetType = blankToNull(targetType);

        if (wantedStatus != null && !ReportStatuses.isValid(wantedStatus)) {
            throw new BadRequestException("Unknown report status: " + wantedStatus);
        }
        if (wantedTargetType != null && !ReportTargetTypes.isValid(wantedTargetType)) {
            throw new BadRequestException("Unknown report target type: " + wantedTargetType);
        }
        if (wantedReason != null && !ReportReasons.isKnown(wantedReason)) {
            throw new BadRequestException("Unknown report reason: " + wantedReason);
        }

        if (wantedReason == null && wantedTargetType == null) {
            Page<Report> page = wantedStatus == null
                    ? reports.findAllByOrderByCreatedAtDesc(pageable)
                    : reports.findByStatusOrderByCreatedAtDesc(wantedStatus, pageable);
            return page.map(mapper::toResponse);
        }
        return reports.search(wantedStatus, wantedReason, wantedTargetType, pageable)
                .map(mapper::toResponse);
    }

    /**
     * How many complaints are still awaiting a decision — the backlog the ops scorecard shows
     * (tech debt D68).
     *
     * <p>Lives here rather than in {@code AdminMetricsService} so the definition of "outstanding"
     * stays with the vocabulary that defines it. The scorecard asks the queue how long it is; it
     * does not get to have its own opinion about which statuses count, which is precisely how the
     * tile and the screen it links to end up showing different numbers.
     */
    @Transactional(readOnly = true)
    public long openCount() {
        return reports.countByStatusIn(ReportStatuses.LIVE);
    }

    /**
     * Move a report through triage, and carry out the decision. Staff/admin.
     *
     * <p><strong>The enforcement is the point of the endpoint now.</strong> Before it, {@code
     * actioned} was a word: the report changed state and the reported listing stayed live. The
     * moderator's decision and its effect are applied in <em>one</em> transaction so that there is
     * no interleaving in which the queue says a complaint was upheld and the platform behaves as
     * though it was not.
     *
     * <p><strong>Only {@code actioned} may enforce.</strong> "Dismissed, and also taken down" is not
     * a decision anybody means, and a queue that permitted it would leave an audit trail whose two
     * halves contradict each other. Refusing at the boundary is cheaper than explaining later.
     *
     * <p>Writes an audit entry naming the moderator, the report, both ends of the transition, the
     * enforcement and any internal note. The enforcement primitives write their <em>own</em> audit
     * rows against their own entities ({@code property.flag}, {@code user.archive}) — deliberately
     * not suppressed, because somebody auditing the listing must see why it went dark without
     * having to know that a report existed, and somebody auditing the queue must see what the
     * decision did without having to go and look at the listing.
     *
     * @throws NotFoundException   if no such report — including when {@code id} is not a UUID, since
     *                             a malformed id and a stranger's id should be indistinguishable
     * @throws ConflictException   if the transition is illegal (a decided report is never reopened)
     * @throws BadRequestException if the target status is not one of the four, or the enforcement is
     *                             not one this target type supports
     */
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

    /**
     * Carry the decision out against the thing that was reported.
     *
     * <p>Delegates to the moderation services that already own these transitions rather than
     * reaching into the tables directly. That is what makes a takedown raised from the abuse queue
     * indistinguishable from one raised by hand — same row, same state, same audit verb, and
     * crucially the same refusals: {@code PropertyModerationService} will not let a moderator flag
     * their own listing and {@code UserAdminService} will not let an admin archive themselves, and
     * neither guard would have been reproduced correctly here.
     *
     * <p>A target that no longer exists is a 404, and deliberately so. The alternative — decide the
     * report anyway and record that the enforcement "did not apply" — closes a complaint with the
     * moderator believing something was done. Nothing is committed, so the moderator sees the
     * failure and can dismiss the report instead.
     */
    private void enforce(AuthPrincipal actor, Report report, String enforcement, String note) {
        String because = "Reported: " + report.getReason()
                + (note == null || note.isBlank() ? "" : " — " + note.trim());
        switch (enforcement) {
            case ReportEnforcement.HIDE_CONTENT -> {
                if (ReportTargetTypes.isSocietyContent(report.getTargetType())) {
                    societyContent.remove(actor, report.getTargetType(), report.getTargetId(),
                            because);
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

    /**
     * A blank filter means "no filter", not "match the empty string".
     *
     * <p>{@link ReportRepository#search} tests its parameters with {@code is null}, and an empty
     * string is a value the column can legally hold — so passing {@code ""} through would narrow the
     * queue to nothing while looking like it narrowed it to everything.
     */
    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
