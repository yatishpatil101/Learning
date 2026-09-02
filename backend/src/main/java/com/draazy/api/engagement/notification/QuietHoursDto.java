package com.draazy.api.engagement.notification;

/**
 * The quiet-hours half of {@link NotificationPreferencesDto} (contract {@code QuietHours}).
 *
 * <p>Nested rather than flattened into three sibling fields because that is how the browser already
 * stores and sends it, and because the three values are only meaningful together: {@code start}
 * without {@code enabled} is a number nobody acts on.
 *
 * <p>{@code start} and {@code end} are {@code HH:mm} wall-clock labels. {@link QuietHours} is the
 * only code that interprets them, and it documents which timezone they are read against.
 */
public record QuietHoursDto(boolean enabled, String start, String end) {
}
