package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ServiceRequestIdentityService {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestIdentityService.class);

    private static final Set<String> ALL_ROLES = Set.of("owner", "tenant", "witness");

    static final String PURGED = "identities.purged";
    static final String RERECORDED = "identities.recorded";
    private static final Set<String> IDENTITY_EVENTS = Set.of(PURGED, RERECORDED);

    private final ServiceRequestIdentityRepository identities;
    private final ServiceRequestRepository requests;
    private final ServiceRequestPartyRepository parties;
    private final ServiceRequestEventRepository events;
    private final AuditService audit;
    private final AccountPermissions accountPermissions;

    public ServiceRequestIdentityService(ServiceRequestIdentityRepository identities,
            ServiceRequestRepository requests, ServiceRequestPartyRepository parties,
            ServiceRequestEventRepository events, AuditService audit,
            AccountPermissions accountPermissions) {
        this.identities = identities;
        this.requests = requests;
        this.parties = parties;
        this.events = events;
        this.audit = audit;
        this.accountPermissions = accountPermissions;
    }

    // Replace rows first so corrected parties do not leave old numbers behind.
    @Transactional
    public void replace(AuthPrincipal caller, String id, ServiceRequestIdentitiesRequest body) {
        ServiceRequest request = Ids.parseUuid(id).flatMap(requests::findByIdForUpdate).orElseThrow(() -> NotFoundException.of("Service request"));
        if (request.getStatus().isTerminal()) {
            throw new ConflictException("This request is " + request.getStatus()
                    + " — identity numbers cannot be recorded against it.");
        }
        boolean afterPurge = latestIdentityEventIsPurge(request.getId());
        Set<Slot> replaceSlots = slotsToReplace(caller, request, body.parties());
        validateDistinctNumbers(body.parties());

        deleteSlots(request.getId(), replaceSlots);
        identities.flush();
        identities.saveAll(body.parties().stream().map(party -> new ServiceRequestIdentity(request.getId(), party.partyRole(),
                        party.partyIndex(), party.normalisedName(), party.normalisedPan(),
                        party.normalisedAadhaar())).toList());
        identities.flush();
        validateDistinctNumbers(identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(
                request.getId()));

        if (afterPurge && caller.userId().equals(request.getRequesterId())) {
            events.save(new ServiceRequestEvent(request.getId(), RERECORDED, null));
        }
        // Audit counts only; storing numbers in audit_log would create a second secret store.
        audit.record(caller, "service-request.identities-recorded", "service_request",
                request.getId().toString(), "parties", body.parties().size());
    }

    private boolean latestIdentityEventIsPurge(UUID requestId) {
        return events.findFirstByRequestIdAndEventInOrderByAtDesc(requestId, IDENTITY_EVENTS).map(e -> PURGED.equals(e.getEvent())).orElse(false);
    }

    // Only the assigned worker may read numbers; admins must assign themselves first.
    @Transactional(readOnly = true)
    public List<ServiceRequestIdentityDto> forAssignee(AuthPrincipal caller, String id) {
        ServiceRequest request = ServiceDeskAuthority.onCallersDesk(caller,
                Ids.parseUuid(id).flatMap(requests::findById)
                        .orElseThrow(() -> NotFoundException.of("Service request")),
                accountPermissions.desksFor(caller));
        UUID assignee = request.getAssigneeId();
        if (assignee == null || !assignee.equals(caller.userId())) {

            // Audit before refusal; REQUIRES_NEW preserves the attempted cross-matter read.
            audit.record(caller, "service-request.identities-refused", "service_request",
                    request.getId().toString(),
                    "assignee", assignee == null ? null : assignee.toString());
            log.warn("Identity read refused on service request {} for {}: assigned to {}",
                    request.getId(), caller.userId(), assignee);
            throw new ForbiddenException(assignee == null
                    ? "This request is not assigned to anyone yet. Take it first — identity numbers "
                            + "are visible only to the person working the matter."
                    : "This request is assigned to somebody else. Identity numbers are visible only "
                            + "to the person working the matter.");
        }

        List<ServiceRequestIdentity> rows =
                identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(request.getId());
        audit.record(caller, "service-request.identities-viewed", "service_request",
                request.getId().toString(), "parties", rows.size());
        return rows.stream().map(ServiceRequestIdentityDto::of).toList();
    }

    // Blank the numbers held against a request that has finished, and say so on the timeline.
    @Transactional
    public int purgeFor(UUID serviceRequestId) {
        List<ServiceRequestIdentity> rows =
                identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(serviceRequestId);
        int purged = 0;
        for (ServiceRequestIdentity row : rows) {
            if (row.purge()) {
                purged++;
            }
        }
        if (purged > 0) {
            log.info("Discarded identity numbers for {} parties on service request {}", purged,
                    serviceRequestId);
        }
        return purged;
    }

    // Requesters write all roles; accepted co-fill parties write only their side.
    // Staff cannot invent identity numbers; strangers get 404.
    private Set<String> writableRoles(AuthPrincipal caller, ServiceRequest request) {
        if (caller.userId().equals(request.getRequesterId())) {
            return ALL_ROLES;
        }
        Set<String> own = acceptedRoles(request.getId(), caller.userId());
        if (!own.isEmpty()) {
            if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT
                    || request.getPaymentRef() != null) {
                throw new ConflictException("Checkout is already open for this request. Ask the"
                        + " requester to correct your identity numbers if they are wrong.");
            }
            return own;
        }
        if (Roles.isBackOffice(caller.role())) {
            throw new ForbiddenException(
                    "Only the parties to this agreement can record their identity numbers.");
        }
        throw NotFoundException.of("Service request");
    }

    Set<String> acceptedRoles(UUID requestId, UUID userId) {
        return parties.findByRequestId(requestId).stream().filter(p -> userId.equals(p.getUserId()) && CoFillParties.ACCEPTED.equals(p.getStatus())).map(ServiceRequestParty::getRole).collect(Collectors.toSet());
    }

    private Set<String> rolesToReplace(AuthPrincipal caller, ServiceRequest request, Set<String> bodyRoles) {
        if (!caller.userId().equals(request.getRequesterId())) {
            return bodyRoles;
        }
        Set<String> coFillRoles = acceptedCoFillRoles(request.getId());
        if (bodyRoles.stream().anyMatch(coFillRoles::contains)) {
            throw new ConflictException("the invited party records their own identity numbers");
        }
        return ALL_ROLES.stream().filter(role -> !coFillRoles.contains(role)).collect(Collectors.toSet());
    }

    Set<String> acceptedCoFillRoles(UUID requestId) {
        return parties.findByRequestId(requestId).stream().filter(p -> CoFillParties.ACCEPTED.equals(p.getStatus())).map(ServiceRequestParty::getRole).collect(Collectors.toSet());
    }

    private Set<Slot> acceptedSlots(UUID requestId, UUID userId) {
        return parties.findByRequestId(requestId).stream().filter(p -> userId.equals(p.getUserId()) && CoFillParties.ACCEPTED.equals(p.getStatus())).map(p -> new Slot(p.getRole(), p.getPartyIndex())).collect(Collectors.toSet());
    }

    private Set<Slot> acceptedCoFillSlots(UUID requestId) {
        return parties.findByRequestId(requestId).stream().filter(p -> CoFillParties.ACCEPTED.equals(p.getStatus())).map(p -> new Slot(p.getRole(), p.getPartyIndex())).collect(Collectors.toSet());
    }

    Set<String> liveCoFillRoles(UUID requestId) {
        return parties.findByRequestId(requestId).stream().filter(p -> !CoFillParties.DECLINED.equals(p.getStatus())).map(ServiceRequestParty::getRole).collect(Collectors.toSet());
    }

    boolean hasAcceptedSlot(UUID requestId, UUID userId, String role, int index) {
        return parties.findByRequestId(requestId).stream().anyMatch(p -> userId.equals(p.getUserId())
                        && CoFillParties.ACCEPTED.equals(p.getStatus())
                        && role.equals(p.getRole())
                        && index == p.getPartyIndex());
    }

    boolean hasLiveCoFillSlot(UUID requestId, String role, int index) {
        return parties.findByRequestId(requestId).stream().anyMatch(p -> !CoFillParties.DECLINED.equals(p.getStatus())
                        && role.equals(p.getRole())
                        && index == p.getPartyIndex());
    }

    private Set<Slot> slotsToReplace(AuthPrincipal caller, ServiceRequest request,
            List<ServiceRequestIdentitiesRequest.Party> body) {
        Set<Slot> bodySlots = slots(body);
        if (!caller.userId().equals(request.getRequesterId())) {
            Set<Slot> own = acceptedSlots(request.getId(), caller.userId());
            if (own.isEmpty()) {
                if (Roles.isBackOffice(caller.role())) {
                    throw new ForbiddenException(
                            "Only the parties to this agreement can record their identity numbers.");
                }
                throw NotFoundException.of("Service request");
            }
            if (!own.containsAll(bodySlots)) {
                throw new ForbiddenException(
                        "You can record identity numbers only for your own side of this agreement.");
            }
            if ((request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT || request.getPaymentRef() != null)
                    && !purgedSlots(request.getId()).containsAll(bodySlots)) {
                throw new ConflictException("Checkout is already open for this request. Ask the"
                        + " requester to correct your identity numbers if they are wrong.");
            }
            return bodySlots;
        }
        Set<Slot> coFillSlots = acceptedCoFillSlots(request.getId());
        if (bodySlots.stream().anyMatch(coFillSlots::contains)) {
            throw new ConflictException("the invited party records their own identity numbers");
        }
        return identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(request.getId()).stream().map(row -> new Slot(row.getPartyRole(), row.getPartyIndex())).filter(slot -> !coFillSlots.contains(slot)).collect(Collectors.toSet());
    }

    private Set<Slot> purgedSlots(UUID requestId) {
        return identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(requestId).stream().filter(row -> row.getPurgedAt() != null).map(row -> new Slot(row.getPartyRole(), row.getPartyIndex())).collect(Collectors.toSet());
    }

    private void deleteSlots(UUID requestId, Set<Slot> slots) {
        slots.stream().collect(Collectors.groupingBy(Slot::role,
                        Collectors.mapping(Slot::index, Collectors.toSet()))).forEach((role, indexes) ->
                        identities.deleteByServiceRequestIdAndPartyRoleAndPartyIndexIn(
                                requestId, role, indexes));
    }

    private static Set<Slot> slots(List<ServiceRequestIdentitiesRequest.Party> parties) {
        return parties.stream().map(p -> new Slot(p.partyRole(), p.partyIndex())).collect(Collectors.toSet());
    }

    private record Slot(String role, int index) {
    }

    private static void validateDistinctNumbers(Collection<?> rows) {
        Set<String> aadhaars = new HashSet<>();
        Set<String> pans = new HashSet<>();
        for (Object row : rows) {
            String aadhaar = null;
            String pan = null;
            if (row instanceof ServiceRequestIdentitiesRequest.Party party) {
                aadhaar = party.normalisedAadhaar();
                pan = party.normalisedPan();
            } else if (row instanceof ServiceRequestIdentity identity) {
                aadhaar = blankToNull(identity.getAadhaar());
                pan = blankToNull(identity.getPan());
            }
            if (aadhaar != null && !aadhaars.add(aadhaar)) {
                throw new ValidationException("the same Aadhaar number is recorded for two parties");
            }
            if (pan != null && !pans.add(pan.toUpperCase(java.util.Locale.ROOT))) {
                throw new ValidationException("the same PAN is recorded for two parties");
            }
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
