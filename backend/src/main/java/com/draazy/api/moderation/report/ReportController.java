package com.draazy.api.moderation.report;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
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

/** {@code POST} is open to any authenticated user (an unwritable queue reports nothing); {@code GET}
 * is staff/admin as the queue holds unproven allegations; per-method, hence {@code @PreAuthorize}. */
@RestController
public class ReportController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String REPORTS_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_REPORTS_READ;
    private static final String REPORTS_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_REPORTS_WRITE;

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    /** No role guard, by contract; the reporter comes from the principal, never from the body. */
    @PostMapping(Routes.Moderation.REPORTS)
    @ResponseStatus(HttpStatus.CREATED)
    public ReportResponse create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ReportCreateRequest body) {
        return reportService.create(principal.userId(), body);
    }

    /** Sort is stripped via {@link Pageables#unsorted(Pageable)}: newest-first is fixed and index-backed,
     * so a client {@code ?sort=} would be an unmapped-property 500. */
    @GetMapping(Routes.Moderation.REPORTS)
    @PreAuthorize(REPORTS_READ)
    public PageResponse<ReportResponse> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String reason,
            @RequestParam(required = false) String targetType,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer sinceDays,
            @RequestParam(defaultValue = "false") boolean counts,
            @PageableDefault(size = 20) Pageable pageable) {
        PageResponse<ReportResponse> page = PageResponse.of(
                reportService.list(status, reason, targetType, q, sinceDays, Pageables.unsorted(pageable)),
                dto -> dto);
        return counts ? page.withCounts(reportService.counts(targetType)) : page;
    }

    @PatchMapping(Routes.Moderation.REPORT_BY_ID)
    @PreAuthorize(REPORTS_WRITE)
    public ReportResponse triage(@CurrentUser AuthPrincipal principal,
            @PathVariable String id,
            @Valid @RequestBody ReportTriageRequest body) {
        return reportService.triage(principal, id, body);
    }
}
