package com.draazy.api.admin.staff;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.time.Instant;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Staff Activity console: who in the back office did what, and how much of it.
 *
 * <p>Administrators see the full back-office feed; managers with {@code audit:read} see staff rows
 * only. The atom stays {@code audit:read} because this route is an audit-log projection, not a
 * separate source of truth.
 *
 * <p>Read-only by construction. Nothing here can write an audit row, which matters more than usual:
 * a review surface that could edit the record it reviews is not a review surface.
 */
@RestController
public class StaffActivityController {

    private static final String GUARD = "hasAnyRole('" + Roles.MANAGER + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_AUDIT_READ;

    private final StaffActivityService activity;

    StaffActivityController(StaffActivityService activity) {
        this.activity = activity;
    }

    @GetMapping(Routes.Admin.STAFF_ACTIVITY)
    @PreAuthorize(GUARD)
    public PageResponse<StaffActivityEntry> feed(
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String entity,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) String q,
            @CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                activity.feed(new StaffActivityFilter(actor, entity, action, from, to, q,
                                actorRoleFilter(principal)),
                        Pageables.unsorted(pageable)),
                row -> row);
    }

    /**
     * The same window as the feed, aggregated. Takes the identical filter set so that a console
     * which narrows to one colleague or one week gets a leaderboard and a total for what it is
     * showing, rather than a headline about the whole platform sitting above a filtered list.
     */
    @GetMapping(Routes.Admin.STAFF_ACTIVITY_SUMMARY)
    @PreAuthorize(GUARD)
    public StaffActivitySummary summary(
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String entity,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) String q,
            @CurrentUser AuthPrincipal principal) {
        return activity.summary(new StaffActivityFilter(actor, entity, action, from, to, q,
                actorRoleFilter(principal)));
    }

    private static String actorRoleFilter(AuthPrincipal principal) {
        return Roles.Wire.MANAGER.equals(principal.role()) ? Roles.Wire.STAFF : null;
    }
}
