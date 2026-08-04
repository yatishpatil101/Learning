package com.punenest.api.engagement.notification;

import java.util.List;

/**
 * Body for {@code POST /notifications/read}. Both fields are optional: an absent/empty
 * {@code ids} means "mark ALL of the caller's notifications read" — matching the frontend mock's
 * {@code markAllNotifsRead} function.
 */
public record MarkReadRequest(List<String> ids) {
}
