package com.punenest.api.engagement.notification;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * The quiet-hours half of {@link NotificationPreferencesUpdateRequest} (contract
 * {@code QuietHoursUpdate}).
 *
 * <p>The pattern is the same 24-hour {@code HH:mm} shape V73's CHECK constraint enforces, stated
 * twice on purpose: here so a bad value is a 422 naming the field, and in the database so a value
 * that arrives by any other route cannot be stored. {@code <input type="time">} emits exactly this.
 *
 * <p>{@code start} and {@code end} are required even when {@code enabled} is false. A window with
 * no bounds is not a smaller document, it is an ambiguous one — the user who switches quiet hours
 * back on would find the platform had forgotten when they wanted quiet, and the settings screen has
 * both controls populated at all times anyway.
 */
public record QuietHoursUpdateRequest(
        @NotNull Boolean enabled,
        @NotNull @Pattern(regexp = "^([01][0-9]|2[0-3]):[0-5][0-9]$",
                message = "must be a 24-hour HH:mm time") String start,
        @NotNull @Pattern(regexp = "^([01][0-9]|2[0-3]):[0-5][0-9]$",
                message = "must be a 24-hour HH:mm time") String end) {
}
