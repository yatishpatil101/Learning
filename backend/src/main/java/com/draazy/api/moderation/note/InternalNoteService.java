package com.draazy.api.moderation.note;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.services.request.ServiceRequestDesks;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InternalNoteService {

    private final InternalNoteRepository notes;
    private final InternalNoteMapper mapper;
    private final UserRepository users;
    private final NoteEntityKey key;
    private final ServiceRequestDesks desks;

    public InternalNoteService(InternalNoteRepository notes, InternalNoteMapper mapper,
            UserRepository users, NoteEntityKey key, ServiceRequestDesks desks) {
        this.notes = notes;
        this.mapper = mapper;
        this.users = users;
        this.key = key;
        this.desks = desks;
    }

    // Every note on one entity, newest first. Staff/admin.
    @Transactional(readOnly = true)
    public List<InternalNoteResponse> list(AuthPrincipal actor, String entityType, String entityId) {
        requireKnownType(entityType);
        String resolved = key.resolve(entityType, entityId);
        requireDesk(actor, entityType, resolved);
        List<InternalNote> rows =
                notes.findByEntityTypeAndEntityIdOrderByCreatedAtDesc(entityType, resolved);
        return decorate(rows);
    }

    @Transactional
    public InternalNoteResponse add(AuthPrincipal actor, String entityType, String entityId,
            String action, String text) {
        requireKnownType(entityType);
        String resolved = key.resolve(entityType, entityId);
        requireDesk(actor, entityType, resolved);
        InternalNote note = new InternalNote(entityType, resolved,
                actor.userId(), blankToNull(action), text.trim());
        return decorate(List.of(notes.saveAndFlush(note))).getFirst();
    }

    // One query lets the console badge a page without twenty round trips.
    @Transactional(readOnly = true)
    public Map<String, Long> countsFor(String entityType, List<String> entityIds) {
        requireKnownType(entityType);
        if (entityIds == null || entityIds.isEmpty()) {
            return Map.of();
        }
        Map<String, String> asGiven = entityIds.stream().distinct().collect(Collectors.toMap(
                given -> key.resolve(entityType, given), given -> given, (first, second) -> first));
        return notes.countByEntityTypeAndEntityIdIn(entityType, new LinkedHashSet<>(asGiven.keySet()))
                .stream()
                .collect(Collectors.toMap(
                        row -> asGiven.getOrDefault((String) row[0], (String) row[0]),
                        row -> (Long) row[1]));
    }

    // Resolve author names once per batch; case files often repeat the same colleagues.
    private List<InternalNoteResponse> decorate(List<InternalNote> rows) {
        Set<UUID> authorIds =
                rows.stream().map(InternalNote::getAuthorId).collect(Collectors.toSet());
        Map<UUID, String> names = users.findAllById(authorIds).stream()
                .filter(user -> user.getName() != null)
                .collect(Collectors.toMap(User::getId, User::getName, (first, second) -> first));
        Function<InternalNote, String> nameOf =
                note -> names.getOrDefault(note.getAuthorId(), String.valueOf(note.getAuthorId()));
        return rows.stream().map(note -> mapper.toResponse(note, nameOf.apply(note))).toList();
    }

    private void requireDesk(AuthPrincipal actor, String entityType, String entityId) {
        if (NoteEntityTypes.SERVICE_REQUEST.equals(entityType)) {
            desks.requireOnCallersDesk(actor, entityId);
        }
    }

    private static void requireKnownType(String entityType) {
        if (!NoteEntityTypes.isValid(entityType)) {
            throw new BadRequestException("Notes cannot be attached to a " + entityType);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
