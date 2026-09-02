package com.draazy.api.billing.referral;

import java.util.Set;

/**
 * How a referral link travelled from the referrer to the person who redeemed it (D60).
 *
 * <p><strong>Why this is not {@code Referral.channel}.</strong> That field says {@code seeker} or
 * {@code owner} — which side of the marketplace the referred party joined on. It is a real fact and
 * the ops queue facets on it, but it is not what its name promises, and the reason nothing recorded
 * the share channel was simply that redemption carried no share context to record. Repurposing
 * {@code channel} would have rewritten the meaning of every row already stored under the old one,
 * so the missing dimension is added beside it instead.
 *
 * <p><strong>Closed vocabulary, and null is a member of it.</strong> The referee's client can only
 * report a channel the referrer's link carried, and a code dictated over a phone call or read off a
 * printed card carries nothing at all. Those redemptions record no channel rather than
 * {@code other}: "we do not know" and "the referrer used something we have no name for" are
 * different facts, and collapsing them would make {@code other} the largest bucket in any report
 * built on this field — which is exactly the report D60 warns about.
 *
 * <p>Constants rather than an enum per {@code api-standards.md} §7.1, matching
 * {@link ReferralStatuses}.
 */
public final class ShareChannels {

    private ShareChannels() {
    }

    /** Shared through WhatsApp — the platform's dominant sharing surface in this market. */
    public static final String WHATSAPP = "whatsapp";

    /** Shared as an SMS. */
    public static final String SMS = "sms";

    /** Shared by email. */
    public static final String EMAIL = "email";

    /** The link or code was copied to the clipboard and pasted somewhere we cannot see. */
    public static final String COPY = "copy";

    /** Scanned from a QR code — a printed card, a poster, a screen held up in person. */
    public static final String QR = "qr";

    /** A channel the client named that is none of the above. Never used for "unknown". */
    public static final String OTHER = "other";

    /**
     * Everything the CHECK constraint on {@code referrals.share_channel} (V64) admits.
     *
     * <p>Kept in step with that constraint by {@code ReferralQualificationTest}, because the two
     * failing apart is silent in one direction: a value this set allows and the constraint refuses
     * turns a successful redemption into a 500 at commit, which the caller reads as the platform
     * being broken rather than as their input being wrong.
     */
    private static final Set<String> ALL = Set.of(WHATSAPP, SMS, EMAIL, COPY, QR, OTHER);

    /**
     * The stored form of a client-supplied channel, or {@code null} for anything unrecognised.
     *
     * <p>An unknown value is dropped rather than refused. Redemption is the one moment the referral
     * scheme has the referee's attention, and failing it over an advisory analytics field — from a
     * client version that may simply be older than this vocabulary — would cost a real referral to
     * protect a report. The field is nullable precisely so that dropping is available.
     */
    public static String normalise(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim().toLowerCase(java.util.Locale.ROOT);
        return ALL.contains(trimmed) ? trimmed : null;
    }

    /** The admitted values, for tests that must prove this set and the V64 CHECK agree. */
    public static Set<String> all() {
        return ALL;
    }
}
