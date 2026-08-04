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
                                        names.get(m.getAuthorId()),
                                        m.getAuthorRole(),
                                        m.getBody(),
                                        m.getCreatedAt()))
                                .toList(),
                        t.getCreatedAt()))
                .toList();
    }
}
