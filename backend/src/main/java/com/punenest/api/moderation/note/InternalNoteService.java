package com.punenest.api.moderation.note;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Internal notes: what the team knows about a case, kept where the team can read it (D29).
 *
 * <h2>Why this exists at all</h2>
 *
 * <p>Four moderation actions used to write a note into the browser's own {@code localStorage} in the
 * same handler that made a real API call. The decision landed on the server and in the audit log;
 * the reasoning stayed on one laptop. A colleague opening the same listing the next morning saw the
 * outcome with no explanation, and the note was not lost in a way anybody noticed — it simply was
 * not there, which reads identically to "nobody wrote one".
 *
 * <h2>Deliberately inter-transparent</h2>
 *
 * <p>Any staff or admin may read <em>any</em> note, and edit it. There are no per-team walls and no
 * author-only edit rule. This is the decision, not an omission: notes are how one shift hands a case
 * to the next, and a note the next shift cannot see is a note that did not need writing. The two
 * atoms — {@code notes:read} and {@code notes:write} — exist so an account can be given the read
 * without the write, which is the split that actually occurs in a back office.
 *
 * <p>The author is taken from the principal and is immutable. The client does not get to say who
 * wrote a note, for the same reason it does not get to say who filed a report.
 *
 * <h2>What is audited, and what is not</h2>
 *
 * <p>Writing a note is not audited; editing one is. Adding is the ordinary work this table exists
 * for, and an audit row per note would double the table for no reader. An <em>edit</em> is different:
 * it replaces text a colleague may already have acted on, and the previous wording is gone from this
 * row afterwards. The audit entry carries it, so the record of what the note used to say survives
 * even though the note does not keep its own history.
 */
@Service
public class InternalNoteService {

    private final InternalNoteRepository notes;
    private final InternalNoteMapper mapper;
    private final UserRepository users;
    private final AuditService audit;

    public InternalNoteService(InternalNoteRepository notes, InternalNoteMapper mapper,
            UserRepository users, AuditService audit) {
        this.notes = notes;
        this.mapper = mapper;
        this.users = users;
        this.audit = audit;
    }

    /**
     * Every note on one entity, newest first. Staff/admin.
     *
     * <p>A bare list rather than a page, per api-standards.md §5.1: this collection grows with one
     * case's history, not with the platform. A listing with more notes than fit on a screen is a
     * listing whose whole history the moderator wants.
     *
     * <p>The entity type is validated rather than passed through. An unknown one would otherwise
     * return an empty list, which is what "no notes yet" looks like — so a client typo would read as
     * a clean record.
     *
     * @throws BadRequestException if {@code entityType} is not one of the four kinds that take notes
     */
    @Transactional(readOnly = true)
    public List<InternalNoteResponse> list(String entityType, String entityId) {
        requireKnownType(entityType);
        List<InternalNote> rows =
                notes.findByEntityTypeAndEntityIdOrderByCreatedAtDesc(entityType, entityId);
        return decorate(rows);
    }

    /**
     * Add a note. Staff/admin.
     *
     * <p>The target is not resolved against its table, following {@code Report}: the four kinds live
     * in four places and one of them is itself polymorphic, and a note about something that was
     * archived a minute ago is exactly the note worth keeping.
     *
     * @throws BadRequestException if the entity type is unknown
     */
    @Transactional
    public InternalNoteResponse add(AuthPrincipal actor, String entityType, String entityId,
            String action, String text) {
        requireKnownType(entityType);
        InternalNote note = new InternalNote(entityType, entityId, actor.userId(),
                blankToNull(action), text.trim());
        return decorate(List.of(notes.saveAndFlush(note))).getFirst();
    }

    /**
     * Rewrite a note's text. Staff/admin — <em>any</em> of them, not only the author.
     *
     * <p>The previous wording goes into the audit log before it is overwritten. That is the whole
     * reason this operation is audited and adding is not: after this returns, this row is the only
     * copy of the new text and nothing anywhere holds the old.
     *
     * @throws NotFoundException if no note has that id — including when the id is not a uuid at all,
     *                           which is a 404 rather than a 400 because a caller guessing ids
     *                           learns nothing either way
     */
    @Transactional
    public InternalNoteResponse edit(AuthPrincipal actor, String id, String text) {
        UUID noteId = Ids.parseUuid(id).orElseThrow(() -> NotFoundException.of("Note"));
        InternalNote note = notes.findById(noteId).orElseThrow(() -> NotFoundException.of("Note"));
        String before = note.getText();
        note.edit(text.trim());
        InternalNote saved = notes.saveAndFlush(note);
        audit.record(actor, "note.edit", "note", id,
                "entity", note.getEntityType(), "entityId", note.getEntityId(),
                "author", String.valueOf(note.getAuthorId()), "was", before);
        return decorate(List.of(saved)).getFirst();
    }

    /**
     * Note counts for a page of entities of one kind, in one query.
     *
     * <p>Exists so a console can badge twenty rows without twenty round trips. Entities with no
     * notes are absent from the returned map rather than present with zero — a caller should read it
     * with a default, which is also what stops an empty result from needing a special case.
     */
    @Transactional(readOnly = true)
    public Map<String, Long> countsFor(String entityType, List<String> entityIds) {
        requireKnownType(entityType);
        if (entityIds == null || entityIds.isEmpty()) {
            return Map.of();
        }
        return notes.countByEntityTypeAndEntityIdIn(entityType, new LinkedHashSet<>(entityIds))
                .stream()
                .collect(Collectors.toMap(row -> (String) row[0], row -> (Long) row[1]));
    }

    /**
     * Attach author names to a batch of rows in one lookup.
     *
     * <p>One query for the whole batch rather than one per note: a case file with thirty notes from
     * three colleagues is three names, and resolving them row by row is the shape that turns a
     * cheap read into a slow one without anything looking wrong.
     *
     * <p>An author with no matching account falls back to the raw id. That is not a nicety — the
     * column is not a foreign key to {@code users} on purpose (a staff account can be archived and
     * its notes stay), so an unresolved author is a real state, and rendering it as blank would make
     * an authored note look anonymous.
     */
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

    private static void requireKnownType(String entityType) {
        if (!NoteEntityTypes.isValid(entityType)) {
            throw new BadRequestException("Notes cannot be attached to a " + entityType);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
