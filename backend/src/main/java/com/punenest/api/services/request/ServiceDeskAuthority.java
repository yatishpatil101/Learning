package com.punenest.api.services.request;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import com.punenest.api.security.Teams;

/**
 * Which ops desk a caller may act for, and which requests that lets them touch (D44).
 *
 * <p>Extracted from {@link ServiceRequestService} rather than left beside the flows that use it,
 * because it is the whole of one rule and none of any other: every method here is a total function
 * of the caller and the thing being reached for, with no repository, no clock and no transaction.
 * That makes the rule readable in one screen and testable without a request ever being created —
 * which is the point, since the failure mode it guards against is silent over-permission rather
 * than a thrown exception somebody would notice.
 *
 * <p><strong>The rule, in one line: an absent desk is a refusal, never a wildcard.</strong> Both
 * methods below could have been written to let a deskless staff account through, and both would
 * then have granted that account strictly more than a desked colleague — every desk's work instead
 * of one desk's. That inversion is the mistake a team filter makes by accident, so it is spelled
 * out twice here and pinned by {@code PermissionMapGuardTest.teamlessStaffKeepTheRoleBaseline}.
 *
 * <p>Stateless and side-effect free; the methods are static for that reason.
 */
final class ServiceDeskAuthority {

    private ServiceDeskAuthority() {
    }

    /**
     * The desk an ops caller's queue is narrowed to — their own, or an admin's chosen one, or
     * {@code null} for an admin asking for everything.
     *
     * <p>The deskless staff case throws here rather than passing {@code null} through, because
     * {@code null} means "every desk" to the query. Turning "we do not know which desk you are on"
     * into "all of them" is the single mistake a team filter gets wrong by accident.
     *
     * @throws BadRequestException if a team is named that is not in the closed vocabulary
     * @throws ForbiddenException  if the caller has no desk, or names one that is not theirs
     */
    static String deskFilterFor(AuthPrincipal caller, String requestedTeam) {
        String requested = blankToNull(requestedTeam);
        if (requested != null && !Teams.isKnown(requested)) {
            throw new BadRequestException("Unknown team: " + requested);
        }
        if (Roles.Wire.ADMIN.equals(caller.role())) {
            return requested;
        }
        if (caller.team() == null) {
            throw new ForbiddenException(
                    "Your account is not on an ops desk yet, so there is no queue to show.");
        }
        if (requested != null && !requested.equals(caller.team())) {
            throw new ForbiddenException("You can only see the " + caller.team() + " queue.");
        }
        return caller.team();
    }

    /**
     * The same request, once the ops caller's desk has been checked against it.
     *
     * <p><strong>403, not 404 — the opposite of the customer-facing rule.</strong> Deliberately the
     * same choice {@code TicketService.accessible} makes, and for the same reason: existence is the
     * secret when the reader might be a stranger, but every caller here has already passed a staff
     * or admin guard, so hiding the rental desk's rent agreement from the legal desk protects
     * nothing and would send an operator hunting for a request they can see referenced in an email.
     * "That belongs to the rental desk" is the useful answer.
     *
     * <p>An admin passes. A staff member with no desk is refused everything rather than granted
     * everything — the same fail-closed reading as the queue.
     *
     * @throws ForbiddenException if the caller has no desk, or the request is on another one
     */
    static ServiceRequest onCallersDesk(AuthPrincipal caller, ServiceRequest request) {
        if (Roles.Wire.ADMIN.equals(caller.role())) {
            return request;
        }
        if (caller.team() == null) {
            throw new ForbiddenException("Your account is not on an ops desk yet.");
        }
        if (!caller.team().equals(request.getTeam())) {
            throw new ForbiddenException(
                    "That request belongs to the " + request.getTeam() + " desk.");
        }
        return request;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
