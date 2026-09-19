package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeout;

import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Tested directly rather than through an endpoint, since the interesting cases are all about characters. Over-rejection
 * is the failure that reaches a real person — an innocent owner told off for a phone number they did not write.
 */
@DisplayName("No contact details in prose — and no false alarms on an ordinary price")
class NoContactDetailsTest {

    private final NoContactDetails.Validator validator = new NoContactDetails.Validator();

    private boolean accepts(String text) {
        return validator.isValid(text, null);
    }

    /**
     * The price is the trap: an Indian-grouped figure beside an area is a long digit run held apart by punctuation,
     * and a scanner that strips it reads "65,00,000 / 750" as the mobile-shaped 6500000750.
     */
    @ParameterizedTest
    @ValueSource(strings = {
        "2 BHK in Kothrud — \u20b965,00,000 / 750 sq.ft",
        "Spacious 3 BHK, 1,250 sq.ft, 4th floor of 12",
        "Shop 450 sq.ft | \u20b912,00,000 | Baner Road",
        "Plot 2400 sq.ft, \u20b955,00,000, clear title",
        "Row house 1800 sq.ft \u2014 \u20b91,10,00,000 negotiable",
    })
    void anOrdinaryPriceIsNotAPhoneNumber(String title) {
        assertThat(accepts(title))
                .as("a legitimate listing was refused as if it carried a contact number: %s", title)
                .isTrue();
    }

    /**
     * The non-breaking space matters most in practice: it is what a paste out of WhatsApp Web or Word leaves
     * behind, so it arrives with nobody intending to evade anything and carries a real number onto a public page.
     */
    @ParameterizedTest
    @ValueSource(strings = {
        "2 BHK Kothrud, call 9876543210",
        "Call 98765 43210 for a visit",
        "Owner 9 8 7 6 5 4 3 2 1 0",
        "Ring +91-98765-43210",
        "Direct owner 9876\u00a0543210",
        "Contact \u096f\u096e\u096d\u096c\u096b\u096a\u0969\u0968\u0967\u0966",
        "WhatsApp \uff19\uff18\uff17\uff16\uff15\uff14\uff13\uff12\uff11\uff10",
    })
    void aMobileIsRefusedHoweverItIsDressed(String title) {
        assertThat(accepts(title))
                .as("a contact number reached the public page: %s", title)
                .isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "Mail me at owner@example.com",
        "Reach owner (at) example (dot) com",
        "owner at example dot com",
    })
    void anEmailIsRefusedSpelledOutOrNot(String text) {
        assertThat(accepts(text))
                .as("an email address reached the public page: %s", text)
                .isFalse();
    }

    /**
     * Absence is not a violation. A blank field is the business of {@code @NotBlank}, and having two
     * annotations answer for the same emptiness produces two messages for one mistake.
     */
    @ParameterizedTest
    @ValueSource(strings = {"", "   "})
    void emptinessIsSomebodyElsesConstraint(String text) {
        assertThat(accepts(text)).isTrue();
    }

    @Test
    void nullIsSomebodyElsesConstraint() {
        assertThat(accepts(null)).isTrue();
    }

    /**
     * The possessive local part is pinned from both sides because a wrong possessive is invisible — it stops
     * matching rather than throwing. Bean Validation is not fail-fast, so a 4,000-character run must not hang.
     */
    @Test
    void aLongRunWithNoSeparatorStillFinishesPromptly() {
        String prose = ("Well-maintained office in Baner with covered parking and a backup DG set. ")
                .repeat(54); // ~4,000 chars: the @Size ceiling on description
        assertTimeout(Duration.ofSeconds(2), () -> assertThat(accepts(prose)).isTrue());
    }

    @Test
    void aLongLocalPartIsStillAnEmail() {
        assertThat(accepts("write to " + "owner".repeat(20) + "@example.com")).isFalse();
    }
}
