package com.punenest.api.common.validation;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Unit test for {@link IndianMobileValidator} — the leniency the Q1 ruling chose (Option A) and the
 * one strictness it must not lose.
 *
 * <p>The validator is exercised directly rather than through a bean-validation round trip: it holds
 * no state and takes no context it uses, so a plain call isolates the two-part rule — normalisable
 * <em>and</em> matching the stored {@link Formats#MOBILE} shape — from the framework wiring that a
 * DTO test would really be checking instead.
 */
@DisplayName("IndianMobileValidator — tolerant input, strict stored shape (Q1)")
class IndianMobileValidatorTest {

    private final IndianMobileValidator validator = new IndianMobileValidator();

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {
        "9821000123",              // plain ten digits
        "+91 98210 00123",         // spaces and a +91 prefix, the way a person types it
        "09821000123",            // a single leading zero
        "00919821000123",         // the 0091 international form
        "982-100-0123",           // punctuation between the digits
    })
    @DisplayName("accepts null and anything that canonicalises to a valid ten-digit mobile")
    void accepts(String value) {
        assertThat(validator.isValid(value, null)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "1234567890",              // normalises to ten digits but starts 1 — the gate that matters
        "2012345678",              // landline-style leading 2
        "5999999999",             // leading 5, still not a mobile
        "98765",                   // too short
        "987654321012345",        // fifteen digits, no valid prefix
        "12345678901234",         // fourteen digits, prefix is not a country code
        "not-a-number",            // no digits at all
    })
    @DisplayName("rejects text that is not, or does not reduce to, a 6-9-leading ten-digit mobile")
    void rejects(String value) {
        assertThat(validator.isValid(value, null)).isFalse();
    }
}
