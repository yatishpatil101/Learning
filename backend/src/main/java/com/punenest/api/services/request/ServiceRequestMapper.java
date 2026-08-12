package com.punenest.api.services.request;

import com.punenest.api.documents.vault.Document;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.documents.vault.DocumentMapper;
import com.punenest.api.documents.vault.DocumentRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
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

/**
 * Entity→wire projection for a service request, including its three child collections.
 *
 * <p><strong>Batch-loaded, never per row.</strong> The contract's {@code ServiceRequest} carries its
 * timeline, documents, messages and co-fill parties inline, and {@code GET /service-requests}
 * returns a page of them. Loading each request's children individually would make one staff page
 * ~100 queries — the classic N+1, arrived at honestly. Everything here therefore resolves for the
 * whole page at once: {@link #toDtos} issues five {@code IN} queries regardless of page size.
 *
 * <p>Display names are resolved the same way. A staff member's name lives in {@code identity}, not
 * on the request, because a rename must not have to rewrite history.
 */
@Component
public class ServiceRequestMapper {

    /** V42's audit trail for a row whose {@code type} it rewrote (D156). */
    private static final String MIGRATED_FROM_TYPE = "_migratedFromType";

    /** V42's defensive branch: the whole original payload, when {@code details} was not an object. */
    private static final String MIGRATED_DETAILS = "_migratedDetails";

    private final ServiceRequestEventRepository events;
    private final ServiceRequestMessageRepository messages;
    private final ServiceRequestPartyRepository parties;
    private final DocumentRepository documents;
    private final DocumentMapper documentMapper;
    private final UserRepository users;

    public ServiceRequestMapper(ServiceRequestEventRepository events,
            ServiceRequestMessageRepository messages,
            ServiceRequestPartyRepository parties,
            DocumentRepository documents,
            DocumentMapper documentMapper,
            UserRepository users) {
        this.events = events;
        this.messages = messages;
        this.parties = parties;
        this.documents = documents;
        this.documentMapper = documentMapper;
        this.users = users;
    }

    public ServiceRequestDto toDto(ServiceRequest request) {
        return toDtos(List.of(request)).getFirst();
    }

    public List<ServiceRequestDto> toDtos(List<ServiceRequest> requests) {
        if (requests.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = requests.stream().map(ServiceRequest::getId).toList();

        Map<UUID, List<ServiceRequestEvent>> timelines =
                events.findByRequestIdInOrderByAtAsc(ids).stream()
                        .collect(Collectors.groupingBy(ServiceRequestEvent::getRequestId));
        Map<UUID, List<ServiceRequestMessage>> threads =
                messages.findByRequestIdInOrderByCreatedAtAsc(ids).stream()
                        .collect(Collectors.groupingBy(ServiceRequestMessage::getRequestId));
        Map<UUID, List<Document>> files =
                documents.findByServiceRequestIdInOrderByUploadedAtDesc(ids).stream()
                        .collect(Collectors.groupingBy(Document::getServiceRequestId));
        Map<UUID, List<ServiceRequestParty>> sides =
                parties.findByRequestIdIn(ids).stream()
                        .collect(Collectors.groupingBy(ServiceRequestParty::getRequestId));
        Map<UUID, String> names = names(requests, threads.values(), sides.values());

        return requests.stream()
                .map(r -> new ServiceRequestDto(
                        r.getId().toString(),
                        r.getType(),
                        r.getTeam(),
                        r.getStatus(),
                        r.getPropertyId() == null ? null : r.getPropertyId().toString(),
                        r.getTicketId() == null ? null : r.getTicketId().toString(),
                        visibleDetails(r.getDetails()),
                        names.get(r.getAssigneeId()),
                        timelines.getOrDefault(r.getId(), List.of()).stream()
                                .map(e -> new ServiceRequestDto.TimelineEntry(
                                        e.getAt(), e.getEvent(), e.getBy()))
                                .toList(),
                        files.getOrDefault(r.getId(), List.<Document>of()).stream()
                                .map(documentMapper::toDto)
                                .toList(),
                        threads.getOrDefault(r.getId(), List.of()).stream()
                                .map(m -> toMessageDto(m, names))
                                .toList(),
                        sides.getOrDefault(r.getId(), List.<ServiceRequestParty>of()).stream()
                                .map(p -> CoFillParties.toDto(p, r.getType(),
                                        names.get(p.getUserId()), names.get(p.getInvitedBy())))
                                .toList(),
                        r.getCreatedAt(),
                        r.getAmount(),
                        null))
                .toList();
    }

    /**
     * {@code details} minus the migration markers V42 wrote into it.
     *
     * <p>D156 preserved each rewritten row's pre-migration {@code type} under
     * {@code _migratedFromType} — and, in the branch where {@code details} was not a JSON object,
     * the whole original payload under {@code _migratedDetails} — so the relabelling stayed
     * auditable. Both are ours. {@code details} is otherwise the customer's own form state, so
     * echoing our audit trail back inside it was wrong in principle (D162). The evidence is
     * untouched in the database; this only stops it being served.
     *
     * <p><strong>These two keys only, not every {@code _}-prefixed key.</strong> The obvious
     * generalisation would also take {@code details._state} — the rent-agreement wizard's full form
     * snapshot, and the richest description of the agreement anyone downstream has. This one mapper
     * serves the customer read and the staff read alike, so a blanket strip would take it off the
     * desk that drafts from it. Naming the keys keeps the fix to the marker that is actually ours.
     *
     * <p>Returns the entity's own map untouched when there is nothing to strip: this runs per row of
     * every page, and the copy is only worth making for the rows V42 actually rewrote. The copy
     * matters where it is made — mutating {@code details} in place would dirty a managed entity and
     * write the strip back to the database on flush, destroying the audit trail this is protecting.
     */
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

    /** Projection for {@code POST /service-requests/{id}/messages}, which returns the one message. */
    public MessageDto toMessageDto(ServiceRequestMessage message) {
        return toMessageDto(message, names(List.of(), List.of(List.of(message)), List.of()));
    }

    private MessageDto toMessageDto(ServiceRequestMessage m, Map<UUID, String> names) {
        return new MessageDto(
                m.getId().toString(),
                m.getAuthorId().toString(),
                names.get(m.getAuthorId()),
                m.getAuthorRole(),
                m.getBody(),
                m.getCreatedAt(),
                m.getReadAt());
    }

    /**
     * Resolve every user id this page will display, in one query.
     *
     * <p>A {@link HashMap} rather than {@link Map#of}, deliberately: the unassigned case above
     * calls {@code names.get(null)}, and {@code Map.of()} throws on a null key instead of missing.
     */
    private Map<UUID, String> names(List<ServiceRequest> requests,
            Iterable<List<ServiceRequestMessage>> threads,
            Iterable<List<ServiceRequestParty>> sides) {
        Set<UUID> ids = new HashSet<>();
        requests.stream().map(ServiceRequest::getAssigneeId).filter(Objects::nonNull).forEach(ids::add);
        threads.forEach(thread -> thread.stream()
                .map(ServiceRequestMessage::getAuthorId)
                .filter(Objects::nonNull)
                .forEach(ids::add));
        sides.forEach(side -> side.forEach(p -> {
            ids.add(p.getUserId());
            ids.add(p.getInvitedBy());
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
