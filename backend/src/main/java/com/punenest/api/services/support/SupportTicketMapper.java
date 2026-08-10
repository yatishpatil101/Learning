package com.punenest.api.services.support;

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
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for support tickets.
 *
 * <p>Batch-loaded, as {@code TicketMapper} and {@code ServiceRequestMapper} are: the contract carries
 * the thread inline, so a per-ticket load would be an N+1 across the caller's whole list.
 * {@link #toDtos} issues two queries whatever the list size.
 */
@Component
public class SupportTicketMapper {

    private final SupportTicketMessageRepository messages;
    private final UserRepository users;

    public SupportTicketMapper(SupportTicketMessageRepository messages, UserRepository users) {
        this.messages = messages;
        this.users = users;
    }

    public SupportTicketDto toDto(SupportTicket ticket) {
        return toDtos(List.of(ticket)).getFirst();
    }

    public List<SupportTicketDto> toDtos(List<SupportTicket> tickets) {
        if (tickets.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = tickets.stream().map(SupportTicket::getId).toList();
        List<SupportTicketMessage> all = messages.findByTicketIdInOrderByCreatedAtAsc(ids);
        Map<UUID, List<SupportTicketMessage>> byTicket = all.stream()
                .collect(Collectors.groupingBy(SupportTicketMessage::getTicketId));

        Set<UUID> authorIds = all.stream()
                .map(SupportTicketMessage::getAuthorId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));
        Map<UUID, String> names = new HashMap<>();
        if (!authorIds.isEmpty()) {
            for (User u : users.findAllById(authorIds)) {
                names.put(u.getId(), u.getName());
            }
        }

        return tickets.stream()
                .map(t -> new SupportTicketDto(
                        t.getId().toString(),
                        t.getSubject(),
                        t.getCategory(),
                        t.getStatus(),
                        t.isUnread(),
                        byTicket.getOrDefault(t.getId(), List.of()).stream()
                                .map(m -> new MessageDto(
                                        m.getId().toString(),
                                        m.getAuthorId().toString(),
                                        names.get(m.getAuthorId()),
                                        m.getAuthorRole(),
                                        m.getBody(),
                                        m.getCreatedAt()))
                                .toList(),
                        t.getCreatedAt()))
                .toList();
    }

    /**
     * The ops queue projection (D51) — one page of {@link AdminSupportTicketDto}, threads omitted.
     *
     * <p>Names are resolved for the whole page before {@link org.springframework.data.domain.Page#map}
     * walks it. Mapping element by element and looking each raiser up inside the lambda would be an
     * N+1 that only shows itself under load, which is the failure mode this class was already
     * written to avoid on the customer's list.
     */
    public Page<AdminSupportTicketDto> toAdminPage(Page<SupportTicket> page) {
        Map<UUID, String> names = raiserNames(page.getContent());
        return page.map(t -> new AdminSupportTicketDto(
                t.getId().toString(),
                t.getSubject(),
                t.getCategory(),
                t.getStatus(),
                names.get(t.getUserId()),
                t.isStaffUnread(),
                t.isUnread(),
                t.getCreatedAt()));
    }

    private Map<UUID, String> raiserNames(List<SupportTicket> tickets) {
        Set<UUID> ids = tickets.stream()
                .map(SupportTicket::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));
        Map<UUID, String> names = new HashMap<>();
        if (!ids.isEmpty()) {
            for (User u : users.findAllById(ids)) {
                names.put(u.getId(), u.getName());
            }
        }
        return names;
    }
}
