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
 * <p><strong>This paragraph used to read "Nothing on the server emits a match or price alert
 * <em>today</em>", and as of D94 half of that is no longer true.</strong> The saved-search sweep
 * now publishes {@code match.saved-search} when an alert's match count rises and its chosen
 * cadence permits, so the master switch finally governs something real rather than standing ready.
 * The gate was written before the writer for exactly this moment: the sender inherited an honoured
 * preference instead of needing a second migration to acquire one.
 *
 * <p>The {@code price} family is still unwritten — nothing watches a saved property's asking price
 * — and price-drop notifications remain derived in the browser (see {@code Notifications.jsx}),
 * which is the remaining half of the asymmetry D94 describes.
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
