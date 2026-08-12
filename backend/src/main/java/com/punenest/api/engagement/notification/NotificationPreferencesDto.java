package com.punenest.api.engagement.notification;

/**
 * The wire shape of {@code GET/PUT /me/notification-preferences} (contract
 * {@code NotificationPreferences}).
 *
 * <p><strong>Field-for-field the object the browser has always kept in localStorage.</strong> The
 * client-side default is
 * <pre>{ email:true, sms:false, whatsapp:true, matchAlerts:true,
 *   quietHours:{ enabled:false, start:'22:00', end:'07:00' }, language:'en' }</pre>
 * and this record is that, including the nesting. Naming is the whole job here: the settings screen
 * and its persisted documents already exist in every user's browser, so a server contract that
 * renamed {@code matchAlerts} or flattened {@code quietHours} would make the migration a
 * transformation rather than a move, and every transformation is somewhere for the two to drift.
 *
 * <p>Returned by {@code PUT} as well as {@code GET} so a client sees the server's view of what it
 * just wrote rather than trusting that its own input was applied — the convention {@code
 * saveOwnerKyc} follows.
 */
public record NotificationPreferencesDto(
        boolean email,
        boolean sms,
        boolean whatsapp,
        boolean matchAlerts,
        QuietHoursDto quietHours,
        String language) {

    /** The stored row's view. */
    static NotificationPreferencesDto of(NotificationPreference row) {
        return new NotificationPreferencesDto(
                row.isEmail(),
                row.isSms(),
                row.isWhatsapp(),
                row.isMatchAlerts(),
                new QuietHoursDto(row.isQuietHoursEnabled(), row.getQuietStart(), row.getQuietEnd()),
                row.getLanguage());
    }
}
