package com.draazy.api.engagement.notification;

/** Names mirror existing browser settings so persisted documents can move without transformation. */
public record NotificationPreferencesDto(
        boolean email,
        boolean sms,
        boolean whatsapp,
        boolean matchAlerts,
        QuietHoursDto quietHours,
        String language) {

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
