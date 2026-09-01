package com.punenest.api.admin.staff;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Roles;
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
 * <p>Both routes are administrator-only under {@code audit:read}, the same guard as the audit log
 * itself. They read the same table, and a capability that reads another module's rows cannot be more
 * public than the module that owns them — otherwise the permission that keeps staff out of
 * {@code GET /admin/audit-log} is a lock on one of two doors. The atom is {@code audit:read} rather
 * than a new {@code staff:read} for exactly that reason: a second name for the same access is a
 * second thing to remember to revoke.
 *
 * <p>Read-only by construction. Nothing here can write an audit row, which matters more than usual:
 * a review surface that could edit the record it reviews is not a review surface.
 */
@RestController
public class StaffActivityController {

    private static final String GUARD = "hasRole('" + Roles.ADMIN + "') and "
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
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                activity.feed(new StaffActivityFilter(actor, entity, action, from, to, q),
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
            @RequestParam(required = false) String q) {
        return activity.summary(new StaffActivityFilter(actor, entity, action, from, to, q));
    }
}
