package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.DealIntent;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.Month;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

// Ownership gate vocabulary: which documents count, what they prove, and for how long.
public final class OwnershipEvidenceTypes {

    private OwnershipEvidenceTypes() {
    }

    public static final String TITLE_PROOF = "title_proof";

    public static final String ADDRESS_PROOF = "address_proof";

    /** A conveyance record consistent with the claimed title. Supporting only. */
    public static final String TITLE_SUPPORT = "title_support";

    /** The person listing it is that somebody. Supporting only. */
    public static final String OWNER_IDENTITY = "owner_identity";

    public static final String AUTHORITY_PROOF = "authority_proof";

    /** The place physically exists and looks like the listing says it does. Supporting only. */
    public static final String SITE_PRESENCE = "site_presence";

    public static final List<String> KINDS =
            List.of(TITLE_PROOF, ADDRESS_PROOF, TITLE_SUPPORT, OWNER_IDENTITY, AUTHORITY_PROOF, SITE_PRESENCE);

    private static final List<Set<String>> REQUIRED_FOR_RENT = List.of(Set.of(ADDRESS_PROOF, TITLE_PROOF));
    private static final List<Set<String>> REQUIRED_FOR_SALE = List.of(Set.of(TITLE_PROOF));

    // Unrecognised intent falls to the safer sale gate.
    public static List<String> requiredKinds(String deal) {
        return requiredKindAlternatives(deal).stream()
                .flatMap(Set::stream)
                .distinct()
                .toList();
    }

    public static List<Set<String>> requiredKindAlternatives(String deal) {
        return DealIntent.RENT.equals(deal) ? REQUIRED_FOR_RENT : REQUIRED_FOR_SALE;
    }

    public static String missingLabel(Set<String> alternatives) {
        if (alternatives.equals(Set.of(ADDRESS_PROOF, TITLE_PROOF))) {
            return "address_or_title_proof";
        }
        return alternatives.stream().findFirst().orElse("evidence");
    }

    public static final String INDEX_II = "index_ii";
    public static final String SALE_DEED = "sale_deed";
    public static final String TAX_RECEIPT = "tax_receipt";
    public static final String ELECTRICITY_BILL = "electricity_bill";
    public static final String SATBARA_7_12 = "satbara_7_12";
    public static final String EIGHT_A_EXTRACT = "eight_a_extract";
    public static final String PROPERTY_CARD = "property_card";
    public static final String SHARE_CERTIFICATE = "share_certificate";
    public static final String POWER_OF_ATTORNEY = "power_of_attorney";
    public static final String AADHAAR = "aadhaar";
    public static final String PAN = "pan";
    public static final String SITE_PHOTOS = "site_photos";

    private static final Duration RECURRING_PROOF_VALIDITY = Duration.ofDays(90);

    private static final Duration LAND_RECORD_VALIDITY = Duration.ofDays(90);

    private static final Duration SITE_PHOTO_VALIDITY = Duration.ofDays(180);

    // validity null means never stale; vaultCategory null means the wizard does not offer it.
    private record Type(String docType, String kind, Duration validity, String vaultCategory) {
    }

    // Single source of truth so a type cannot be known to one lookup and unknown to another.
    private static final List<Type> TYPES = List.of(
            new Type(INDEX_II, TITLE_PROOF, null, "Index II"),
            new Type(SATBARA_7_12, TITLE_PROOF, LAND_RECORD_VALIDITY, "7/12 Extract"),
            new Type(EIGHT_A_EXTRACT, TITLE_PROOF, LAND_RECORD_VALIDITY, "8A Extract"),
            new Type(PROPERTY_CARD, TITLE_PROOF, LAND_RECORD_VALIDITY, "Property Card"),
            new Type(SHARE_CERTIFICATE, TITLE_PROOF, null, "Share Certificate"),
            new Type(SALE_DEED, TITLE_SUPPORT, null, "Sale Deed"),
            new Type(TAX_RECEIPT, ADDRESS_PROOF, RECURRING_PROOF_VALIDITY, "Property Tax Receipt"),
            new Type(ELECTRICITY_BILL, ADDRESS_PROOF, RECURRING_PROOF_VALIDITY, "Electricity Bill"),
            new Type(AADHAAR, OWNER_IDENTITY, null, null),
            new Type(PAN, OWNER_IDENTITY, null, null),
            new Type(POWER_OF_ATTORNEY, AUTHORITY_PROOF, null, "Power of Attorney"),
            new Type(SITE_PHOTOS, SITE_PRESENCE, SITE_PHOTO_VALIDITY, null));

    private static final Map<String, Type> BY_DOC_TYPE =
            TYPES.stream().collect(Collectors.toUnmodifiableMap(Type::docType, t -> t));

    private static final Map<String, String> BY_VAULT_CATEGORY = TYPES.stream()
            .filter(t -> t.vaultCategory() != null)
            .collect(Collectors.toUnmodifiableMap(
                    t -> t.vaultCategory().toLowerCase(Locale.ROOT), Type::docType));

    public static final Set<String> DOC_TYPES = BY_DOC_TYPE.keySet();

    public static boolean isKnown(String docType) {
        return docType != null && DOC_TYPES.contains(docType);
    }

    public static boolean contradicts(String docType, String vaultCategory) {
        if (vaultCategory == null || vaultCategory.isBlank()) {
            return false;
        }
        String labelled = BY_VAULT_CATEGORY.get(vaultCategory.strip().toLowerCase(Locale.ROOT));
        return labelled != null && !labelled.equals(docType);
    }

    // Derived from kind so future identity documents inherit the subject-name rule.
    public static boolean namesASubject(String docType) {
        String kind = kindOf(docType);
        return OWNER_IDENTITY.equals(kind) || AUTHORITY_PROOF.equals(kind);
    }

    // Unknown type here is a bug because callers validate at the boundary.
    public static String kindOf(String docType) {
        return type(docType).kind();
    }

    // Measured from issuedAt, never from review time; null means it does not go stale.
    public static Instant expiryOf(String docType, Instant issuedAt) {
        if (TAX_RECEIPT.equals(docType)) {
            return financialYearEnd(issuedAt);
        }
        Duration validity = type(docType).validity();
        return validity == null ? null : issuedAt.plus(validity);
    }

    private static Instant financialYearEnd(Instant issuedAt) {
        LocalDate issuedOn = issuedAt.atZone(com.draazy.api.common.PlatformTime.IST).toLocalDate();
        int endYear = issuedOn.getMonthValue() >= Month.APRIL.getValue()
                ? issuedOn.getYear() + 1
                : issuedOn.getYear();
        return ZonedDateTime.of(LocalDate.of(endYear, Month.MARCH, 31),
                LocalTime.of(23, 59, 59), com.draazy.api.common.PlatformTime.IST).toInstant();
    }

    public static boolean isRetiredIdentityEvidence(String docType) {
        return AADHAAR.equals(docType) || PAN.equals(docType);
    }

    private static Type type(String docType) {
        Type type = docType == null ? null : BY_DOC_TYPE.get(docType);
        if (type == null) {
            throw new IllegalArgumentException("unknown evidence type: " + docType);
        }
        return type;
    }
}
