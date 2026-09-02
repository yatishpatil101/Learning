package com.draazy.api.moderation.conversation;

import java.time.Instant;
import java.util.List;

/**
 * Contract schema {@code ModeratedConversation} — one private thread, read by a moderator (D53).
 *
 * @param participants exactly two, in the row's canonical order. Not "me and them" — see
 *                     {@link ModeratedParticipantDto}
 * @param propertyId   the listing the thread is about, {@code null} for a thread with none
 * @param createdAt    when the thread was opened
 * @param updatedAt    when it last moved — the field a triage desk sorts a stack of reports by
 * @param messages     the whole thread, oldest first. Deliberately not paged: a moderator reading a
 *                     reported conversation needs the context around the reported line, and the
 *                     write path caps a message at 4000 characters so a thread is bounded in
 *                     practice. If a thread ever grows past what one response should carry, the
 *                     answer is a page parameter here, not a truncation nobody is told about
 */
public record ModeratedConversationDto(
        String id,
        List<ModeratedParticipantDto> participants,
        String propertyId,
        Instant createdAt,
        Instant updatedAt,
        List<ModeratedMessageDto> messages) {
}
