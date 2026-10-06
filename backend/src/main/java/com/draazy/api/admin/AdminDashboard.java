package com.draazy.api.admin;

import com.draazy.api.moderation.property.PendingQueue;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** A section is present only when the caller holds its atom, so absent means "not yours", never "zero". */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminDashboard(
        AdminKpis kpis,
        Traffic traffic,
        SlaGlance sla,
        Listings listings,
        Demand demand,
        Tickets tickets,
        Long owners) {

    /** Today's and the last thirty days' sessions, and today's signups. */
    public record Traffic(long signupsToday, long sessionsToday, long sessions30d) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SlaGlance(Track listingApproval, Track ticketPickup, Track ticketDelivery,
            Track conciergeToLive) {
    }

    /** {@code slaRatePct} is null, not 100, when nothing has been measured. */
    public record Track(Integer slaRatePct, int targetHours, long late) {
    }

    /** {@code followUp}: pending over 48 hours, or staff-posted and not yet confirmed by the owner. */
    public record Listings(long pending, long flagged, long followUp,
            List<PendingQueue.Row> oldestPending) {
    }

    /** Whole-table counts: pending enquiries, scheduled visits, deals not yet closed. */
    public record Demand(long newEnquiries, long scheduledVisits, long dealsInProgress) {
    }

    public record Tickets(long open, String openTeam, List<TicketRow> latest) {
    }

    public record TicketRow(String id, String team, String service, String customer, String detail,
            String status) {
    }
}