package com.punenest.api.services.ticket;

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
 * Entity→wire projection for the ticket board.
 *
 * <p>Batch-loaded for the same reason as {@code ServiceRequestMapper}: the contract's {@code Ticket}
 * carries its notes inline and the board is paged, so per-row loads would be an N+1 on the busiest
 * ops screen. {@link #toDtos} issues two queries whatever the page size.
 */
@Component
public class TicketMapper {

    private final TicketNoteRepository notes;
    private final UserRepository users;

    public TicketMapper(TicketNoteRepository notes, UserRepository users) {
        this.notes = notes;
        this.users = users;
    }

    public TicketDto toDto(Ticket ticket) {
        return toDtos(List.of(ticket)).getFirst();
    }

    /**
     * The raiser's view of their own ticket (debt D47) — everything {@link #toDto} carries except
     * the internal notes, which {@link CustomerTicketDto} has no component for.
     *
     * <p>Single-row, so it resolves the assignee name with one lookup instead of the batch
     * {@link #toDtos} needs. There is no customer list path and there should not be a batched
     * customer projection until there is.
     */
    public CustomerTicketDto toCustomer(Ticket ticket) {
        String assignee = ticket.getAssigneeId() == null
                ? null
                : users.findById(ticket.getAssigneeId()).map(User::getName).orElse(null);
        return new CustomerTicketDto(
                ticket.getId().toString(),
                ticket.getSubject(),
                ticket.getTeam(),
                ticket.getPriority(),
                ticket.getStatus(),
                ticket.getPropertyId() == null ? null : ticket.getPropertyId().toString(),
                assignee,
                ticket.getService(),
                ticket.getCustomer(),
                ticket.getMobile(),
                ticket.getValue(),
                ticket.getQuotedValue(),
                ticket.getDetail(),
                ticket.getCreatedAt());
    }

    public List<TicketDto> toDtos(List<Ticket> tickets) {
        if (tickets.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = tickets.stream().map(Ticket::getId).toList();
        Map<UUID, List<TicketNote>> byTicket = notes.findByTicketIdInOrderByAtAsc(ids).stream()
                .collect(Collectors.groupingBy(TicketNote::getTicketId));

        Set<UUID> assignees = tickets.stream()
                .map(Ticket::getAssigneeId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));
        Map<UUID, String> names = new HashMap<>();
        if (!assignees.isEmpty()) {
            for (User u : users.findAllById(assignees)) {
                names.put(u.getId(), u.getName());
            }
        }

        return tickets.stream()
                .map(t -> new TicketDto(
                        t.getId().toString(),
                        t.getSubject(),
                        t.getTeam(),
                        t.getPriority(),
                        t.getStatus(),
                        t.getPropertyId() == null ? null : t.getPropertyId().toString(),
                        names.get(t.getAssigneeId()),
                        t.getService(),
                        t.getCustomer(),
                        t.getMobile(),
                        t.getValue(),
                        t.getQuotedValue(),
                        t.getDetail(),
                        byTicket.getOrDefault(t.getId(), List.of()).stream()
                                .map(n -> new TicketDto.Note(n.getBy(), n.getText(), n.getAt()))
                                .toList(),
                        t.getCreatedAt()))
                .toList();
    }
}
