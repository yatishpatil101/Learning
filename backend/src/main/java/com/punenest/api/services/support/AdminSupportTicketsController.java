package com.punenest.api.services.support;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.Roles;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /admin/support-tickets} (contract {@code adminSupportTickets}) — the platform-wide
 * support queue. Closes D51.
 *
 * <p><strong>Why this is a separate operation and a separate controller.</strong> S47 narrowed
 * {@code GET /support/tickets} to the caller's own tickets for every role, and that was right: for a
 * customer the collection grows with their own activity (bare array), for an admin it grows with the
 * platform (page envelope), and one operation cannot be both without changing shape by role. It left
 * ops with no support overview at all, which is the debt this closes — as a new operation, not by
 * reopening that one.
 *
 * <p>The neighbour on {@code SupportTicketsController} carries no {@code @PreAuthorize} because
 * every guard there is "is this your ticket, or are you ops", a question about the row. This one is
 * a plain role question, so it is answered here, before a row is read.
 *
 * <p><strong>Staff as well as admin</strong>, unlike {@code /admin/audit-log}. Answering support
 * tickets is the desk's job and staff have always been able to read and reply to any ticket at
 * {@code GET /support/tickets/{id}}; withholding only the index would leave them able to act on
 * tickets they have no way to find. The audit log is narrower for the opposite reason — it exists to
 * hold its own readers to account.
 */
@RestController
public class AdminSupportTicketsController {

    private final SupportTicketService service;

    public AdminSupportTicketsController(SupportTicketService service) {
        this.service = service;
    }

    /**
     * Paged, newest first, threads omitted — see {@link AdminSupportTicketDto}.
     *
     * <p>The order is fixed server-side and {@link com.punenest.api.common.web.Pageables#unsorted}
     * strips any {@code ?sort=} a client sends, per api-standards.md §5: this endpoint publishes no
     * sort whitelist, and an unvalidated sort property reaching the query is a 500 any caller can
     * trigger with a guess.
     *
     * @param awaitingReply omit for the whole archive; {@code true} for the tickets with a customer
     *     message nobody on the desk has read, which is the queue D50's second column made
     *     answerable
     */
    @GetMapping(Routes.Admin.SUPPORT_TICKETS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public PageResponse<AdminSupportTicketDto> queue(
            @RequestParam(required = false) Boolean awaitingReply,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.queue(awaitingReply, pageable), d -> d);
    }
}
