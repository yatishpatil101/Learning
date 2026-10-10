package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

@DisplayName("FlatmateReview — re-opening after an edit")
class FlatmateReviewTest {

    private static final LocalDate VALID_TILL = LocalDate.of(2027, 3, 31);

    private static FlatmateReview legacyReview() {
        return new FlatmateReview("room", UUID.randomUUID(), null, UUID.randomUUID(), "Baner",
                FlatmateVocabulary.TIER_TENANT, false, true,
                Map.of("id", "doc-1", "dataUrl", "data:application/pdf;base64,JVBERi0xLjQK"),
                new AgreementRegistration(VALID_TILL),
                null);
    }

    private static Stream<Arguments> reopenedAgreements() {
        return Stream.of(
                Arguments.of("keeps a legacy expiry while the same stored agreement stays attached",
                        Map.of("id", "doc-1"), VALID_TILL),
                Arguments.of("drops the expiry once a different agreement replaces the file",
                        Map.of("id", "doc-2", "dataUrl", "data:application/pdf;base64,JVBERi0xLjQK"),
                        null));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("reopenedAgreements")
    @DisplayName("the expiry follows the stored agreement file")
    void expiryFollowsTheFile(String name, Map<String, Object> agreement, LocalDate validTill) {
        FlatmateReview review = legacyReview();

        review.reopenAfterEdit("Baner", FlatmateVocabulary.TIER_TENANT, false, true,
                agreement, new AgreementRegistration(), null);

        assertThat(review.getAgreement().getValidTill()).isEqualTo(validTill);
    }
}
