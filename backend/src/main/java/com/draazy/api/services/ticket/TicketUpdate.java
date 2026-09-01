package com.draazy.api.services.ticket;

import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code TicketUpdate} (spec fix S42). Every field is optional — this is a PATCH,
 * and an absent field means "leave it".
 *
 * <p>{@code assigneeId} is a user id, not the display name the {@code Ticket} schema shows: two
 * staffers called Rohit cannot be told apart by name, and a rename would orphan the ticket.
 *
 * <p><strong>Unassigning takes a word, not a null (debt D46).</strong> A record cannot tell an
 * absent JSON field from an explicit {@code null} — both arrive as a {@code null} component — so
 * "leave the assignee alone" and "take the assignee off" would be the same request. The platform
 * resolves that everywhere the same way: absence wins, because a PATCH that silently wiped a field
 * the caller never mentioned is the worse of the two mistakes. That leaves unassignment with no
 * spelling, which is what D46 recorded.
 *
 * <p>The fix is a reserved value, {@link #UNASSIGN}, rather than a wrapper type or a second
 * endpoint. A wrapper ({@code JsonNullable} and friends) would buy a distinction this API needs in
 * exactly one place at the cost of a new dependency and a new idiom every future request record
 * would have to be read against. A {@code DELETE /tickets/{id}/assignee} would be a second write
 * path into a column that already has one, and ops would have to make two calls to hand a ticket
 * back to the pool while closing it. A reserved word costs one branch and reads plainly in an audit
 * row. {@code "none"} is already this codebase's word for "deliberately nothing" — see
 * {@code VerificationStatuses.NONE}, {@code ContactStatuses.NONE}, {@code RecurringIntervals.NONE}
 * — and it can never collide with a real value, because no UUID spells it.
 *
 * <p>The match is exact and case-sensitive, like every other vocabulary on this board. Anything else
 * that is not a resolvable staff id is still a 404 exactly as before: the point of a sentinel is to
 * give one specific intent a spelling, not to make typos survivable.
 */
public record TicketUpdate(
        @Size(max = 16) String status,
        @Size(max = 16) String priority,
        @Size(max = 64) String assigneeId,
        @Size(max = 32) String team) {

    /**
     * The reserved {@code assigneeId} that clears the assignee instead of setting one.
     *
     * <p>Deliberately not a UUID — a nil UUID would read as an id in logs and in the ops UI, and the
     * first person to see {@code 00000000-0000-0000-0000-000000000000} in an audit row would go
     * looking for the user it belongs to.
     */
    public static final String UNASSIGN = "none";

    /** Whether this request asks for the ticket to be handed back to the pool. */
    public boolean unassigns() {
        return assigneeId != null && UNASSIGN.equals(assigneeId.trim());
    }
}
