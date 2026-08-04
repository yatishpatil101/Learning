package com.punenest.api.services.ticket;

import java.util.Set;

/** The {@code tickets.priority} vocabulary (V7 CHECK). */
public final class TicketPriorities {

    private TicketPriorities() {
    }

    public static final String LOW = "low";
    public static final String MEDIUM = "medium";
    public static final String HIGH = "high";
    public static final String URGENT = "urgent";

    private static final Set<String> ALL = Set.of(LOW, MEDIUM, HIGH, URGENT);

    public static boolean isKnown(String priority) {
        return ALL.contains(priority);
    }
}
