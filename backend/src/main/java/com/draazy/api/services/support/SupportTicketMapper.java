package com.draazy.api.services.support;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
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

/** Batch-loaded because the contract carries the thread inline, so a per-ticket load would be
 * an N+1 across the caller's whole list. */
@Component
public class SupportTicketMapper {

    private static final int PREVIEW_CHARS = 160;

    private final SupportTicketMessageRepository messages;
    private final UserRepository users;

    public SupportTicketMapper(SupportTicketMessageRepository messages, UserRepository users) {
        this.messages = messages;
        this.users = users;
    }

    public SupportTicketDto toDto(SupportTicket ticket) {
        return toDtos(List.of(ticket)).getFirst();
    }

    public List<SupportTicketSummary> toSummaries(List<SupportTicket> tickets) {
        if (tickets.isEmpty()) {
            return List.of();
        }
        Map<UUID, SupportTicketMessage> latest = messages
                .findLatestByTicketIdIn(tickets.stream().map(SupportTicket::getId).toList()).stream()
                .collect(Collectors.toMap(SupportTicketMessage::getTicketId, m -> m, (a, b) -> b));
        return tickets.stream()
                .map(t -> {
                    SupportTicketMessage m = latest.get(t.getId());
                    return new SupportTicketSummary(
                            t.getId().toString(),
                            t.getSubject(),
                            t.getCategory(),
                            t.getStatus(),
                            t.isUnread(),
                            m == null ? null : new SupportTicketSummary.LastMessage(
                                    m.getAuthorRole(), preview(m.getBody()), m.getCreatedAt()),
                            t.getCreatedAt());
                })
                .toList();
    }

    private static String preview(String body) {
        return body == null || body.length() <= PREVIEW_CHARS ? body : body.substring(0, PREVIEW_CHARS);
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

    /** Names are resolved for the whole page before {@code Page#map} walks it; a per-element lookup
     * inside the lambda would be an N+1 that only shows under load. */
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
