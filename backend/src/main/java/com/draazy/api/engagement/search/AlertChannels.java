package com.draazy.api.engagement.search;

/**
 * The {@code saved_searches.channel} vocabulary — where a saved-search alert is delivered.
 *
 * <p>Traced to both:
 * <ul>
 *   <li>V27: {@code CHECK (channel IN ('whatsapp','sms','email','push'))}</li>
 *   <li>OpenAPI: {@code SavedSearch.channel} / {@code SavedSearchCreate.channel}</li>
 * </ul>
 *
 * <p>WhatsApp is the schema default, which is the right default for Pune: it is the channel
 * property seekers actually read.
 *
 * <p><strong>{@code sms} was missing from both halves until V27.</strong> The contract has listed it
 * since the beginning, but the old V8's CHECK constraint and this pattern both omitted it — so an SMS alert
 * was refused by the edge, and would have been a 500 from the constraint had it got past. Both are
 * corrected together, because a vocabulary that disagrees with itself across two files is exactly
 * the drift this class exists to prevent.
 */
public final class AlertChannels {

    private AlertChannels() {
    }

    /** WhatsApp message. The schema default. */
    public static final String WHATSAPP = "whatsapp";

    /** SMS. The fallback for a number with no WhatsApp account. */
    public static final String SMS = "sms";

    /** Email. */
    public static final String EMAIL = "email";

    /** In-app / device push notification. */
    public static final String PUSH = "push";

    /** Validation pattern for request input. */
    public static final String PATTERN = WHATSAPP + "|" + SMS + "|" + EMAIL + "|" + PUSH;

    /** Message rendered when {@link #PATTERN} rejects a value. */
    public static final String PATTERN_MESSAGE = "must be whatsapp, sms, email or push";
}
