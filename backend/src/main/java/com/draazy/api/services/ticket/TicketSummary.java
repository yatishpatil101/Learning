package com.draazy.api.services.ticket;

/** Ticket counts per status for one board scope, whatever page the list is on. */
public record TicketSummary(long open, long inProgress, long waiting, long resolved, long closed, long all) {
}
