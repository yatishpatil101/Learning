package com.draazy.api.leads.conversation;

import com.draazy.api.common.attachment.MessageAttachmentDto;
import java.time.Instant;
import java.util.List;

public record MessageDto(
        String id,
        boolean mine,
        String author,
        String body,
        Instant createdAt,
        String clientId,
        ReplyTo replyTo,
        boolean read,
        boolean delivered,
        List<MessageAttachmentDto> attachments) {

    public record ReplyTo(String id, String author, String body) {
    }
}
