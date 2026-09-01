package com.punenest.api.services.ticket;

import java.util.Set;

/** The {@code tickets.status} vocabulary (V7 CHECK) and the {@code TicketUpdate} enum. */
public final class TicketStatuses {

    private TicketStatuses() {
    }

    public static final String OPEN = "open";
    public static final String IN_PROGRESS = "in-progress";
    public static final String WAITING = "waiting";
    public static final String RESOLVED = "resolved";
    public static final String CLOSED = "closed";

    private static final Set<String> ALL = Set.of(OPEN, IN_PROGRESS, WAITING, RESOLVED, CLOSED);

    /**
     * The statuses that mean somebody still owes the customer something (D4).
     *
     * <p>Used by the public service-waitlist's duplicate check. {@code resolved} and {@code closed}
     * are outside it deliberately: a signup the desk has already dealt with is finished business, so
     * the same person asking again is a new lead rather than a repeat of a row nobody is watching.
     * The line falls where it does because that is the answer to "would a second row tell ops
     * anything they do not already have in front of them".
     */
    public static final Set<String> UNRESOLVED = Set.of(OPEN, IN_PROGRESS, WAITING);

    /**
     * A ticket board has no state machine, on purpose.
     *
     * <p>Unlike a service request — where {@code approved} means a person accepted a deliverable and
     * the order of events is the control — a ticket's status is a label ops move around. Reopening a
     * closed ticket is normal work, not a violation, so the only rule is that the label is one of
     * the five.
     */
    public static boolean isKnown(String status) {
        return ALL.contains(status);
    }
}
