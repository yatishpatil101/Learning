package com.draazy.api.admin;

import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.moderation.property.PendingQueue;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.PermissionMap;
import com.draazy.api.services.ticket.TicketRow;
import com.draazy.api.services.ticket.TicketService;
import com.draazy.api.services.ticket.TicketStatuses;
import java.time.Duration;
import java.time.Instant;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

@Service
public class AdminDashboardService {

    private static final Duration STALE_AFTER = Duration.ofHours(48);
    private static final int ROWS = 5;
    private static final int TRAFFIC_DAYS = 30;

    private final AccountPermissions atoms;
    private final PermissionMap capabilities;
    private final AdminMetricsService metrics;
    private final AdminMetricsRepository counts;
    private final AdminPageViewAnalyticsService traffic;
    private final AdminSlaService sla;
    private final PendingQueue pending;
    private final TicketService tickets;

    public AdminDashboardService(AccountPermissions atoms, PermissionMap capabilities,
            AdminMetricsService metrics, AdminMetricsRepository counts,
            AdminPageViewAnalyticsService traffic, AdminSlaService sla, PendingQueue pending,
            TicketService tickets) {
        this.atoms = atoms;
        this.capabilities = capabilities;
        this.metrics = metrics;
        this.counts = counts;
        this.traffic = traffic;
        this.sla = sla;
        this.pending = pending;
        this.tickets = tickets;
    }

    public AdminDashboard dashboard(AuthPrincipal caller) {
        boolean scorecard = capabilities.granted(caller, Capabilities.VIEW_DASHBOARD)
                && atoms.granted(caller, BackOfficePermissions.ANALYTICS_READ);
        boolean properties = atoms.granted(caller, BackOfficePermissions.PROPERTIES_READ);
        boolean enquiries = atoms.granted(caller, BackOfficePermissions.ENQUIRIES_READ);
        boolean ticketDesk = atoms.granted(caller, BackOfficePermissions.TICKETS_READ);
        boolean users = atoms.granted(caller, BackOfficePermissions.USERS_READ);
        return new AdminDashboard(
                scorecard ? metrics.dashboard(caller) : null,
                scorecard ? traffic() : null,
                scorecard ? slaGlance() : null,
                properties ? listings() : null,
                enquiries ? demand() : null,
                ticketDesk ? tickets(caller) : null,
                users ? counts.countUsersWithRole("owner") : null);
    }

    private AdminDashboard.Traffic traffic() {
        return traffic.glance(TRAFFIC_DAYS);
    }

    private AdminDashboard.SlaGlance slaGlance() {
        SlaSummary s = sla.glance();
        return new AdminDashboard.SlaGlance(
                new AdminDashboard.Track(s.slaRatePct(), s.targetHours(), s.pendingBreachingCount()),
                track(s.ticketPickup()), track(s.ticketDelivery()), track(s.conciergeToLive()));
    }

    private static AdminDashboard.Track track(SlaSummary.Track t) {
        return t == null ? null
                : new AdminDashboard.Track(t.slaRatePct(), t.targetHours(), t.outstandingBreachingCount());
    }

    private AdminDashboard.Listings listings() {
        var c = pending.counts(Instant.now().minus(STALE_AFTER));
        return new AdminDashboard.Listings(c.pending(), c.flagged(), c.followUp(),
                pending.pending(ROWS, true));
    }

    private AdminDashboard.Demand demand() {
        return new AdminDashboard.Demand(counts.countContactRequests("pending"),
                counts.countVisits("scheduled"), counts.countDealsNotClosed());
    }

    // A staffer on no desk has no board; the section is left out rather than zeroed.
    private AdminDashboard.Tickets tickets(AuthPrincipal caller) {
        try {
            var latest = tickets.rows(caller, null, null, null, null, PageRequest.of(0, ROWS)).getContent();
            long open = tickets.countOpen(caller, null);
            String openTeam = open == 0 ? null : latest.stream()
                    .filter(t -> TicketStatuses.OPEN.equals(t.status())).map(TicketRow::team).findFirst()
                    .orElseGet(() -> tickets.rows(caller, null, TicketStatuses.OPEN, null, null,
                            PageRequest.of(0, 1)).getContent().getFirst().team());
            return new AdminDashboard.Tickets(open, openTeam, latest.stream().map(AdminDashboardService::row).toList());
        } catch (ForbiddenException noDesk) {
            return null;
        }
    }

    private static AdminDashboard.TicketRow row(TicketRow t) {
        return new AdminDashboard.TicketRow(t.id(), t.team(), t.service(), t.customer(), t.detail(),
                t.status());
    }
}