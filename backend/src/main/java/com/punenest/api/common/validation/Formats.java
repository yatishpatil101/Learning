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
 * <p><strong>What this deliberately is not.</strong> This is the <em>storage</em> shape, not the
 * input rule. Q1 (closed 2026-08-09) settled that: {@code @IndianMobile} normalises tolerated input
 * (spacing, a {@code +91}/{@code 0091}/{@code 0} prefix) via {@code MobileMask.normalise()} and then
 * gates the result against this pattern, so the value that reaches persistence always matches here
 * even though {@code +91 9821000123} is accepted at the edge. Keeping the regex and its message
 * paired (D25) is what let that change land as one edit rather than nine.
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
