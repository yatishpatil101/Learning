package com.draazy.api.moderation.verification;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * The vocabulary of the ownership gate (D190/Q15): which documents count, what each one proves, and
 * how long it proves it for.
 *
 * <p><strong>Three kinds, not one list.</strong> The badge asserts three independent facts —
 * somebody owns this property, the person listing it is that somebody, and the place physically
 * exists. A checklist of seven documents can be two-thirds satisfied and still look like progress;
 * grouping them says which of the three is missing, which is the only question ops asks. All three
 * are required, because any one of them missing makes the badge a false statement rather than a
 * weaker one: title without identity is a broker with a photocopy, identity without title is a
 * tenant, and both without photos is a flat that may not exist.
 *
 * <p><strong>Why some documents expire and some do not.</strong> A registration record and a
 * government identity document record a fact that does not change — a sale deed from 2016 proves
 * ownership in 2016 and, absent a later sale, today. A property-tax receipt or an electricity bill
 * proves only that the person was paying for the property at the time it was issued, which is
 * exactly why they are useful as <em>recurring</em> proof and exactly why they go stale. Site
 * photographs sit between: the building does not vanish, but the listing's claim that this is that
 * building decays as the photographs age.
 *
 * <p>Every window is measured from the document's own issue date, never from the review. That is
 * the whole point of the gate — reviewing a 2019 tax receipt this morning must not mint a badge
 * good until 2026.
 *
 * <p>Strings rather than a Java enum, matching {@code PropertyStatus} and the rest of the wire
 * vocabulary in this tree: the value is persisted, appears in the contract, and is checked by the
 * database, so a rename here without a migration should be a compile error nowhere and a data
 * mismatch everywhere — which is what the {@code CHECK} constraint in V63 catches.
 */
public final class OwnershipEvidenceTypes {

    private OwnershipEvidenceTypes() {
    }

    /** Somebody owns this property. */
    public static final String OWNERSHIP_PROOF = "ownership_proof";

    /** The person listing it is that somebody. */
    public static final String OWNER_IDENTITY = "owner_identity";

    /** The place physically exists and looks like the listing says it does. */
    public static final String SITE_PRESENCE = "site_presence";

    /** The three facts, in the order ops collects them. All are required. */
    public static final List<String> KINDS = List.of(OWNERSHIP_PROOF, OWNER_IDENTITY, SITE_PRESENCE);

    public static final String INDEX_II = "index_ii";
    public static final String SALE_DEED = "sale_deed";
    public static final String TAX_RECEIPT = "tax_receipt";
    public static final String ELECTRICITY_BILL = "electricity_bill";
    public static final String AADHAAR = "aadhaar";
    public static final String PAN = "pan";
    public static final String SITE_PHOTOS = "site_photos";

    /** Mirrors the {@code doc_type} CHECK constraint in V63. */
    public static final Set<String> DOC_TYPES = Set.of(
            INDEX_II, SALE_DEED, TAX_RECEIPT, ELECTRICITY_BILL, AADHAAR, PAN, SITE_PHOTOS);

    /** A bill or receipt proves who was paying, and only for as long as that stays current. */
    private static final Duration RECURRING_PROOF_VALIDITY = Duration.ofDays(90);

    /** Photographs age out slower than a bill but do age out. */
    private static final Duration SITE_PHOTO_VALIDITY = Duration.ofDays(180);

    public static boolean isKnown(String docType) {
        return docType != null && DOC_TYPES.contains(docType);
    }

    /**
     * Does this document have to say whose identity it is (D202)?
     *
     * <p>True for exactly the {@link #OWNER_IDENTITY} documents, whose entire purpose is to name a
     * person: a row recording that an Aadhaar was sighted, without recording whose, asserts nothing
     * a later dispute can test. Deliberately derived from the kind rather than listed again, so a
     * fourth identity document added to {@link #kindOf} inherits the rule instead of quietly
     * escaping it. Mirrors the CHECK in V66.
     */
    public static boolean namesASubject(String docType) {
        return OWNER_IDENTITY.equals(kindOf(docType));
    }

    /**
     * Which of the three facts this document establishes.
     *
     * @throws IllegalArgumentException if the type is not one of {@link #DOC_TYPES}; callers
     *         validate at the boundary, so reaching this is a bug rather than bad input
     */
    public static String kindOf(String docType) {
        return switch (docType) {
            case INDEX_II, SALE_DEED, TAX_RECEIPT, ELECTRICITY_BILL -> OWNERSHIP_PROOF;
            case AADHAAR, PAN -> OWNER_IDENTITY;
            case SITE_PHOTOS -> SITE_PRESENCE;
            case null, default -> throw new IllegalArgumentException("unknown evidence type: " + docType);
        };
    }

    /**
     * When this document stops proving what it proves.
     *
     * @param issuedAt when the document was issued or the photographs taken — <em>not</em> when ops
     *                 reviewed it
     * @return the expiry instant, or {@code null} for the registry and identity documents that do
     *         not go stale
     */
    public static Instant expiryOf(String docType, Instant issuedAt) {
        Duration validity = switch (docType) {
            case TAX_RECEIPT, ELECTRICITY_BILL -> RECURRING_PROOF_VALIDITY;
            case SITE_PHOTOS -> SITE_PHOTO_VALIDITY;
            case INDEX_II, SALE_DEED, AADHAAR, PAN -> null;
            case null, default -> throw new IllegalArgumentException("unknown evidence type: " + docType);
        };
        return validity == null ? null : issuedAt.plus(validity);
    }
}
