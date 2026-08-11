package com.punenest.api.moderation.report;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /reports} — the trust &amp; safety queue.
 *
 * <p><strong>The two methods on this one path have deliberately different guards</strong>, and that
 * asymmetry is the whole design of an abuse queue: {@code POST} is open to every authenticated user
 * because a queue only privileged people can write to reports nothing, while {@code GET} is
 * staff/admin because the queue holds unproven allegations about named people. Because the split is
 * per-method and not per-path, it is expressed with {@code @PreAuthorize} on the method
 * (api-standards.md §6) — a path-level matcher in the security chain could not express it at all.
 *
 * <p>This is the first controller in the codebase to carry a role guard. Every slice before this one
 * legitimately had none: no operation in slices 1–8 carried {@code x-roles}, and caller-scoping was
 * the guard. Slice 9's spec fix S28 added {@code x-roles} to 26 back-office operations that had been
 * left open by omission, and these annotations are what enforce them.
 */
@RestController
public class ReportController {

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    /**
     * {@code POST /reports} (contract {@code createReport}) — 201. Any authenticated caller.
     *
     * <p>No role guard, and that is the contract's position too (S28 recorded it explicitly so that
     * a later reader "finishing the job" of adding guards does not sweep this one in). The reporter
     * is taken from the principal, never from the body.
     */
    @PostMapping(Routes.Moderation.REPORTS)
    @ResponseStatus(HttpStatus.CREATED)
    public ReportResponse create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ReportCreateRequest body) {
        return reportService.create(principal.userId(), body);
    }

    /**
     * {@code GET /reports} (contract {@code listReports}, {@code x-roles: [staff, admin]}) — paged.
     *
     * <p>Paged since spec fix S32: every signed-in user can add to this queue and only ops can take
     * anything out of it, which makes it the platform's clearest growth case. The sort is stripped
     * via {@link Pageables#unsorted(Pageable)} — newest-first is fixed server-side and index-backed
     * (V18), so an incoming {@code ?sort=} would otherwise be an unmapped-property 500.
     *
     * <p><strong>{@code reason} and {@code targetType} are served here rather than left to the
     * client</strong> (tech debt D68). The admin queue used to read the whole table unpaged and
     * filter in the browser, which works exactly until the queue outgrows one page — and then every
     * filter, every tab count and the repeat-offender badge silently start describing page one while
     * still looking like totals. A filter that the server cannot apply is a filter that stops being
     * true without saying so.
     */
    @GetMapping(Routes.Moderation.REPORTS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public PageResponse<ReportResponse> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String reason,
            @RequestParam(required = false) String targetType,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                reportService.list(status, reason, targetType, Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /**
     * {@code PATCH /reports/{id}} (contract {@code triageReport}, spec fix S30,
     * {@code x-roles: [staff, admin]}).
     *
     * <p>The body's optional {@code enforcement} is what makes this endpoint do something rather
     * than say something — see {@link ReportEnforcement}.
     */
    @PatchMapping(Routes.Moderation.REPORT_BY_ID)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public ReportResponse triage(@CurrentUser AuthPrincipal principal,
            @PathVariable String id,
            @Valid @RequestBody ReportTriageRequest body) {
        return reportService.triage(principal, id, body);
    }
}
