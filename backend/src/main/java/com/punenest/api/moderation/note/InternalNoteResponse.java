package com.punenest.api.moderation.note;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * One internal note on the wire (contract schema {@code InternalNote}).
 *
 * <p>{@code authorId} and {@code authorName} are both served, and both are needed. The id is the
 * durable fact — it survives a rename and is what a future "notes by this colleague" read would key
 * on. The name is what a screen prints: the audit log resolves actors the same way and is
 * admin-only, so a staff console with only ids would be showing uuids to people who cannot look
 * them up. {@code authorName} falls back to the id when no account matches, which degrades to
 * unreadable rather than to blank.
 *
 * <p>{@code action} is null for a note written on its own rather than beside a decision, and is
 * omitted from the JSON when so — {@code JsonInclude(NON_NULL)}, as everywhere else, because an
 * absent label and an empty one are different claims.
 *
 * <p>{@code createdAt} and {@code updatedAt} are both here because the note is editable: a reader
 * who cannot tell that the text in front of them was rewritten last week is reading it as if it
 * were contemporaneous.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record InternalNoteResponse(
        String id,
        String entityType,
        String entityId,
        String authorId,
        String authorName,
        String action,
        String text,
        Instant createdAt,
        Instant updatedAt) {
}
