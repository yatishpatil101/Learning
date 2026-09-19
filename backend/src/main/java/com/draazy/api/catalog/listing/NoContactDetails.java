package com.draazy.api.catalog.listing;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.text.Normalizer;
import java.util.regex.Pattern;

/**
 * Refuses a phone number or email in free prose — the contact gate's back door. Digits are stripped before
 * matching; obfuscations in words are out of scope and remain the reviewer's job.
 */
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT, ElementType.TYPE_USE})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = NoContactDetails.Validator.class)
public @interface NoContactDetails {

    String message() default "must not contain a phone number or email address."
            + " Buyers reach you through Draazy once they request your contact details";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<NoContactDetails, String> {

        /** Any ten-digit Indian mobile, once separators are gone. Longer runs are not numbers. */
        private static final Pattern MOBILE = Pattern.compile("(?<![0-9])(?:0|91)?[6-9][0-9]{9}(?![0-9])");

        /*
         * Possessive local part: nothing it could give back is in the class, so backtracking is pure cost
         * — quadratic on prose with no `@`. The domain stays greedy, since `.` IS in its class.
         */
        private static final Pattern EMAIL =
                Pattern.compile("[\\p{L}0-9._%+-]++\\s*(?:@|\\(at\\)|\\[at\\]| at )\\s*[\\p{L}0-9.-]+\\s*(?:\\.|\\s*\\(?dot\\)?\\s*)\\s*[\\p{L}]{2,}",
                        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

        /**
         * What joins one number, including the non-breaking space every WhatsApp paste carries. Comma and
         * slash are excluded: stripping them read "₹65,00,000 / 750 sq.ft" as a mobile.
         */
        private static final Pattern SEPARATORS = Pattern.compile("[\\p{Z}\\p{Pd}\\s.()+_]");

        @Override
        public boolean isValid(String text, ConstraintValidatorContext context) {
            if (text == null || text.isBlank()) {
                return true;
            }
            /* NFKC first, so the Devanagari digits a Hindi or Marathi listing may be typed in are the
               characters the patterns below look for — "९८७६५४३२१०" is a mobile to every human reader. */
            String normalized = toAsciiDigits(Normalizer.normalize(text, Normalizer.Form.NFKC));
            return !EMAIL.matcher(normalized).find() && !hasMobile(normalized);
        }

        /**
         * NFKC folds the fullwidth digits but not the Indic ones, which are separate characters
         * rather than compatibility variants — so the digit value is read out explicitly.
         */
        private static String toAsciiDigits(String text) {
            StringBuilder out = new StringBuilder(text.length());
            text.codePoints().forEach(cp -> {
                int digit = Character.digit(cp, 10);
                if (digit >= 0 && !Character.isLetter(cp)) {
                    out.append((char) ('0' + digit));
                } else {
                    out.appendCodePoint(cp);
                }
            });
            return out.toString();
        }

        private static boolean hasMobile(String text) {
            return MOBILE.matcher(SEPARATORS.matcher(text).replaceAll("")).find();
        }
    }
}
