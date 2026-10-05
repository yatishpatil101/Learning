package com.draazy.api.common.attachment;

import com.draazy.api.provider.FileStorage;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MessageAttachments {

    private final MessageAttachmentRepository attachments;
    private final FileStorage storage;

    public MessageAttachments(MessageAttachmentRepository attachments, FileStorage storage) {
        this.attachments = attachments;
        this.storage = storage;
    }

    // Checked before the bytes are read, so a caller cannot make the server hold megabytes in
    // memory for an upload that was going to be refused anyway.
    @Transactional(readOnly = true)
    public Map<UUID, List<MessageAttachmentDto>> byMessage(Collection<UUID> messageIds) {
        if (messageIds == null || messageIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<MessageAttachmentDto>> byMessage = new LinkedHashMap<>();
        for (MessageAttachment a : attachments.findByMessageIdInOrderByCreatedAtAsc(messageIds)) {
            byMessage.computeIfAbsent(a.getMessageId(), k -> new java.util.ArrayList<>()).add(toDto(a));
        }
        return byMessage;
    }

    private MessageAttachmentDto toDto(MessageAttachment a) {
        return new MessageAttachmentDto(
                a.getId().toString(),
                a.getFileName(),
                a.getContentType(),
                a.getSizeBytes(),
                storage.signedDownloadUrl(a.getStorageKey()),
                a.getCreatedAt());
    }

}
