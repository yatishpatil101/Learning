package com.punenest.api.leads.conversation;

import com.punenest.api.common.attachment.MessageAttachmentDto;
import java.time.Instant;
import java.util.List;

/**
 * Contract {@code Message} — one message in a thread.
 *
 * @param authorId   who wrote it. <strong>The field a client must use to decide "mine or theirs".</strong>
 *     {@link #author} is a <em>display name</em>, and attributing a message by comparing display
 *     names works right up until two users share one — at which point a stranger's message renders
 *     on the reader's own side of the thread. Identity is an id; a name is a label that happens to
 *     be usually unique.
 * @param author     display name, nullable if the account has none
 * @param authorRole the author's role at the time of writing
 * @param createdAt  when it was sent
 * @param attachments files sent with it, oldest first, empty when there are none (D49). Never null,
 *     so a client can iterate without a null check. The signed URLs inside are minted for this read
 *     and expire — they are not links to keep.
 */
public record MessageDto(
        String id,
        String authorId,
        String author,
        String authorRole,
        String body,
        Instant createdAt,
        List<MessageAttachmentDto> attachments) {
}
