package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.DealIntent;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The vocabulary of the ownership gate: which documents count, what each one proves, and how long
 * it proves it for. Rationale: docs/flows/admin/property-verification.md#ownership-evidence-vocabulary.
 */
public final class OwnershipEvidenceTypes {

    private OwnershipEvidenceTypes() {
    }

    /** The registry's own extract says this person holds the title. */
    public static final String TITLE_PROOF = "title_proof";

    /** A current bill or receipt for this address is in the lister's name. */
    public static final String ADDRESS_PROOF = "address_proof";

    /** A conveyance record consistent with the claimed title. Supporting only. */
    public static final String TITLE_SUPPORT = "title_support";

    /** The person listing it is that somebody. Supporting only. */
    public static final String OWNER_IDENTITY = "owner_identity";

    /** The place physically exists and looks like the listing says it does. Supporting only. */
    public static final String SITE_PRESENCE = "site_presence";

    /** Every kind the case file can hold, in the order ops collects them. */
    public static final List<String> KINDS =
            List.of(TITLE_PROOF, ADDRESS_PROOF, TITLE_SUPPORT, OWNER_IDENTITY, SITE_PRESENCE);

    private static final List<String> REQUIRED_FOR_RENT = List.of(ADDRESS_PROOF);
    private static final List<String> REQUIRED_FOR_SALE = List.of(TITLE_PROOF, ADDRESS_PROOF);

    /**
     * Which facts the badge needs for this deal; anything not listed is supporting evidence. Only a
     * rent listing takes the shorter gate — any unrecognised intent falls to the safer sale gate.
     */
    public static List<String> requiredKinds(String deal) {
        return DealIntent.RENT.equals(deal) ? REQUIRED_FOR_RENT : REQUIRED_FOR_SALE;
    }

    public static final String INDEX_II = "index_ii";
    public static final String SALE_DEED = "sale_deed";
    public static final String TAX_RECEIPT = "tax_receipt";
    public static final String ELECTRICITY_BILL = "electricity_bill";
    public static final String AADHAAR = "aadhaar";
    public static final String PAN = "pan";
    public static final String SITE_PHOTOS = "site_photos";

    /** A bill or receipt proves who was paying, and only for as long as that stays current. */
    private static final Duration RECURRING_PROOF_VALIDITY = Duration.ofDays(90);

    /** Photographs age out slower than a bill but do age out. */
    private static final Duration SITE_PHOTO_VALIDITY = Duration.ofDays(180);

    /**
     * One document type, stated once. {@code validity} is null when the type never goes stale;
     * {@code vaultCategory} is null for types the listing wizard does not offer.
     */
    private record Type(String docType, String kind, Duration validity, String vaultCategory) {
    }

    /**
     * The single table the rest of this class is derived from, so a type cannot be known to one
     * lookup and unknown to another.
     */
    private static final List<Type> TYPES = List.of(
            new Type(INDEX_II, TITLE_PROOF, null, "Index II"),
            new Type(SALE_DEED, TITLE_SUPPORT, null, "Sale Deed"),
            new Type(TAX_RECEIPT, ADDRESS_PROOF, RECURRING_PROOF_VALIDITY, "Property Tax Receipt"),
            new Type(ELECTRICITY_BILL, ADDRESS_PROOF, RECURRING_PROOF_VALIDITY, "Electricity Bill"),
            new Type(AADHAAR, OWNER_IDENTITY, null, null),
            new Type(PAN, OWNER_IDENTITY, null, null),
            new Type(SITE_PHOTOS, SITE_PRESENCE, SITE_PHOTO_VALIDITY, null));

    private static final Map<String, Type> BY_DOC_TYPE =
            TYPES.stream().collect(Collectors.toUnmodifiableMap(Type::docType, t -> t));

    /** Lower-cased: {@code documents.category} is free text the client sends, and is matched
     * case-insensitively elsewhere in the vault too. */
    private static final Map<String, String> BY_VAULT_CATEGORY = TYPES.stream()
            .filter(t -> t.vaultCategory() != null)
            .collect(Collectors.toUnmodifiableMap(
                    t -> t.vaultCategory().toLowerCase(Locale.ROOT), Type::docType));

    /** Mirrors the {@code doc_type} CHECK constraint in V63. */
    public static final Set<String> DOC_TYPES = BY_DOC_TYPE.keySet();

    public static boolean isKnown(String docType) {
        return docType != null && DOC_TYPES.contains(docType);
    }

    /**
     * Does the document's own label say it is something other than what is being recorded? A
     * contradiction, not an absence — an unrecognised label leaves the judgement with the reviewer.
     */
    public static boolean contradicts(String docType, String vaultCategory) {
        if (vaultCategory == null || vaultCategory.isBlank()) {
            return false;
        }
        String labelled = BY_VAULT_CATEGORY.get(vaultCategory.strip().toLowerCase(Locale.ROOT));
        return labelled != null && !labelled.equals(docType);
    }

    /**
     * Does this document have to say whose identity it is? Derived from the kind, not listed again,
     * so a fourth identity document inherits the rule. Mirrors the CHECK in V66.
     */
    public static boolean namesASubject(String docType) {
        return OWNER_IDENTITY.equals(kindOf(docType));
    }

    /**
     * Which fact this document establishes. Callers validate at the boundary, so an unknown type
     * reaching here is a bug rather than bad input.
     */
    public static String kindOf(String docType) {
        return type(docType).kind();
    }

    /**
     * When this document stops proving what it proves, measured from {@code issuedAt} and never from
     * the review. Null for the registry and identity documents that do not go stale.
     */
    public static Instant expiryOf(String docType, Instant issuedAt) {
        Duration validity = type(docType).validity();
        return validity == null ? null : issuedAt.plus(validity);
    }

    private static Type type(String docType) {
        Type type = docType == null ? null : BY_DOC_TYPE.get(docType);
        if (type == null) {
            throw new IllegalArgumentException("unknown evidence type: " + docType);
        }
        return type;
    }
}
