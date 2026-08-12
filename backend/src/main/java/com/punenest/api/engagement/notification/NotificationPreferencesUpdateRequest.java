package com.punenest.api.engagement.notification;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * The write shape for {@code PUT /me/notification-preferences} (contract
 * {@code NotificationPreferencesUpdate}).
 *
 * <p><strong>Every field is required, deliberately.</strong> This is a {@code PUT} over a settings
 * screen where all six controls are visible at once, so the client sends the document it is looking
 * at and the server stores it. The two alternatives are both worse: treating an omitted field as
 * "keep whatever is stored" makes this a {@code PATCH} wearing a {@code PUT}'s verb and lets two
 * open tabs disagree about which fields the second one meant to leave alone; treating it as "reset
 * to the default" would silently switch a user's match alerts back on because a serialiser dropped
 * a false. A missing field is a 422 that names the field, which is the only one of the three the
 * client can act on.
 *
 * <p>Boxed {@code Boolean} rather than {@code boolean} for exactly that reason — a primitive would
 * bind an absent field to {@code false} and the {@link NotNull} could never fire.
 *
 * @param language the language the platform should address this user in. Constrained to the three
 *                 the app actually ships (en/hi/mr, per {@code ProfileTab}'s language select) and
 *                 by V73's CHECK; an unconstrained free-text locale would reach the database and be
 *                 rejected there as a 500 rather than here as a 422
 */
public record NotificationPreferencesUpdateRequest(
        @NotNull Boolean email,
        @NotNull Boolean sms,
        @NotNull Boolean whatsapp,
        @NotNull Boolean matchAlerts,
        @NotNull @Valid QuietHoursUpdateRequest quietHours,
        @NotNull @Pattern(regexp = "^(en|hi|mr)$",
                message = "must be one of en, hi, mr") String language) {
}
