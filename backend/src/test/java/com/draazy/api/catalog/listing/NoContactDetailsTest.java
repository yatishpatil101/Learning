package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeout;

import java.time.Duration;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

@DisplayName("No contact details in prose — and no false alarms on an ordinary price")
class NoContactDetailsTest {

    private final NoContactDetails.Validator validator = new NoContactDetails.Validator();

    private boolean accepts(String text) {
        return validator.isValid(text, null);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "2 BHK in Kothrud \u2014 \u20b965,00,000 / 750 sq.ft",
        "Spacious 3 BHK, 1,250 sq.ft, 4th floor of 12",
        "Shop 450 sq.ft | \u20b912,00,000 | Baner Road",
        "Plot 2400 sq.ft, \u20b955,00,000, clear title",
        "Row house 1800 sq.ft \u2014 \u20b91,10,00,000 negotiable",
        "Expected rent 65000 - 70000 depending on furnishing",
        "Rent 65000 | 70000 negotiable",
        "Deposit 60000-90000, maintenance extra",
    })
    void anOrdinaryPriceIsNotAPhoneNumber(String title) {
        assertThat(accepts(title))
                .as("a legitimate listing was refused as if it carried a contact number: %s", title)
                .isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "2 BHK Kothrud, call 9876543210",
        "Call 98765 43210 for a visit",
        "Owner 9 8 7 6 5 4 3 2 1 0",
        "Ring +91-98765-43210",
        "Call 98765 - 43210 after six",
        "Direct owner 9876\u00a0543210",
        "Contact \u096f\u096e\u096d\u096c\u096b\u096a\u0969\u0968\u0967\u0966",
        "WhatsApp \uff19\uff18\uff17\uff16\uff15\uff14\uff13\uff12\uff11\uff10",
        "Call 98765\u200b43210",
        "Call 9876\u00ad543210",
        "Call 9\ufe0f\u20e38765 43210",
        "Call 98765*43210",
        "Call 98765:43210",
        "Call 98765|43210",
        "Call 98'765'43210",
        "Owner \u277e\u277d\u277c\u277b\u277a\u2779\u2778\u2777\u2776\u24ff",
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
        "owner at example.in",
        "rahul at the rate gmail dot com",
        "rahul at gmail",
        "rahul @ gmail",
        "rahul@yahoo",
        "owner\u200b@example.com",
        "ravi\u2028@\u2028gmail.com",
        "ravi\u1680@\u1680gmail.com",
    })
    void anEmailIsRefusedSpelledOutOrNot(String text) {
        assertThat(accepts(text))
                .as("an email address reached the public page: %s", text)
                .isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "2 BHK flat at Baner. Contact us through Draazy",
        "Located at Aundh. In a gated society",
        "Shop at FC Road. Company-owned lease",
        "Society is dotted with trees at Kothrud. Info on request",
        "Rent @ 25k.Deposit two months",
        "2BHK @ Baner.Near the metro",
    })
    void aSentenceWithAtIsNotAnEmail(String text) {
        assertThat(accepts(text))
                .as("ordinary prose was refused as an email: %s", text)
                .isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "WhatsApp wa.me/919876543210",
        "Chat on t.me/owner_baner",
        "See instagram.com/baner.flats",
        "Message me on fb.me/owner",
        "Insta: @baner_flats",
        "telegram id @ownerbaner",
    })
    void aMessagingLinkOrHandleIsRefused(String text) {
        assertThat(accepts(text))
                .as("an off-platform contact route reached the public page: %s", text)
                .isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "Call nine eight seven six five four three two one zero",
        "Owner nine eight seven six five 4 3 2 1 0",
        "Call nine double eight seven six five four three two one",
        "Call nine double-eight seven six five four three two one",
        "Phone \u0928\u094c \u0906\u0920 \u0938\u093e\u0924 \u091b\u0939 \u092a\u093e\u0902\u091a \u091a\u093e\u0930 \u0924\u0940\u0928 \u0926\u094b \u090f\u0915 \u0936\u0942\u0928\u094d\u092f",
        "\u0928\u090a \u0906\u0920 \u0938\u093e\u0924 \u0938\u0939\u093e \u092a\u093e\u091a \u091a\u093e\u0930 \u0924\u0940\u0928 \u0926\u094b\u0928 \u090f\u0915 \u0936\u0942\u0928\u094d\u092f \u0935\u0930 \u092b\u094b\u0928 \u0915\u0930\u093e",
        "nau aath saat chhe paanch char teen do ek shunya",
    })
    void aMobileSpelledInWordsIsRefused(String text) {
        assertThat(accepts(text))
                .as("a spelled-out contact number reached the public page: %s", text)
                .isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "One of the best 2 BHK flats, two balconies, three sides open",
        "Rent 25000, two months deposit, one year lock-in",
        "\u090f\u0915 \u0938\u0941\u0902\u0926\u0930 \u0926\u094b \u092c\u0940\u090f\u091a\u0915\u0947 \u092b\u094d\u0932\u0948\u091f",
    })
    void numberWordsInProseAreNotAPhoneNumber(String text) {
        assertThat(accepts(text))
                .as("ordinary prose with number words was refused: %s", text)
                .isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   "})
    void emptinessIsSomebodyElsesConstraint(String text) {
        assertThat(accepts(text)).isTrue();
    }

    @Test
    void nullIsSomebodyElsesConstraint() {
        assertThat(accepts(null)).isTrue();
    }

    // The possessive local part is pinned both ways because a wrong one fails silently.
    // Bean Validation is not fail-fast, so a 4,000-character run must not hang.
    static Stream<Arguments> hostileInputs() {
        return Stream.of(
                Arguments.of("aLongRunWithNoSeparatorStillFinishesPromptly",
                        "Well-maintained office in Baner with covered parking and a backup DG set. "
                                .repeat(54)),
                Arguments.of("aLongWhitespaceRunAfterAnAtStillFinishesPromptly",
                        "a".repeat(1000) + "@a" + " ".repeat(2990) + "!"),
                Arguments.of("aHostileFortyKilobytesStillFinishesPromptly: letters",
                        "a".repeat(40_000)),
                Arguments.of("aHostileFortyKilobytesStillFinishesPromptly: dotted domain",
                        "a@" + "1.".repeat(20_000)),
                Arguments.of("aHostileFortyKilobytesStillFinishesPromptly: spaced ats",
                        "a @ ".repeat(10_000)));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("hostileInputs")
    void hostileInputStillFinishesPromptly(String name, String text) {
        assertTimeout(Duration.ofSeconds(2), () -> assertThat(accepts(text)).isTrue());
    }

    @Test
    void aLongLocalPartIsStillAnEmail() {
        assertThat(accepts("write to " + "owner".repeat(20) + "@example.com")).isFalse();
    }
}
