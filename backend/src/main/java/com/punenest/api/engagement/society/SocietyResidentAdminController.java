package com.punenest.api.engagement.society;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Roles;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/society-residents} — ops seeing who is waiting to be recognised, anywhere.
 *
 * <p>The fourth and last queue in this console that was answered out of the operator's own browser.
 * The residency data itself has been real since the claims slice, but the only route to it is
 * addressed by slug, and this screen is cross-society by definition — so the tab kept reading
 * {@code localStorage} and was permanently empty however many people applied.
 *
 * <p><strong>Why there is no decide route here.</strong>
 * {@code PATCH /societies/{slug}/residents/{residentId}} already exists, already admits staff, and
 * already carries the rule that a flat has one verified holder. Every row below publishes the slug
 * that addresses it, so the console can act on what it reads without a second door. A parallel
 * decision route would be a second copy of that rule, and the copy that is not exercised by the
 * committee's own daily use is the one that would drift.
 *
 * <p>Guarded by the same {@code societies:read} atom as the claims, proposals and candidates desks,
 * for the reason given on {@link SocietyClaimAdminController}: they are one job seen from four ends,
 * and a fifth atom would leave an existing ops account silently unable to clear one of the four
 * queues it already works. Read-only, so {@code societies:write} is not named — an account cleared
 * to see the backlog without acting on it is exactly what the split exists for.
 */
@RestController
public class SocietyResidentAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String SOCIETIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_READ;

    private final SocietyMembershipService memberships;

    public SocietyResidentAdminController(SocietyMembershipService memberships) {
        this.memberships = memberships;
    }

    /**
     * {@code GET /admin/society-residents} — the queue across every society, oldest first.
     *
     * <p>Sort is stripped rather than honoured, as on the per-society read: the order is fixed in
     * the query, and a client sort would add a second {@code order by} the projection cannot serve.
     */
    @GetMapping(Routes.SocietyResidents.BASE)
    @PreAuthorize(SOCIETIES_READ)
    public PageResponse<SocietyResidentQueueRow> queue(
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                memberships.residentQueue(status, Pageables.unsorted(pageable)), r -> r);
    }
}
