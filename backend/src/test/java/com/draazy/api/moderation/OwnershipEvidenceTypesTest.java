package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.moderation.verification.OwnershipEvidenceTypes;
import com.draazy.api.common.PlatformTime;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.Month;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

/** Expiry is measured from the document's ISSUE date, not the review date — the two readings only
 *  disagree on an old document, which is why the fixture is a 2019 one. */
@DisplayName("Ownership evidence — which documents expire, and measured from when")
class OwnershipEvidenceTypesTest {

    private static final Instant LONG_AGO = Instant.parse("2019-04-01T00:00:00Z");

    @ParameterizedTest(name = "{0} expires {1} days after it was ISSUED")
    @MethodSource("windowedDocuments")
    @DisplayName("a dated document expires a fixed window after it was ISSUED, not after it was reviewed")
    void windowedDocumentsExpireFromTheIssueDate(String docType, int days) {
        Instant expiry = OwnershipEvidenceTypes.expiryOf(docType, LONG_AGO);

        assertThat(expiry).isEqualTo(LONG_AGO.plus(days, ChronoUnit.DAYS));
        assertThat(expiry)
                .as("a 2019 %s reviewed today must already be expired — deriving the window "
                        + "from the review date is the whole failure this gate exists to stop", docType)
                .isBefore(Instant.now());
    }

    // Land records can be mutated and a bill goes stale; a building ages slower, hence 180 days.
    static Stream<Arguments> windowedDocuments() {
        return Stream.of(
                Arguments.of(OwnershipEvidenceTypes.ELECTRICITY_BILL, 90),
                Arguments.of(OwnershipEvidenceTypes.SATBARA_7_12, 90),
                Arguments.of(OwnershipEvidenceTypes.EIGHT_A_EXTRACT, 90),
                Arguments.of(OwnershipEvidenceTypes.PROPERTY_CARD, 90),
                Arguments.of(OwnershipEvidenceTypes.SITE_PHOTOS, 180));
    }

    @Test
    @DisplayName("a property tax receipt lasts until the financial year end that contains its issue date")
    void taxReceiptExpiresAtFinancialYearEnd() {
        assertThat(OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.TAX_RECEIPT,
                LocalDate.of(2026, Month.FEBRUARY, 10).atStartOfDay(PlatformTime.IST).toInstant()))
                .isEqualTo(ZonedDateTime.of(LocalDate.of(2026, Month.MARCH, 31),
                        LocalTime.of(23, 59, 59), PlatformTime.IST).toInstant());
        assertThat(OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.TAX_RECEIPT,
                LocalDate.of(2026, Month.APRIL, 1).atStartOfDay(PlatformTime.IST).toInstant()))
                .isEqualTo(ZonedDateTime.of(LocalDate.of(2027, Month.MARCH, 31),
                        LocalTime.of(23, 59, 59), PlatformTime.IST).toInstant());
    }

    @ParameterizedTest(name = "{0} never expires")
    @ValueSource(strings = {"index_ii", "sale_deed", "aadhaar", "pan", "power_of_attorney"})
    @DisplayName("registry, identity and authority documents never expire — the fact they record does not change")
    void registryIdentityAndAuthorityDocumentsDoNotExpire(String docType) {
        assertThat(OwnershipEvidenceTypes.expiryOf(docType, LONG_AGO)).isNull();
    }

    @Test
    @DisplayName("every document type maps to exactly one kind")
    void everyDocumentTypeMapsToAKind() {
        assertThat(OwnershipEvidenceTypes.DOC_TYPES)
                .allSatisfy(type -> assertThat(OwnershipEvidenceTypes.KINDS)
                        .contains(OwnershipEvidenceTypes.kindOf(type)));

        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.INDEX_II))
                .isEqualTo(OwnershipEvidenceTypes.TITLE_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.SATBARA_7_12))
                .isEqualTo(OwnershipEvidenceTypes.TITLE_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.EIGHT_A_EXTRACT))
                .isEqualTo(OwnershipEvidenceTypes.TITLE_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.PROPERTY_CARD))
                .isEqualTo(OwnershipEvidenceTypes.TITLE_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.SHARE_CERTIFICATE))
                .isEqualTo(OwnershipEvidenceTypes.TITLE_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.SALE_DEED))
                .as("a deed is a PDF a reviewer cannot check against anything; Index II is the "
                        + "registry's own extract and can be read back from it")
                .isEqualTo(OwnershipEvidenceTypes.TITLE_SUPPORT);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.ELECTRICITY_BILL))
                .isEqualTo(OwnershipEvidenceTypes.ADDRESS_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.TAX_RECEIPT))
                .isEqualTo(OwnershipEvidenceTypes.ADDRESS_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.AADHAAR))
                .isEqualTo(OwnershipEvidenceTypes.OWNER_IDENTITY);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.POWER_OF_ATTORNEY))
                .isEqualTo(OwnershipEvidenceTypes.AUTHORITY_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.SITE_PHOTOS))
                .isEqualTo(OwnershipEvidenceTypes.SITE_PRESENCE);
    }

    @Test
    @DisplayName("a rental needs address or title proof; a sale needs title proof")
    void requiredKindsFollowTheDeal() {
        assertThat(OwnershipEvidenceTypes.requiredKinds("rent"))
                .containsExactlyInAnyOrder(OwnershipEvidenceTypes.ADDRESS_PROOF, OwnershipEvidenceTypes.TITLE_PROOF);
        assertThat(OwnershipEvidenceTypes.requiredKinds("buy"))
                .containsExactly(OwnershipEvidenceTypes.TITLE_PROOF);
        assertThat(OwnershipEvidenceTypes.requiredKinds("buy"))
                .as("identity, site photos and the deed are supporting evidence, never a gate")
                .doesNotContain(OwnershipEvidenceTypes.OWNER_IDENTITY, OwnershipEvidenceTypes.SITE_PRESENCE,
                        OwnershipEvidenceTypes.TITLE_SUPPORT, OwnershipEvidenceTypes.AUTHORITY_PROOF);
    }

    @Test
    @DisplayName("power of attorney is supporting authority evidence and never part of a badge gate")
    void powerOfAttorneyIsSupportingAuthorityEvidence() {
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.POWER_OF_ATTORNEY))
                .isEqualTo(OwnershipEvidenceTypes.AUTHORITY_PROOF);
        assertThat(OwnershipEvidenceTypes.namesASubject(OwnershipEvidenceTypes.POWER_OF_ATTORNEY)).isTrue();
        assertThat(OwnershipEvidenceTypes.requiredKinds("rent"))
                .doesNotContain(OwnershipEvidenceTypes.AUTHORITY_PROOF);
        assertThat(OwnershipEvidenceTypes.requiredKinds("buy"))
                .doesNotContain(OwnershipEvidenceTypes.AUTHORITY_PROOF);
    }

    @Test
    @DisplayName("only rent takes the shorter gate \u2014 an unrecognised deal takes the sale gate")
    void anUnrecognisedDealTakesTheStricterGate() {
        assertThat(OwnershipEvidenceTypes.requiredKinds("rent"))
                .containsExactlyInAnyOrder(OwnershipEvidenceTypes.ADDRESS_PROOF, OwnershipEvidenceTypes.TITLE_PROOF);

        for (String deal : new String[] {null, "", "lease", "resale", "pg", "BUY"}) {
            assertThat(OwnershipEvidenceTypes.requiredKinds(deal))
                    .as("%s is not the rent intent, so it must need the registry's own extract", deal)
                    .containsExactly(OwnershipEvidenceTypes.TITLE_PROOF);
        }
    }

    @Test
    @DisplayName("every document type has a decided validity — no type falls off the table")
    void everyDocumentTypeHasADecidedValidity() {
        assertThat(OwnershipEvidenceTypes.DOC_TYPES).allSatisfy(type -> {
            Instant expiry = OwnershipEvidenceTypes.expiryOf(type, LONG_AGO);
            assertThat(expiry == null || expiry.isAfter(LONG_AGO))
                    .as("%s must either never expire or expire after it was issued", type)
                    .isTrue();
        });
    }

    @Test
    @DisplayName("an unknown document type is rejected rather than silently given no expiry")
    void unknownTypesAreRejected() {
        assertThatThrownBy(() -> OwnershipEvidenceTypes.expiryOf("notarised_vibes", LONG_AGO))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(OwnershipEvidenceTypes.isKnown("notarised_vibes")).isFalse();
    }

    /** Asserted over the whole vocabulary rather than by asking about today's two types: restating
     *  the implementation's own condition would agree with it however wrong it became. */
    @Test
    @DisplayName("identity and authority documents have to name their subject")
    void identityAndAuthorityDocumentsMustNameTheirSubject() {
        assertThat(OwnershipEvidenceTypes.DOC_TYPES.stream()
                .filter(OwnershipEvidenceTypes::namesASubject)
                .toList())
                .as("a title deed or a photograph does not assert whose it is; identity and authority "
                        + "papers must say whose identity or authority was checked")
                .containsExactlyInAnyOrder(OwnershipEvidenceTypes.AADHAAR, OwnershipEvidenceTypes.PAN,
                        OwnershipEvidenceTypes.POWER_OF_ATTORNEY);
    }

    /** The entry that matters is the one closing {@code title_proof} on a sale: everything else the
     *  vault holds costs a reviewer a second look, this one mints the badge a buyer pays on. */
    @Test
    @DisplayName("a document filed as a bill cannot be recorded as the registry's extract")
    void aMislabelledDocumentCannotCloseTheTitleFact() {
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.INDEX_II, "Electricity Bill"))
                .as("the title leg of a sale badge must not rest on a file the owner filed as a bill")
                .isTrue();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.INDEX_II, "Sale Deed"))
                .as("a deed is TITLE_SUPPORT; recording it as the extract would launder the gate")
                .isTrue();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.TAX_RECEIPT, "Electricity Bill"))
                .as("both establish address proof, but the row names the artefact an investigation "
                        + "has to go and find")
                .isTrue();

        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.INDEX_II, "Index II")).isFalse();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.INDEX_II, "index ii"))
                .as("category is free text the client sends and is matched case-insensitively "
                        + "everywhere else in the vault")
                .isFalse();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.SATBARA_7_12, "7/12 Extract"))
                .isFalse();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.EIGHT_A_EXTRACT, "8A Extract"))
                .isFalse();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.PROPERTY_CARD, "Property Card"))
                .isFalse();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.POWER_OF_ATTORNEY,
                "Power of Attorney")).isFalse();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.SHARE_CERTIFICATE,
                "Share Certificate")).isFalse();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.PROPERTY_CARD, "7/12 Extract"))
                .isTrue();
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.ELECTRICITY_BILL, "  Electricity Bill "))
                .isFalse();
    }

    @Test
    @DisplayName("a label naming no evidence type leaves the decision with the reviewer")
    void anUnrecognisedLabelIsNotAContradiction() {
        for (String label : new String[] {null, "", "   ", "Society NOC",
                "Occupancy Certificate", "Approved Plan Copy"}) {
            assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.INDEX_II, label))
                    .as("%s says nothing about what the file is, and the reviewer has opened it", label)
                    .isFalse();
        }
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.AADHAAR, "Society NOC"))
                .isFalse();
    }
}
