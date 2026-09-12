package com.draazy.api.engagement.messaging;

/**
 * A template as the picker sees it.
 *
 * <p>Carries {@code body} — the raw text with {@code {placeholder}} keys still in it — because the
 * console renders a live preview as a staff member picks, substituting from the listing already on
 * screen. That preview is thrown away and the server renders the authoritative copy at send time;
 * they agree because they run the same substitution over the same string. Sending the console a
 * pre-rendered body per listing instead would mean this endpoint had to know which listing was
 * being looked at, which is a worse shape for a library.
 *
 * <p>No {@code createdAt}/{@code updatedAt}: nothing in the picker shows them, and a timestamp on a
 * piece of copy invites the reader to think it means something about the messages sent from it.
 */
public record MessageTemplateDto(String id, String channel, String category, String name, String body) {

    static MessageTemplateDto of(MessageTemplate template) {
        return new MessageTemplateDto(
                template.getId(),
                template.getChannel(),
                template.getCategory(),
                template.getName(),
                template.getBody());
    }
}
