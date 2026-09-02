package com.draazy.api.content;

import java.time.Instant;
import java.util.Map;

/**
 * Contract {@code Announcement} wire shape.
 *
 * @param translations editor-written translations, keyed language then field name — see
 *                     {@link FaqResponse}
 */
public record AnnouncementResponse(
        String id,
        String title,
        String body,
        String severity,
        Instant startsAt,
        Instant endsAt,
        Map<String, Map<String, String>> translations) {
}
