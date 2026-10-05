package com.draazy.api.common.validation;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Aadhaar numbers carry UIDAI's Verhoeff check digit")
class AadhaarValidatorTest {

    private final AadhaarValidator validator = new AadhaarValidator();

    @Test
    @DisplayName("a number with the right check digit passes, and one digit off fails")
    void checkDigit() {
        assertThat(AadhaarValidator.isAadhaar(validAadhaar("23456789012"))).isTrue();
        assertThat(AadhaarValidator.isAadhaar(validAadhaar("99998888777"))).isTrue();
        assertThat(AadhaarValidator.isAadhaar("234567890123")).isFalse();
        assertThat(AadhaarValidator.isAadhaar("999988887777")).isFalse();
    }

    @Test
    @DisplayName("a transposition of adjacent digits is caught")
    void transposition() {
        assertThat(AadhaarValidator.isAadhaar("324567890124")).isFalse();
    }

    @Test
    @DisplayName("UIDAI never issues a number starting 0 or 1, or one that is not twelve digits")
    void shape() {
        assertThat(AadhaarValidator.isAadhaar("111122223333")).isFalse();
        assertThat(AadhaarValidator.isAadhaar("23456789012")).isFalse();
        assertThat(AadhaarValidator.isAadhaar("2345 6789 0124")).isFalse();
    }

    @Test
    @DisplayName("an absent number is left to @NotBlank, not refused here")
    void blankPasses() {
        assertThat(validator.isValid(null, null)).isTrue();
        assertThat(validator.isValid("  ", null)).isTrue();
        assertThat(validator.isValid(" 234567890124 ", null)).isTrue();
    }

    static String validAadhaar(String body) {
        for (char digit = '0'; digit <= '9'; digit++) {
            String candidate = body + digit;
            if (AadhaarValidator.isAadhaar(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("No Verhoeff digit completes " + body);
    }
}
