package com.draazy.api.leads.conversation;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

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

    @Column(name = "client_id", updatable = false)
    private String clientId;

    @Column(name = "reply_to_id", updatable = false)
    private UUID replyToId;

    @Column(name = "read", nullable = false)
    private boolean read;

    @Column(name = "delivered_at")
    private Instant deliveredAt;

    protected ConversationMessage() {

    }

    ConversationMessage(UUID conversationId, UUID authorId, String authorRole, String body) {
        this(conversationId, authorId, authorRole, body, null, null);
    }

    ConversationMessage(UUID conversationId, UUID authorId, String authorRole, String body,
            String clientId, UUID replyToId) {
        this.conversationId = conversationId;
        this.authorId = authorId;
        this.authorRole = authorRole;
        this.body = body;
        this.clientId = clientId;
        this.replyToId = replyToId;
    }

    void markDelivered() {
        deliveredAt = Instant.now();
    }

    }
