package com.punenest.api.engagement.notification;

/**
 * Which server notification types the master {@code matchAlerts} switch governs.
 *
 * <p><strong>The switch is narrower than its position in the UI suggests, and that is the point.</strong>
 * It is labelled "New match alerts" and it means it. A user who turns it off has said "stop
 * proactively hunting for listings on my behalf" — they have not said "do not tell me when somebody
 * makes an offer on my flat, or when a moderator rejects my listing". Reading it as a global mute
 * would be the same class of mistake as reading an absent preferences row as silence: a switch the
 * user understands as narrow, applied broadly, losing events they are a party to.
 *
 * <p><strong>Classified by the wire type's own family, not by the client's chip mapping.</strong>
 * {@code providers/http/notificationMapper.js} maps {@code offer.received} onto the {@code price}
 * chip, because the UI has no {@code offer} filter and money is the closest family. Reusing that
 * mapping here would make a client-side presentation choice decide whether an offer notification is
 * ever written — the server would silence real offers because the browser groups them under a chip
 * whose name happens to overlap with an alert family. So the test is on the server's own namespace.
 *
 * <p>Nothing on the server emits a match or price alert <em>today</em>: saved-search matching is
 * still derived in the browser (see {@code Notifications.jsx}), which is precisely the asymmetry
 * D94 describes. The gate is here so that the writer which eventually does emit them inherits an
 * honoured preference instead of a second migration.
 */
final class NotificationTypes {

    /** Server type families the master switch governs — matched as a whole word or a dotted prefix. */
    private static final String[] ALERT_FAMILIES = {"match", "price"};

    private NotificationTypes() {
    }

    /**
     * Whether {@code type} is a proactive alert rather than an event the recipient is a party to.
     *
     * <p>Prefix-matched on the dot so {@code match.saved-search} is governed while a hypothetical
     * {@code matchmaking.invite} is not — a substring test would quietly capture the second.
     */
    static boolean isMatchAlert(String type) {
        if (type == null) {
            return false;
        }
        for (String family : ALERT_FAMILIES) {
            if (type.equals(family) || type.startsWith(family + ".")) {
                return true;
            }
        }
        return false;
    }
}
