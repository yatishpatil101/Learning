package com.draazy.api.common.trust;

import java.util.UUID;

public interface Notifier {

    void notify(UUID userId, String type, String title, String body, String link);

    default void markRead(UUID userId, String type, String link) {
    }

    /** The recipient's WhatsApp toggle; true where no preferences are kept, as for an unset row. */
    default boolean allowsWhatsapp(UUID userId) {
        return true;
    }

    static String rupees(long amount) {
        return "\u20b9" + indianGrouping(amount);
    }

    static String indianGrouping(long amount) {
        String digits = Long.toString(amount);
        int split = Math.max(0, digits.length() - 3);
        String lakhs = digits.substring(0, split).replaceAll("\\B(?=(\\d{2})+$)", ",");
        return (lakhs.isEmpty() ? "" : lakhs + ",") + digits.substring(split);
    }
}
