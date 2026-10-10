package com.draazy.api.services.request;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import com.draazy.api.services.ticket.TicketService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ServiceRequestQueryService {

    private final ServiceRequestRepository requests;
    private final ServiceRequestMapper mapper;
    private final AccountPermissions accountPermissions;
    private final TicketService tickets;
    private final ServiceRequestQueueRows rows;

    private static final Set<ServiceRequestStatus> MINE_STATUSES = EnumSet.of(
            ServiceRequestStatus.ASSIGNED,
            ServiceRequestStatus.IN_PROGRESS,
            ServiceRequestStatus.DRAFT_SHARED,
            ServiceRequestStatus.CHANGES_REQUESTED,
            ServiceRequestStatus.APPROVED);

    private static final Set<ServiceRequestStatus> IN_PROGRESS_STATUSES = EnumSet.of(
            ServiceRequestStatus.ASSIGNED,
            ServiceRequestStatus.IN_PROGRESS,
            ServiceRequestStatus.CHANGES_REQUESTED,
            ServiceRequestStatus.APPROVED);

    public ServiceRequestQueryService(ServiceRequestRepository requests,
            ServiceRequestMapper mapper, AccountPermissions accountPermissions, TicketService tickets,
            ServiceRequestQueueRows rows) {
        this.requests = requests;
        this.mapper = mapper;
        this.accountPermissions = accountPermissions;
        this.tickets = tickets;
        this.rows = rows;
    }

    // Scope comes only from principal role; clients cannot set or remove requester scope.
    @Transactional(readOnly = true)
    public Page<ServiceRequestDto> list(AuthPrincipal caller, String type, String status, String team,
            String ticketId, boolean unassigned, boolean overdue, boolean mine, String q, Pageable pageable) {
        String typeFilter = blankToNull(type);
        String statusValue = blankToNull(status);
        String ticketFilter = blankToNull(ticketId);

        UUID ticket = ticketFilter == null ? null : Ids.parseUuid(ticketFilter).orElseThrow(() -> new BadRequestException("ticketId must be a valid id"));
        String term = blankToNull(q);

        UUID requestId = term == null ? null : Ids.parseUuid(term).orElse(null);
        String prefix = term == null ? null : anchoredPrefix(term);

        Page<ServiceRequest> page = isOps(caller)
                ? queuePage(caller, team, typeFilter, statusValue, ticket, unassigned, overdue, mine, prefix,
                        requestId, pageable)
                : requests.findForRequester(caller.userId(), typeFilter, singleStatus(statusValue), ticket,
                        pageable);

        List<ServiceRequestDto> content = mapper.toDtos(page.getContent(), caller);
        return new PageImpl<>(content, page.getPageable(), page.getTotalElements());
    }

    // The desk's rows: the same scope and filters as `list`, projected to what a row draws.
    @Transactional(readOnly = true)
    public Page<ServiceRequestQueueRow> queue(AuthPrincipal caller, String type, String status, String team,
            String ticketId, boolean unassigned, boolean overdue, boolean mine, String q, Pageable pageable) {
        String ticketFilter = blankToNull(ticketId);
        UUID ticket = ticketFilter == null ? null : Ids.parseUuid(ticketFilter).orElseThrow(() -> new BadRequestException("ticketId must be a valid id"));
        String term = blankToNull(q);
        UUID requestId = term == null ? null : Ids.parseUuid(term).orElse(null);
        String prefix = term == null ? null : anchoredPrefix(term);

        Page<ServiceRequest> page = queuePage(caller, team, blankToNull(type), blankToNull(status), ticket,
                unassigned, overdue, mine, prefix, requestId, pageable);
        return new PageImpl<>(rows.of(page.getContent(), caller), page.getPageable(), page.getTotalElements());
    }

    private Page<ServiceRequest> queuePage(AuthPrincipal caller, String team, String typeFilter,
            String statusValue, UUID ticket, boolean unassigned, boolean overdue, boolean mine, String prefix,
            UUID requestId, Pageable pageable) {
        Instant now = Instant.now();
        return findForQueue(caller, team, typeFilter, statusFilters(statusValue), ticket, unassigned, overdue, mine,
                now.minus(RentAgreementSla.PICKUP), now.minus(RentAgreementSla.FIRST_DRAFT),
                now.minus(RentAgreementSla.REVISION), now.minus(RentAgreementSla.REGISTRATION),
                prefix, requestId, pageable);
    }

    @Transactional(readOnly = true)
    public ServiceQueueSummary queueSummary(AuthPrincipal caller, String team) {
        QueueScope scope = queueScope(caller, team);
        Instant now = Instant.now();
        Map<ServiceRequestStatus, Long> byStatus = new EnumMap<>(ServiceRequestStatus.class);
        for (ServiceRequestRepository.StatusTotal total : requests.countQueueByStatus(scope.allTeams(), scope.teams())) {
            byStatus.put(total.getStatus(), total.getTotal());
        }
        long mine = requests.countMineForQueue(scope.allTeams(), scope.teams(), caller.userId(),
                List.copyOf(MINE_STATUSES));
        long overdue = requests.countOverdueForQueue(scope.allTeams(), scope.teams(),
                now.minus(RentAgreementSla.PICKUP), now.minus(RentAgreementSla.FIRST_DRAFT),
                now.minus(RentAgreementSla.REVISION), now.minus(RentAgreementSla.REGISTRATION));
        return new ServiceQueueSummary(
                count(byStatus, ServiceRequestStatus.NEW),
                mine,
                sum(byStatus, IN_PROGRESS_STATUSES),
                count(byStatus, ServiceRequestStatus.DRAFT_SHARED),
                count(byStatus, ServiceRequestStatus.COMPLETED)
                        + count(byStatus, ServiceRequestStatus.CANCELLED),
                overdue,
                accountPermissions.granted(caller, BackOfficePermissions.TICKETS_READ)
                        ? tickets.countOpen(caller, team) : null);
    }

    private Page<ServiceRequest> findForQueue(AuthPrincipal caller, String team, String typeFilter,
            List<ServiceRequestStatus> statusFilters, UUID ticket, boolean unassigned, boolean overdue, boolean mine,
            Instant pickupBy, Instant draftBy, Instant revisionBy, Instant registrationBy,
            String prefix, UUID requestId, Pageable pageable) {
        QueueScope scope = queueScope(caller, team);
        boolean anyStatus = statusFilters.isEmpty();
        return requests.findForQueue(scope.allTeams(), scope.teams(), typeFilter, anyStatus,
                anyStatus ? List.copyOf(EnumSet.allOf(ServiceRequestStatus.class)) : statusFilters, ticket,
                unassigned, mine, caller.userId(), overdue, pickupBy, draftBy, revisionBy,
                registrationBy, prefix, requestId, pageable);
    }

    private QueueScope queueScope(AuthPrincipal caller, String team) {
        String checkedTeam = ServiceDeskAuthority.deskFilterFor(caller, team,
                accountPermissions.desksFor(caller));
        boolean allTeams = checkedTeam == null
                && (Roles.Wire.ADMIN.equals(caller.role()) || Roles.Wire.MANAGER.equals(caller.role()));
        List<String> teams = checkedTeam == null
                ? new ArrayList<>(accountPermissions.desksFor(caller))
                : List.of(checkedTeam);
        return new QueueScope(allTeams, teams.isEmpty() ? List.of("__none__") : teams);
    }

    private static List<ServiceRequestStatus> statusFilters(String statusValue) {
        if (statusValue == null) {
            return List.of();
        }
        return java.util.Arrays.stream(statusValue.split(",", -1))
                .map(String::trim)
                .map(ServiceRequestQueryService::parseStatus)
                .toList();
    }

    private static ServiceRequestStatus singleStatus(String statusValue) {
        return statusValue == null ? null : parseStatus(statusValue);
    }

    private static ServiceRequestStatus parseStatus(String status) {
        return ServiceRequestStatus.parse(status).orElseThrow(() ->
                new BadRequestException("Unknown service request status: " + status));
    }

    private static long count(Map<ServiceRequestStatus, Long> counts, ServiceRequestStatus status) {
        return counts.getOrDefault(status, 0L);
    }

    private static long sum(Map<ServiceRequestStatus, Long> counts, Set<ServiceRequestStatus> statuses) {
        return statuses.stream().mapToLong(status -> count(counts, status)).sum();
    }

    private record QueueScope(boolean allTeams, List<String> teams) {
    }

    // An unescaped % would slip the caller's own wildcard past the anchor and scan every user.
    private static String anchoredPrefix(String term) {
        return term.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static boolean isOps(AuthPrincipal caller) {
        return Roles.isBackOffice(caller.role());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
