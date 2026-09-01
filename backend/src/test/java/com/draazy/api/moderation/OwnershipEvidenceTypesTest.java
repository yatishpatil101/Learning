package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.moderation.verification.OwnershipEvidenceTypes;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The rules the ownership gate is made of (D190/Q15), tested without a database because they are
 * arithmetic and a lookup table rather than behaviour.
 *
 * <p>The one that matters is <strong>expiry is measured from the document's issue date</strong>. A
 * ninety-day window applied from the review date instead would look identical in every happy-path
 * flow test — evidence recorded today expires in ninety days either way — and would silently let a
 * decade-old property-tax receipt mint a badge good for another quarter. So it is asserted here
 * with a deliberately old document, where the two readings disagree by years.
 */
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
    @DisplayName("every document type maps to exactly one of the three required facts")
    void everyDocumentTypeMapsToAKind() {
        assertThat(OwnershipEvidenceTypes.DOC_TYPES)
                .allSatisfy(type -> assertThat(OwnershipEvidenceTypes.KINDS)
                        .contains(OwnershipEvidenceTypes.kindOf(type)));

        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.INDEX_II))
                .isEqualTo(OwnershipEvidenceTypes.OWNERSHIP_PROOF);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.AADHAAR))
                .isEqualTo(OwnershipEvidenceTypes.OWNER_IDENTITY);
        assertThat(OwnershipEvidenceTypes.kindOf(OwnershipEvidenceTypes.SITE_PHOTOS))
                .isEqualTo(OwnershipEvidenceTypes.SITE_PRESENCE);
    }

    /**
     * The named cases above spell out each window because the numbers are the product decision. This
     * one exists for the type added later: {@code expiryOf} has its own {@code switch}, and a new
     * entry in {@code DOC_TYPES} that nobody added a branch for would throw here rather than reach
     * the ops desk.
     */
    @Test
    @DisplayName("every document type has a decided validity — no type falls off the switch")
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

    /**
     * D202. Asserted as "which types require a name", over the whole vocabulary, rather than by
     * asking the method about the two types that satisfy it today: restating the implementation's
     * own condition would agree with it however wrong it became, and a seventh doc type quietly
     * joining or leaving the identity kind is exactly the drift worth catching.
     */
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
}
