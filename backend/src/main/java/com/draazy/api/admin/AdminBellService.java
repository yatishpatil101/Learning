package com.draazy.api.admin;

import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.moderation.property.PendingQueue;
import com.draazy.api.moderation.verification.PropertyReviewQueue;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.services.ticket.TicketService;
import com.draazy.api.services.ticket.TicketStatuses;
import java.time.Instant;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

@Service
public class AdminBellService {

    private static final int ROWS = 5;

    private final AccountPermissions permissions;
    private final PendingQueue pending;
    private final PropertyReviewQueue reviews;
    private final TicketService tickets;

    public AdminBellService(AccountPermissions permissions, PendingQueue pending,
            PropertyReviewQueue reviews, TicketService tickets) {
        this.permissions = permissions;
        this.pending = pending;
        this.reviews = reviews;
        this.tickets = tickets;
    }

    // Each section is read under the same atom, and the same desk scoping, as the list it replaces.
    public AdminBell bell(AuthPrincipal caller) {
        boolean properties = permissions.granted(caller, BackOfficePermissions.PROPERTIES_READ);
        boolean ticketDesk = permissions.granted(caller, BackOfficePermissions.TICKETS_READ);
        return new AdminBell(
                properties ? listings() : null,
                ticketDesk ? openTickets(caller) : null,
                properties ? replies() : null);
    }

    private AdminBell.Listings listings() {
        return new AdminBell.Listings(
                pending.counts(Instant.now()).pending(),
                pending.pending(ROWS, false).stream()
                        .map(r -> new AdminBell.Listing(r.id(), r.title(), r.locality(), r.owner()))
                        .toList());
    }

    private AdminBell.Replies replies() {
        var page = reviews.awaitingReplies(PageRequest.of(0, ROWS));
        return new AdminBell.Replies(page.getTotalElements(), page.getContent().stream()
                .map(r -> new AdminBell.Reply(r.propertyId(), r.propertyTitle(), r.lastMessage()))
                .toList());
    }

    // A staffer on no desk has no queue; the section is left out, as the board's 403 left it dark.
    private AdminBell.Tickets openTickets(AuthPrincipal caller) {
        try {
            var page = tickets.list(caller, null, TicketStatuses.OPEN, PageRequest.of(0, ROWS));
            return new AdminBell.Tickets(page.getTotalElements(), page.getContent().stream()
                    .map(t -> new AdminBell.Ticket(t.id(), t.team(), t.service(), t.customer(), MobileMask.mask(t.mobile())))
                    .toList());
        } catch (ForbiddenException noDesk) {
            return null;
        }
    }
}