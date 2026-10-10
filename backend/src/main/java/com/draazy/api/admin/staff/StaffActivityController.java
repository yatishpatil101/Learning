package com.draazy.api.admin.staff;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.function.Function;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only by construction: a review surface that could write audit rows could edit the record it reviews. */
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
                        Pageables.unsorted(pageable), Roles.Wire.ADMIN.equals(principal.role())),
                Function.identity());
    }

    /** Takes the same filters as the feed so the totals describe what the console is showing. */
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
