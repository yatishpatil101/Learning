package com.draazy.api.common.trust;

/**
 * Port for reaching a person outside this platform; returns a {@link Prepared} record, not a boolean,
 * because the first impl cannot transmit. Rationale: docs/system/cross-cutting.md#outbound-messaging-why-messagesender-returns-a-prepared-record
 */
public interface MessageSender {

    /** Compose, record, transmit as far as this implementation is able. */
    Prepared send(MessageRequest request);

    /**
     * What the caller asked for; unknown {@code {placeholder}} keys are left as literal text so a
     * typo surfaces in the preview rather than silently blanking a sentence.
     */
    record MessageRequest(
            String channel,
            String templateId,
            String subjectType,
            java.util.UUID subjectId,
            java.util.UUID recipientId,
            String recipientMobile,
            java.util.UUID preparedBy,
            java.util.Map<String, String> variables) {}

    /**
     * Outcome record; {@code body} is stored as well as returned (re-rendering later from an
     * edited template would show a message the owner never received).
     */
    record Prepared(java.util.UUID id, String body, String status, String handoffLink) {}
}
