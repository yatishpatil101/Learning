package com.draazy.api.services.support;

/**
 * The values {@code support_tickets.status} may hold, mirrored from the V8 CHECK and the contract's
 * {@code SupportTicket.status} enum.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1.
 *
 * <p>Nothing in the contract transitions a support ticket — there is no
 * {@code PATCH /support/tickets/{id}}. So this type deliberately has no {@code canTransition}: every
 * ticket is created {@code open} and stays there until an ops surface that can move it exists.
 * Writing a transition table now would be guessing at a workflow nobody has specified, and a wrong
 * guess in this file becomes the workflow by default.
 */
public final class SupportTicketStatuses {

    private SupportTicketStatuses() {
    }

    /** The only state a ticket is created in. */
    public static final String OPEN = "open";

    public static final String IN_PROGRESS = "in-progress";

    public static final String WAITING = "waiting";

    public static final String RESOLVED = "resolved";

    public static final String CLOSED = "closed";
}
