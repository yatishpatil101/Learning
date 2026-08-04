package com.punenest.api.content;

import java.time.Instant;

/**
 * Contract {@code Announcement} wire shape.
 */
public record AnnouncementResponse(
        String id,
        String title,
        String body,
        String severity,
        Instant startsAt,
        Instant endsAt) {
}
