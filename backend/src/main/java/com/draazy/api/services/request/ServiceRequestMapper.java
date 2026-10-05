package com.draazy.api.services.request;

import com.draazy.api.catalog.fee.LeaveAndLicenceCharges;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentDto;
import com.draazy.api.documents.vault.DocumentMapper;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class ServiceRequestMapper {

    private static final String MIGRATED_FROM_TYPE = "_migratedFromType";

    private static final String MIGRATED_DETAILS = "_migratedDetails";

    private final ServiceRequestEventRepository events;
    private final ServiceRequestMessageRepository messages;
    private final ServiceRequestPartyRepository parties;
    private final DocumentRepository documents;
    private final DocumentMapper documentMapper;
    private final UserRepository users;
    private final ServiceRequestRegistrationRepository registrations;
    private final ServiceRequestAmendmentRepository amendments;
    private final ServiceRequestPoliceIntimationRepository policeIntimations;
    private final ServiceRequestDraftApprovalRepository draftApprovals;
    private final ServiceRequestDraftCheckRepository draftChecks;
    private final ServiceRequestDraftApprovals approvalSummary;

    public ServiceRequestMapper(ServiceRequestEventRepository events,
            ServiceRequestMessageRepository messages,
            ServiceRequestPartyRepository parties,
            DocumentRepository documents,
            DocumentMapper documentMapper,
            UserRepository users,
            ServiceRequestRegistrationRepository registrations,
            ServiceRequestAmendmentRepository amendments,
            ServiceRequestPoliceIntimationRepository policeIntimations,
            ServiceRequestDraftApprovalRepository draftApprovals,
            ServiceRequestDraftCheckRepository draftChecks,
            ServiceRequestDraftApprovals approvalSummary) {
        this.events = events;
        this.messages = messages;
        this.parties = parties;
        this.documents = documents;
        this.documentMapper = documentMapper;
        this.users = users;
        this.registrations = registrations;
        this.amendments = amendments;
        this.policeIntimations = policeIntimations;
        this.draftApprovals = draftApprovals;
        this.draftChecks = draftChecks;
        this.approvalSummary = approvalSummary;
    }

    public ServiceRequestDto toDto(ServiceRequest request, AuthPrincipal viewer) {
        return toDtos(List.of(request), viewer).getFirst();
    }

    public List<ServiceRequestDto> toDtos(List<ServiceRequest> requests, AuthPrincipal viewer) {
        if (requests.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = requests.stream().map(ServiceRequest::getId).toList();

        Map<UUID, List<ServiceRequestEvent>> timelines =
                events.findByRequestIdInOrderByAtAsc(ids).stream().collect(Collectors.groupingBy(ServiceRequestEvent::getRequestId));
        Map<UUID, List<ServiceRequestMessage>> threads =
                messages.findByRequestIdInOrderByCreatedAtAsc(ids).stream().collect(Collectors.groupingBy(ServiceRequestMessage::getRequestId));
        Map<UUID, List<Document>> files =
                documents.findByServiceRequestIdInOrderByUploadedAtDesc(ids).stream().collect(Collectors.groupingBy(Document::getServiceRequestId));
        Map<UUID, List<ServiceRequestParty>> sides =
                parties.findByRequestIdIn(ids).stream().collect(Collectors.groupingBy(ServiceRequestParty::getRequestId));
        Map<UUID, ServiceRequestRegistration> registered =
                registrations.findByServiceRequestIdIn(ids).stream().collect(Collectors.toMap(ServiceRequestRegistration::getServiceRequestId, g -> g));
        Map<UUID, ServiceRequestAmendment> proposed =
                amendments.findByServiceRequestIdInAndStatus(ids, ServiceRequestAmendment.PROPOSED).stream().collect(Collectors.toMap(ServiceRequestAmendment::getServiceRequestId, a -> a));
        Map<UUID, ServiceRequestPoliceIntimation> police =
                policeIntimations.findByServiceRequestIdIn(ids).stream().collect(Collectors.toMap(ServiceRequestPoliceIntimation::getServiceRequestId, p -> p));
        Map<UUID, List<ServiceRequestDraftApproval>> approvals =
                draftApprovals.findByRequestIdIn(ids).stream().collect(Collectors.groupingBy(ServiceRequestDraftApproval::getRequestId));
        Map<UUID, List<ServiceRequestDraftCheck>> checks =
                draftChecks.findByRequestIdIn(ids).stream().collect(Collectors.groupingBy(ServiceRequestDraftCheck::getRequestId));
        Map<UUID, String> names = names(requests, threads.values(), sides.values(), registered.values(),
                police.values(), checks.values());
        Instant now = Instant.now();

        return requests.stream().map(r -> new ServiceRequestDto(
                        r.getId().toString(),
                        r.getType(),
                        r.getTeam(),
                        r.getStatus(),
                        r.getPropertyId() == null ? null : r.getPropertyId().toString(),
                        r.getTicketId() == null ? null : r.getTicketId().toString(),
                        visibleDetails(r.getDetails()),
                        names.get(r.getAssigneeId()),
                        Objects.equals(r.getAssigneeId(), viewer.userId()),
                        timelines.getOrDefault(r.getId(), List.of()).stream().map(e -> new ServiceRequestDto.TimelineEntry(
                                        e.getAt(), e.getEvent(), e.getBy())).toList(),
                        visibleFiles(r, files.getOrDefault(r.getId(), List.<Document>of()),
                                checks.getOrDefault(r.getId(), List.of()), viewer).stream().map(d -> toDocumentDto(d, r, sides.getOrDefault(r.getId(), List.of()), viewer)).toList(),
                        threads.getOrDefault(r.getId(), List.of()).stream().map(m -> toMessageDto(m, names)).toList(),
                        sides.getOrDefault(r.getId(), List.<ServiceRequestParty>of()).stream().map(p -> CoFillParties.toDto(p, r.getType(),
                                        names.get(p.getUserId()), names.get(p.getInvitedBy()))).toList(),
                        r.getCreatedAt(),
                        r.getAmount(),
                        null,
                        registration(registered.get(r.getId()), r, names),
                        policeIntimation(police.get(r.getId()), names),
                        RentAgreementSla.of(r, now),
                        amendment(proposed.get(r.getId())),
                        approvalSummary.summary(r, approvals.getOrDefault(r.getId(), List.of())),
                        draftCheck(r, checks.getOrDefault(r.getId(), List.of()), names))).toList();
    }

    private List<Document> visibleFiles(ServiceRequest request, List<Document> files,
            List<ServiceRequestDraftCheck> checks, AuthPrincipal viewer) {
        if (Roles.isBackOffice(viewer.role())) {
            return files;
        }
        int version = approvalSummary.currentVersion(request);
        boolean pending = checks.stream().anyMatch(c -> c.getDraftVersion() == version
                && ServiceRequestDraftCheck.PENDING.equals(c.getStatus()));
        return pending ? files.stream().filter(d -> !"draft".equals(d.getCategory())).toList() : files;
    }

    private static ServiceRequestDto.DraftCheck draftCheck(ServiceRequest request,
            List<ServiceRequestDraftCheck> checks, Map<UUID, String> names) {
        if (checks.isEmpty()) {
            return null;
        }
        ServiceRequestDraftCheck latest = checks.stream().max((a, b) -> Integer.compare(a.getDraftVersion(), b.getDraftVersion())).orElse(null);
        return latest == null ? null : new ServiceRequestDto.DraftCheck(latest.getDraftVersion(),
                latest.getStatus(), latest.reasonsList(), latest.getNote(), names.get(latest.getSharedBy()),
                names.get(latest.getCheckedBy()), latest.getCheckedAt());
    }

    private static PoliceIntimationDto policeIntimation(ServiceRequestPoliceIntimation p,
            Map<UUID, String> names) {
        return p == null ? PoliceIntimationDto.pending()
                : new PoliceIntimationDto(true, p.getConfirmedAt(), names.get(p.getConfirmedBy()),
                        p.getReference(), p.getSubmittedOn());
    }

    private static ServiceRequestDto.Amendment amendment(ServiceRequestAmendment a) {
        return a == null ? null : new ServiceRequestDto.Amendment(a.getId().toString(), a.getTerms(),
                a.getReason(), a.getAmountBefore(), a.getAmountAfter(), a.delta(), a.getPaymentRef() != null,
                a.getCreatedAt());
    }

    private static RegistrationDto registration(ServiceRequestRegistration g, ServiceRequest request,
            Map<UUID, String> names) {
        if (g == null) {
            return null;
        }
        LeaveAndLicenceCharges.Charges quoted = ServiceRequestPricing.quotedCharges(request.getDetails());
        return new RegistrationDto(g.getDocumentNo(), g.getSro(), g.getRegisteredOn(), g.getGrn(),
                g.getStampDuty(), g.getRegistrationFee(),
                quoted == null ? null : quoted.stampDuty(),
                quoted == null ? null : quoted.registration(),
                names.get(g.getRecordedBy()), g.getCreatedAt());
    }

    private DocumentDto toDocumentDto(Document d, ServiceRequest request,
            List<ServiceRequestParty> parties, AuthPrincipal viewer) {
        DocumentDto dto = documentMapper.toDto(d);
        String side = RentAgreementReadiness.identityScanSide(d.getCategory());
        if (side == null || readableSides(request, parties, viewer).contains(side)) {
            return dto;
        }
        return new DocumentDto(dto.id(), dto.propertyId(), dto.category(), null, null,
                null, null, dto.uploadedAt());
    }

    private static Set<String> readableSides(ServiceRequest request, List<ServiceRequestParty> parties,
            AuthPrincipal viewer) {
        boolean requester = viewer.userId().equals(request.getRequesterId());
        List<ServiceRequestParty> accepted = parties.stream().filter(p -> CoFillParties.ACCEPTED.equals(p.getStatus())).toList();
        boolean party = accepted.stream().anyMatch(p -> viewer.userId().equals(p.getUserId()));
        if (!requester && !party
                && Roles.isBackOffice(viewer.role())) {
            return CoFillParties.ROLES;
        }
        Set<String> readable = new HashSet<>();
        if (requester) {
            readable.addAll(CoFillParties.ROLES);
        }
        for (ServiceRequestParty p : accepted) {
            if (viewer.userId().equals(p.getUserId())) {
                readable.add(p.getRole());
            } else if (requester) {
                readable.remove(p.getRole());
            }
        }
        return readable;
    }

    // Hide migration audit fields from clients; the raw payload stays server-side.
    private static Map<String, Object> visibleDetails(Map<String, Object> details) {
        if (details == null
                || !(details.containsKey(MIGRATED_FROM_TYPE) || details.containsKey(MIGRATED_DETAILS))) {
            return details;
        }
        Map<String, Object> visible = new LinkedHashMap<>(details);
        visible.remove(MIGRATED_FROM_TYPE);
        visible.remove(MIGRATED_DETAILS);
        return visible;
    }

    public MessageDto toMessageDto(ServiceRequestMessage message) {
        return toMessageDto(message, names(List.of(), List.of(List.of(message)), List.of(), List.of(),
                List.of(), List.of()));
    }

    private MessageDto toMessageDto(ServiceRequestMessage m, Map<UUID, String> names) {
        return new MessageDto(
                m.getId().toString(),

                Objects.toString(m.getAuthorId(), null),
                names.get(m.getAuthorId()),
                m.getAuthorRole(),
                m.getBody(),
                m.getCreatedAt(),
                m.getReadAt());
    }

    // Use HashMap because callers read names.get(null); Map.of() rejects null keys.
    private Map<UUID, String> names(List<ServiceRequest> requests,
            Iterable<List<ServiceRequestMessage>> threads,
            Iterable<List<ServiceRequestParty>> sides,
            Iterable<ServiceRequestRegistration> registered,
            Iterable<ServiceRequestPoliceIntimation> police,
            Iterable<List<ServiceRequestDraftCheck>> checks) {
        Set<UUID> ids = new HashSet<>();
        requests.stream().map(ServiceRequest::getAssigneeId).filter(Objects::nonNull).forEach(ids::add);
        threads.forEach(thread -> thread.stream().map(ServiceRequestMessage::getAuthorId).filter(Objects::nonNull).forEach(ids::add));
        sides.forEach(side -> side.forEach(p -> {
            ids.add(p.getUserId());
            ids.add(p.getInvitedBy());
        }));
        registered.forEach(g -> ids.add(g.getRecordedBy()));
        police.forEach(p -> ids.add(p.getConfirmedBy()));
        checks.forEach(list -> list.forEach(c -> {
            ids.add(c.getSharedBy());
            ids.add(c.getCheckedBy());
        }));
        ids.removeIf(Objects::isNull);
        Map<UUID, String> names = new HashMap<>();
        if (ids.isEmpty()) {
            return names;
        }
        for (User u : users.findAllById(ids)) {
            names.put(u.getId(), u.getName());
        }
        return names;
    }
}
