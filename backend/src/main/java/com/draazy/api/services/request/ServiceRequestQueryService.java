package com.draazy.api.services.request;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The read side of the service-request workflow: one route, two audiences, and the scoping that
 * tells them apart.
 *
 * <p>Split out of {@link ServiceRequestService} when D44's desk scoping and D45's ticket filter
 * landed on it. The write side is a state machine — open a request, take payment, move it through
 * statuses — and shares almost nothing with this beyond the table: no transaction of its own, no
 * gateway, no documents, no audit. Keeping the queue here means the question "who is allowed to see
 * which rows" is answered in one short file instead of a third of the way down a long one, and it
 * can be changed without reading anything about payments.
 *
 * <p>A sibling of {@link ServiceRequestIdentityService}, and wired the same way.
 */
@Service
public class ServiceRequestQueryService {

    private final ServiceRequestRepository requests;
    private final ServiceRequestMapper mapper;

    public ServiceRequestQueryService(ServiceRequestRepository requests,
            ServiceRequestMapper mapper) {
        this.requests = requests;
        this.mapper = mapper;
    }

    /**
     * Contract {@code listServiceRequests} (spec fix S40) — own for a customer, the desk's queue for
     * ops.
     *
     * <p>The scope is derived from the principal's role, never from a parameter. There is no
     * {@code ?requesterId=} for the same reason there is no nullable scope on the repository: a
     * filter a client can set is a filter a client can remove.
     *
     * <p><strong>Team scoping, and why it fails closed</strong> (D44). Deliberately the same rules
     * as {@code TicketService.list}, because two ops queues with two different ideas of "my desk"
     * would be worse than one unscoped queue. The rule itself lives in {@link ServiceDeskAuthority}.
     *
     * @param team     ignored for a staff caller unless it names their own desk; an admin's filter is
     *                 the only one that reaches the query
     * @param ticketId the board-to-workflow direction of the D45 link — "show me the request behind
     *                 this ticket", so an operator does not have to match one to the other by hand
     */
    @Transactional(readOnly = true)
    public Page<ServiceRequestDto> list(AuthPrincipal caller, String type, String status, String team,
            String ticketId, Pageable pageable) {
        String typeFilter = blankToNull(type);
        String statusValue = blankToNull(status);
        ServiceRequestStatus statusFilter = statusValue == null ? null
                : ServiceRequestStatus.parse(statusValue).orElseThrow(() ->
                        new BadRequestException("Unknown service request status: " + statusValue));
        String ticketFilter = blankToNull(ticketId);
        // A malformed id is a 400 rather than an empty page: "no request for this ticket" and "that
        // is not an id" are different answers, and the second one is the caller's mistake.
        UUID ticket = ticketFilter == null ? null : Ids.parseUuid(ticketFilter)
                .orElseThrow(() -> new BadRequestException("ticketId must be a valid id"));

        Page<ServiceRequest> page = isOps(caller)
                ? requests.findForQueue(ServiceDeskAuthority.deskFilterFor(caller, team),
                        typeFilter, statusFilter, ticket, pageable)
                : requests.findForRequester(caller.userId(), typeFilter, statusFilter, ticket,
                        pageable);
        // One mapper call for the whole page — see ServiceRequestMapper on why this is not a .map().
        List<ServiceRequestDto> content = mapper.toDtos(page.getContent());
        return new PageImpl<>(content, page.getPageable(), page.getTotalElements());
    }

    private static boolean isOps(AuthPrincipal caller) {
        return Roles.Wire.STAFF.equals(caller.role()) || Roles.Wire.ADMIN.equals(caller.role());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
