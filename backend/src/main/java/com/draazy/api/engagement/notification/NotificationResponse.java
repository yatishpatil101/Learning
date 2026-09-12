package com.draazy.api.engagement.notification;

import java.time.Instant;

/**
 * Contract {@code Notification} wire shape.
 *
 * @param id        opaque id
 * @param type      notification type (e.g. "price_drop"), nullable
 * @param read      whether the caller has seen it
 * @param link      deep link, nullable
 */
public record NotificationResponse(
        String id,
        String type,
        String title,
        String body,
        boolean read,
        String link,
        Instant createdAt) {
}
