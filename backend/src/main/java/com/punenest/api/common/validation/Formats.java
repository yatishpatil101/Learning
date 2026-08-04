package com.punenest.api.common.validation;

/**
 * Shared input formats — the regex and the sentence that explains it, together (tech debt D25).
 *
 * <p><strong>The problem it closes.</strong> The OpenAPI document defines <em>one</em>
 * {@code Mobile} schema, {@code $ref}'d by 21 fields. Java re-spelled the same regex at nine call
 * sites with <strong>three different messages</strong> — "must be a 10-digit Indian mobile number",
 * "must be a valid 10-digit mobile" and "invalid mobile". A caller integrating against the platform
 * therefore saw the same rejection described three ways depending on which endpoint they hit, which
 * makes the 422 body impossible to key on and makes the platform look like three platforms.
 *
 * <p><strong>Why the pattern and the message are one file and not two.</strong> §2 of the tech-debt
 * register sketched a separate {@code ValidationMessages}. Splitting them is what lets them drift:
 * the message exists only to say in English what the regex says in symbols, so the moment they live
 * apart, changing one and not the other is a one-line mistake nothing catches. Paired constants are
 * already the house style — see {@code PropertyPossession}, {@code Furnishing}, {@code DealIntent}.
 *
 * <p><strong>Why only mobile lives here.</strong> The register's admission criteria are: used by ≥2
 * bounded contexts, defined by the spec, and dependency-free. Mobile passes on all three (identity,
 * deals, leads, documents, catalog and moderation all spell it). PAN, Aadhaar, IFSC and bank account
 * number each appear at exactly <em>one</em> site, so hoisting them would create the dumping ground
 * the criteria exist to prevent — and would put {@code OwnerKycUpdateRequest}'s rules somewhere
 * other than {@code identity.kyc}, where they belong. They move here the day a second caller needs
 * them, not before.
 *
 * <p><strong>What this deliberately is not.</strong> D23's composed {@code @Constraint}
 * meta-annotation ({@code @IndianMobile}) is still outstanding and still blocked on open question
 * Q1 — {@code MobileMask.normalise()} accepts {@code +91 9821000123} while this pattern rejects it,
 * and the annotation cannot be written until the platform decides which of the two is right. D25 is
 * separable from that and was never actually blocked by it: whatever Q1 decides, there should be one
 * spelling of the rule, and having one now turns the eventual Q1 change from nine edits into one.
 */
public final class Formats {

    private Formats() {
    }

    /**
     * An Indian mobile number as the contract defines it — ten digits, first in 6–9.
     *
     * <p>Kept byte-identical to the spec's {@code Mobile} schema. If the two ever disagree the spec
     * wins, and {@code validate_spec.py} is not the thing that will notice, so the pairing is worth
     * checking by eye when either changes.
     */
    public static final String MOBILE = "^[6-9][0-9]{9}$";

    /**
     * Says what is wrong and what would be right, and nothing else. It deliberately omits the value
     * the caller sent: a 422 body is logged, and a mobile number in a log is personal data nobody
     * chose to put there.
     */
    public static final String MOBILE_MESSAGE = "must be a 10-digit Indian mobile number";
}
