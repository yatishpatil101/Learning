package com.draazy.api.leads.conversation;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One message in a conversation. Maps {@code messages} (V4).
 *
 * <p><strong>{@code read} belongs to the recipient, not to the message.</strong> A conversation has
 * exactly two participants, so "read" is unambiguous without a per-user join table: a message is
 * read when the person who did not write it has seen it. The caller's unread count is therefore
 * {@code count(author_id <> me and read = false)}, and marking a thread read flips exactly the
 * messages the caller did not write. If a conversation ever gains a third participant this model
 * breaks and needs a {@code message_reads} table — which is why the two-party assumption is stated
 * here rather than left to be inferred.
 *
 * <p>{@code authorRole} is captured from the authenticated principal at write time, never from the
 * body, for the same reason as {@code ServiceRequestMessage}: a message written by a staffer who
 * later becomes an admin must still read as having come from staff.
 *
 * <p>The V4 {@code attachments} column is not mapped. The contract's {@code MessageCreate}
 * carries an {@code attachments} array, but there is no upload surface that produces a URL for a
 * chat message, so the field is accepted and dropped — the same documented behaviour as the
 * verification thread and the service-request thread. Mapping the column would only make it easier
 * to start writing client-supplied URLs into the database.
 */
@Entity
@Table(name = "messages")
@Getter
public class ConversationMessage extends BaseEntity {

    @Column(name = "conversation_id", nullable = false, updatable = false)
    private UUID conversationId;

    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    @Column(name = "author_role", updatable = false)
    private String authorRole;

    @Column(name = "body", nullable = false, updatable = false)
    private String body;

    @Column(name = "read", nullable = false)
    private boolean read;

    protected ConversationMessage() {
        // JPA
    }

    ConversationMessage(UUID conversationId, UUID authorId, String authorRole, String body) {
        this.conversationId = conversationId;
        this.authorId = authorId;
        this.authorRole = authorRole;
        this.body = body;
    }

}
