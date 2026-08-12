package com.punenest.api.services.support;

import com.punenest.api.common.attachment.MessageAttachmentDto;
import java.time.Instant;
import java.util.List;

/**
 * Contract schema {@code Message}.
 *
 * <p>A third copy of the same fields, after {@code services.request.MessageDto} and
 * {@code leads.conversation.MessageDto}. That is deliberate: these are three unrelated conversation
 * surfaces that happen to render alike today, and a shared record would make any future divergence a
 * change to all three. D49 was exactly the divergence this anticipated — "a support message needing
 * an attachment" — except that it landed on <em>two</em> of the three: this record and the chat one
 * gained {@code attachments}, and {@code services.request.MessageDto} did not, which is why the
 * contract gives that surface its own {@code ServiceRequestMessage} schema.
 *
 * @param authorId   who wrote it — <strong>the field a client must use to decide "mine or theirs"</strong>.
 *     {@link #author} is a display name, and attributing by name works right up until two users
 *     share one, at which point a stranger's message renders on the reader's own side of the thread.
 *     Added 2026-08-08: the mapper already read this id to look up the name and then discarded it,
 *     so the contract declared a field the wire never carried (found by {@code SpecSchemaParityTest}).
 * @param author     display name; {@code null} for a message whose author has since been removed
 * @param authorRole {@code buyer|owner|staff|admin}, captured at write time
 * @param attachments files sent with it, oldest first, empty when there are none (D49). Never null.
 *     The signed URLs inside are minted for this read and expire
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
