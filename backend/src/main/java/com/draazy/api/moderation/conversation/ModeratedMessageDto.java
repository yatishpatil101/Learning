package com.draazy.api.moderation.conversation;

import com.draazy.api.common.attachment.MessageAttachmentDto;
import java.time.Instant;
import java.util.List;

/**
 * Contract schema {@code ModeratedMessage} — one message as a moderator sees it.
 *
 * <p>Shaped like the participant's {@code Message} but declared separately, because the two are not
 * the same fact and will not stay the same shape: a moderator has no unread state, and anything a
 * moderation view later needs (an edit history, a deletion tombstone, a spam score) is exactly the
 * kind of field that must not appear on the participant read by accident. Sharing the record would
 * make every such addition a change to both.
 *
 * @param attachments the files on this message (D49), oldest first, never null. A reported chat is
 *     very often reported <em>for</em> what was attached to it, so a moderation read that returned
 *     only the text would answer the wrong question. The URLs are signed for this read and expire.
 */
public record ModeratedMessageDto(
        String id,
        String authorId,
        String author,
        String authorRole,
        String body,
        Instant createdAt,
        List<MessageAttachmentDto> attachments) {
}
