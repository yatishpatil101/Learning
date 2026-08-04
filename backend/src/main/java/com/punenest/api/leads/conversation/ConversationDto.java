package com.punenest.api.leads.conversation;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * Contract {@code Conversation} — one thread as the calling participant sees it.
 *
 * <p>Everything here is relative to the caller. {@code counterparty*} is the <em>other</em> person,
 * {@code unread} is the caller's own count, and {@code counterpartyMobile} is masked or raw
 * according to the caller's contact-gate standing. Two participants fetching the same conversation
 * therefore get two different documents, which is correct and is the reason no field is named from
 * the row's own perspective.
 *
 * <p>{@code messages} is omitted on the list and present on the detail, per the contract. That is
 * {@code NON_NULL} on the field rather than a second DTO: the two shapes differ by exactly one
 * field, and a {@code ConversationSummary} that had to be kept in step with this record by hand is
 * more to get wrong than one annotation. An empty thread is impossible — opening a conversation
 * requires a first message — so {@code null} here is never confusable with "no messages".
 */
public record ConversationDto(
        String id,
        String counterpartyName,
        String counterpartyRole,
        String counterpartyMobile,
        String propertyId,
        String propertyTitle,
        String lastMessage,
        long unread,
        Instant updatedAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<MessageDto> messages) {
}
