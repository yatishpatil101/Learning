package com.draazy.api.services.support;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** {@code GET /admin/support-tickets}: the platform-wide support queue. Staff may read it, unlike the audit log,
 * since they can already open any ticket by id. */
@RestController
public class AdminSupportTicketsController {

    private final SupportTicketService service;

    public AdminSupportTicketsController(SupportTicketService service) {
        this.service = service;
    }

    /** Newest first, threads omitted; {@link com.draazy.api.common.web.Pageables#unsorted} strips {@code ?sort=}, as this endpoint
     * publishes no sort whitelist (api-standards.md §5). {@code counts} carries the three tab totals over the whole table. */
    @GetMapping(Routes.Admin.SUPPORT_TICKETS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_TICKETS_READ)
    public PageResponse<AdminSupportTicketDto> queue(
            @RequestParam(required = false) Boolean awaitingReply,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.queue(awaitingReply, pageable), d -> d)
                .withCounts(service.queueCounts());
    }
}
