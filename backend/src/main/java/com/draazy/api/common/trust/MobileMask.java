package com.draazy.api.common.trust;

/**
 * The one definition of what a masked mobile number looks like on the wire.
 *
 * <p><strong>Why the shared kernel.</strong> This rule was already duplicated byte-for-byte as a
 * {@code private} method in {@code catalog.property.PropertyMapper} and
 * {@code leads.contact.ContactMapper}, with a comment in each asking the other to stay in sync. Slice
 * 4 adds four more trust surfaces ({@code Offer.from}, {@code Deal.counterparty}, {@code Visit.visitor},
 * {@code FinalizationRequest.initiator}/{@code counterparty}), so the choice was six hand-maintained
 * copies of a security rule or one. Masking is exactly the kind of rule that must not be allowed to
 * drift: two surfaces disagreeing about how many digits survive is a slow leak that no single test
 * would catch.
 *
 * <p>It lives beside {@link ContactGate} because it is the same concern — the gate decides
 * <em>whether</em> to reveal, this decides what the <em>unrevealed</em> form looks like — and because
 * the kernel is the only place every feature may import from ({@code package-structure.md} §5).
 *
 * <p><strong>Callers must keep wrapping it in a {@code private} mapper method.</strong> A MapStruct
 * mapper that exposes a {@code String → String} method invites the generator to adopt it as an
 * implicit converter and silently apply it to unrelated string fields. Referencing this class from a
 * {@code private} helper keeps the carve-out hand-written and explicit, per {@code api-standards.md}
 * §8.1.
 */
public final class MobileMask {

    private MobileMask() {
    }

    /** Digits kept at the front of a masked number. */
    private static final int PREFIX_KEPT = 2;

    /** Index at which the kept suffix begins, leaving three trailing digits. */
    private static final int SUFFIX_FROM = 7;

    /** Length of a mobile this class is willing to mask. */
    private static final int MOBILE_LENGTH = 10;

    /** The opaque middle of a masked number. */
    private static final String INFIX = "XXXXX";

    /**
     * Reduce a caller-supplied mobile to the 10-digit form the platform stores, or {@code null} if
     * it is not one.
     *
     * <p><strong>Why this lives here and not in each feature.</strong> Three separate
     * digit-stripping helpers had appeared ({@code VerificationService.digits}, this class,
     * and a third in the deals service), each with slightly different leniency; the other two have
     * since been routed through this normaliser (Q1), so there is now one spelling of the rule. That
     * drift is precisely the shape of the contact-gate defect this project already shipped and fixed
     * on the client: a masked number, {@code 98XXXXX210}, strips to the digits {@code 98210}, which
     * is short but entirely plausible — so a lenient "just take the trailing digits" rule silently
     * accepts a mask as if it were a real identity, and any two owners sharing a first-two/last-three
     * pattern collapse onto the same value.
     *
     * <p>So this fails closed. Exactly ten digits after punctuation is stripped, or {@code null}.
     * A leading country code is accepted ({@code +91 98210 00123} → {@code 9821000123}) because
     * that is a normal way to type a number; anything shorter is rejected outright rather than
     * padded, truncated or stored as-is. Callers must treat {@code null} as invalid input, never as
     * "store whatever we got".
     *
     * @param mobile a raw mobile as typed, or {@code null}
     * @return the canonical 10 digits, or {@code null} if the input is not a whole mobile
     */
    public static String normalise(String mobile) {
        if (mobile == null) {
            return null;
        }
        String digits = mobile.replaceAll("\\D", "");
        // Tolerate a country code, but only a country code: +91 and 0091 are the forms Indian
        // users actually type. Anything else long is a typo, not a prefix, and is rejected.
        if (digits.length() > MOBILE_LENGTH) {
            String tail = digits.substring(digits.length() - MOBILE_LENGTH);
            String prefix = digits.substring(0, digits.length() - MOBILE_LENGTH);
            if (!prefix.equals("91") && !prefix.equals("091") && !prefix.equals("0091")
                    && !prefix.equals("0")) {
                return null;
            }
            digits = tail;
        }
        return digits.length() == MOBILE_LENGTH ? digits : null;
    }

    /**
     * Mask a 10-digit mobile to the contract form {@code 98XXXXX210} — first two and last three
     * digits kept, the middle five replaced.
     *
     * <p>Deliberately <em>not</em> lenient: anything that is not a clean 10-digit number returns
     * {@code null} rather than a best-effort partial mask. A half-masked string is worse than no
     * string at all, because it looks like a successful mask while leaking more than intended.
     *
     * <p>The client renders this into the prettier {@code +91 98••• •••10} form itself; the server
     * never sends that shape. Note the frontend treats a value of this form as "identity unknown" —
     * it deliberately cannot be reversed into a usable key, since two different owners can mask to
     * the same string.
     *
     * @param mobile a raw mobile, possibly containing spaces or punctuation, or {@code null}
     * @return the masked form, or {@code null} if the input is absent or not exactly 10 digits
     */
    public static String mask(String mobile) {
        if (mobile == null) {
            return null;
        }
        String digits = mobile.replaceAll("\\D", "");
        if (digits.length() != MOBILE_LENGTH) {
            return null;
        }
        return digits.substring(0, PREFIX_KEPT) + INFIX + digits.substring(SUFFIX_FROM);
    }

    /**
     * Reveal or mask in one call, so a caller cannot accidentally invert the condition.
     *
     * <p>Every slice-4 mapper embeds a {@code Party} whose mobile is gated, and each one would
     * otherwise repeat {@code visibility == REVEALED ? raw : mask(raw)}. Writing that ternary six
     * times is six chances to write {@code !=}.
     *
     * @param mobile     the raw mobile from the entity
     * @param visibility the decision already taken by {@link ContactGate}
     * @return the raw mobile only when {@code visibility} is {@link ContactVisibility#REVEALED}
     */
    public static String applyTo(String mobile, ContactVisibility visibility) {
        return visibility == ContactVisibility.REVEALED ? mobile : mask(mobile);
    }
}
