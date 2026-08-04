package com.punenest.api.documents.request;

import java.security.SecureRandom;
import java.util.Base64;

/**
 * Mints the bearer token behind {@code GET /documents/shared}.
 *
 * <p><strong>This token is the whole authorisation for the share read.</strong> The contract marks
 * that route {@code security: []} because the link is forwarded to a lawyer or a bank officer who
 * has no PuneNest account, so whoever holds the string can read someone's title deeds. That makes
 * three properties non-negotiable and worth stating where they are produced:
 *
 * <ul>
 *   <li><strong>Unguessable.</strong> 256 bits from {@link SecureRandom}. Not {@code UUID.randomUUID}
 *       (122 bits, and easy to mistake for the ids that appear in URLs) and never
 *       {@code Math.random}/{@code Random}, whose output is reconstructible from a few samples.</li>
 *   <li><strong>Not derived from the request.</strong> A token that is a hash of the request id
 *       would be forgeable by anyone who ever saw a request id.</li>
 *   <li><strong>Single-purpose.</strong> It names one grant, so revoking or expiring that grant
 *       revokes exactly one link.</li>
 * </ul>
 */
public final class ShareTokens {

    private ShareTokens() {
    }

    private static final SecureRandom RANDOM = new SecureRandom();

    /** URL-safe and unpadded, so the token survives a WhatsApp forward without re-encoding. */
    public static String mint() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
