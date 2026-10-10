package com.draazy.api.leads.conversation;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

public record ConversationDto(
        String id,
        String kind,
        String counterpartyName,
        String counterpartyRole,
        @JsonInclude(JsonInclude.Include.NON_NULL) String counterpartyMobile,
        String youAre,
        String propertyId,
        String propertyTitle,
        Long propertyPrice,
        String propertyDeal,
        String propertyBhk,
        String propertyLocality,
        String propertyCover,
        boolean propertyAvailable,
        String groupId,
        String groupTitle,
        Integer memberCount,
        String lastMessage,
        long unread,
        Instant updatedAt,
        boolean archived,
        boolean muted,
        boolean blocked,
        boolean awaitingReply,
        @JsonInclude(JsonInclude.Include.NON_NULL) Presence presence,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<MessageDto> messages) {

    static final String DIRECT = "direct";
    static final String GROUP = "group";

    public record Presence(boolean online, Instant lastSeenAt) {
    }
}
