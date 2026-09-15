package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.moderation.verification.OwnershipEvidenceTypes;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Expiry is measured from the document's ISSUE date, not the review date — the two readings only
 *  disagree on an old document, which is why the fixture is a 2019 one. */
@DisplayName("Ownership evidence — which documents expire, and measured from when")
class OwnershipEvidenceTypesTest {

    private static final Instant LONG_AGO = Instant.parse("2019-04-01T00:00:00Z");

    @Test
    @DisplayName("a recurring proof expires 90 days after it was ISSUED, not after it was reviewed")
    void recurringProofExpiresFromTheIssueDate() {
        Instant expiry = OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.TAX_RECEIPT, LONG_AGO);

        assertThat(expiry).isEqualTo(LONG_AGO.plus(90, ChronoUnit.DAYS));
        assertThat(expiry)
                .as("a 2019 receipt reviewed today must already be expired — deriving the window "
                        + "from the review date is the whole failure this gate exists to stop")
                .isBefore(Instant.now());
    }

    @Test
    @DisplayName("site photos get the longer 180-day window — a building ages slower than a bill")
    void sitePhotosGetTheLongerWindow() {
        assertThat(OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.SITE_PHOTOS, LONG_AGO))
                .isEqualTo(LONG_AGO.plus(180, ChronoUnit.DAYS));
    }

    @Test
    @DisplayName("registry and identity documents never expire — the fact they record does not change")
    void registryAndIdentityDocumentsDoNotExpire() {
        assertThat(OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.INDEX_II, LONG_AGO)).isNull();
        assertThat(OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.SALE_DEED, LONG_AGO)).isNull();
        assertThat(OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.AADHAAR, LONG_AGO)).isNull();
        assertThat(OwnershipEvidenceTypes.expiryOf(OwnershipEvidenceTypes.PAN, LONG_AGO)).isNull();
    }

    @Test
    @DisplayName("every document type maps to exactly one kind")
    void everyDocumentTypeMapsToAKind() {
        assertThat(OwnershipEvidenceTypes.DOC_TYPES)
                .allSatisfy(type -> assertThat(OwnershipEvidenceTypes.KINDS)
                        .contains(OwnershipEvidenceTypes.kindOf(type)));

        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.INDEX_II))
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
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.SITE_PHOTOS))
                .isEqualTo(OwnershipEvidenceTypes.SITE_PRESENCE);
    }

    @Test
    @DisplayName("a rental needs only address proof; a sale needs the registry extract as well")
    void requiredKindsFollowTheDeal() {
        assertThat(OwnershipEvidenceTypes.requiredKinds("rent"))
                .containsExactly(OwnershipEvidenceTypes.ADDRESS_PROOF);
        assertThat(OwnershipEvidenceTypes.requiredKinds("buy"))
                .containsExactly(OwnershipEvidenceTypes.TITLE_PROOF, OwnershipEvidenceTypes.ADDRESS_PROOF);
        assertThat(OwnershipEvidenceTypes.requiredKinds("buy"))
                .as("identity, site photos and the deed are supporting evidence, never a gate")
                .doesNotContain(OwnershipEvidenceTypes.OWNER_IDENTITY, OwnershipEvidenceTypes.SITE_PRESENCE,
                        OwnershipEvidenceTypes.TITLE_SUPPORT);
    }

    /** Asks the question the gate asks, so a later edit that re-admitted the deed by adding
     *  {@code TITLE_SUPPORT} to the sale's required kinds fails here. */
    @Test
    @DisplayName("a sale deed plus a bill leaves the title fact unmet \u2014 only Index II closes it")
    void aSaleDeedCannotStandInForIndexII() {
        List<String> deedAndBillCover = List.of(
                OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.SALE_DEED),
                OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.ELECTRICITY_BILL));
        assertThat(deedAndBillCover.containsAll(OwnershipEvidenceTypes.requiredKinds("buy")))
                .as("a deed and a bill cover %s and %s, which must not be the whole required set",
                        OwnershipEvidenceTypes.TITLE_SUPPORT, OwnershipEvidenceTypes.ADDRESS_PROOF)
                .isFalse();
    }

    /** A permissive default would not announce itself: add a third intent and every sale-class
     *  listing becomes grantable on one electricity bill. */
    @Test
    @DisplayName("only rent takes the shorter gate \u2014 an unrecognised deal takes the sale gate")
    void anUnrecognisedDealTakesTheStricterGate() {
        assertThat(OwnershipEvidenceTypes.requiredKinds("rent"))
                .containsExactly(OwnershipEvidenceTypes.ADDRESS_PROOF);

        for (String deal : new String[] {null, "", "lease", "resale", "pg", "BUY"}) {
            assertThat(OwnershipEvidenceTypes.requiredKinds(deal))
                    .as("%s is not the rent intent, so it must need the registry's own extract", deal)
                    .contains(OwnershipEvidenceTypes.TITLE_PROOF);
        }
    }

    /** For the type added later: one reachable by {@code DOC_TYPES} with no validity in the table
     *  throws here rather than on the ops desk's next read of a case file. */
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
    @DisplayName("exactly the identity documents have to name whose identity they are")
    void onlyIdentityDocumentsMustNameTheirSubject() {
        assertThat(OwnershipEvidenceTypes.DOC_TYPES.stream()
                .filter(OwnershipEvidenceTypes::namesASubject)
                .toList())
                .as("a title deed or a photograph does not assert whose it is; a government ID's "
                        + "whole purpose is to, and a row that records one without a name cannot be "
                        + "contradicted by anything")
                .containsExactlyInAnyOrder(OwnershipEvidenceTypes.AADHAAR, OwnershipEvidenceTypes.PAN);
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
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.ELECTRICITY_BILL, "  Electricity Bill "))
                .isFalse();
    }

    /** Why this is a contradiction check and not an allowlist: most of the wizard's vocabulary names
     *  no evidence type, and refusing on an unrecognised label would take the gate offline. */
    @Test
    @DisplayName("a label naming no evidence type leaves the decision with the reviewer")
    void anUnrecognisedLabelIsNotAContradiction() {
        for (String label : new String[] {null, "", "   ", "Society NOC", "Share Certificate",
                "Occupancy Certificate", "Approved Plan Copy"}) {
            assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.INDEX_II, label))
                    .as("%s says nothing about what the file is, and the reviewer has opened it", label)
                    .isFalse();
        }
        assertThat(OwnershipEvidenceTypes.contradicts(OwnershipEvidenceTypes.AADHAAR, "Society NOC"))
                .isFalse();
    }
}
