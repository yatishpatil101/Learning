package com.punenest.api.services.request;

import com.punenest.api.documents.vault.Document;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.documents.vault.DocumentMapper;
import com.punenest.api.documents.vault.DocumentRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.HashMap;
import java.util.HashSet;
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
 * timeline, documents and messages inline, and {@code GET /service-requests} returns a page of them.
 * Loading each request's children individually would make one staff page ~80 queries — the classic
 * N+1, arrived at honestly. Everything here therefore resolves for the whole page at once:
 * {@link #toDtos} issues four {@code IN} queries regardless of page size.
 *
 * <p>Display names are resolved the same way. A staff member's name lives in {@code identity}, not
 * on the request, because a rename must not have to rewrite history.
 */
@Component
public class ServiceRequestMapper {

    private final ServiceRequestEventRepository events;
    private final ServiceRequestMessageRepository messages;
    private final DocumentRepository documents;
    private final DocumentMapper documentMapper;
    private final UserRepository users;

    public ServiceRequestMapper(ServiceRequestEventRepository events,
            ServiceRequestMessageRepository messages,
            DocumentRepository documents,
            DocumentMapper documentMapper,
            UserRepository users) {
        this.events = events;
        this.messages = messages;
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
        Map<UUID, String> names = names(requests, threads.values());

        return requests.stream()
                .map(r -> new ServiceRequestDto(
                        r.getId().toString(),
                        r.getType(),
                        r.getStatus(),
                        r.getPropertyId() == null ? null : r.getPropertyId().toString(),
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
                        r.getCreatedAt()))
                .toList();
    }

    /** Projection for {@code POST /service-requests/{id}/messages}, which returns the one message. */
    public MessageDto toMessageDto(ServiceRequestMessage message) {
        return toMessageDto(message, names(List.of(), List.of(List.of(message))));
    }

    private MessageDto toMessageDto(ServiceRequestMessage m, Map<UUID, String> names) {
        return new MessageDto(
                m.getId().toString(),
                names.get(m.getAuthorId()),
                m.getAuthorRole(),
                m.getBody(),
                m.getCreatedAt());
    }

    /**
     * Resolve every user id this page will display, in one query.
     *
     * <p>A {@link HashMap} rather than {@link Map#of}, deliberately: the unassigned case above
     * calls {@code names.get(null)}, and {@code Map.of()} throws on a null key instead of missing.
     */
    private Map<UUID, String> names(List<ServiceRequest> requests,
            Iterable<List<ServiceRequestMessage>> threads) {
        Set<UUID> ids = new HashSet<>();
        requests.stream().map(ServiceRequest::getAssigneeId).filter(Objects::nonNull).forEach(ids::add);
        threads.forEach(thread -> thread.stream()
                .map(ServiceRequestMessage::getAuthorId)
                .filter(Objects::nonNull)
                .forEach(ids::add));
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
