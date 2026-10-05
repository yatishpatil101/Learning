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
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Refuses a phone number or email in free prose — the contact gate's back door. Digits are stripped before
 * matching; obfuscations in words are out of scope and remain the reviewer's job. */
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT, ElementType.TYPE_USE})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = NoContactDetails.Validator.class)
public @interface NoContactDetails {

    String message() default "must not contain a phone number, email address or messaging link."
            + " Buyers reach you through Draazy once they request your contact details";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<NoContactDetails, String> {

        /** Any ten-digit Indian mobile, once separators are gone. Longer runs are not numbers. */
        private static final Pattern MOBILE = Pattern.compile("(?<![0-9])(?:0|91)?[6-9][0-9]{9}(?![0-9])");

        private static final String TLD = "(?:com|in|net|org|co|info|biz|me|io)(?!\\p{L})";
        private static final String PROVIDER = "(?:gmail|yahoo|outlook|hotmail|rediffmail|ymail|icloud)(?!\\p{L})";
        private static final String DOT_WORD = "\\s?\\(?dot\\)?\\s?" + TLD;
        private static final String KNOWN_DOMAIN = "(?:" + PROVIDER + "|[\\p{L}0-9-]+(?:\\." + TLD + "|" + DOT_WORD + "))";
        private static final Pattern EMAIL = Pattern.compile(
                "(?<![\\p{L}0-9._%+-])[\\p{L}0-9._%+-]++(?:@[\\p{L}0-9.-]+(?:\\.\\p{L}{2,}|" + DOT_WORD + ")|@" + PROVIDER
                        + "|\\s?(?:\\s@|@\\s|\\(at\\)|\\[at\\]| at(?:[\\s-]the[\\s-]rate)? )\\s?" + KNOWN_DOMAIN + ")",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

        private static final Pattern LINK = Pattern.compile(
                "(?<![\\p{L}0-9])(?:(?:wa|t|m)\\s?\\.\\s?me\\s?/|(?:whatsapp|instagram|facebook|telegram|snapchat)\\s?\\.\\s?(?:com|me)"
                        + "|fb\\s?\\.\\s?(?:me|com))",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

        private static final Pattern HANDLE = Pattern.compile(
                "(?<!\\p{L})(?:insta(?:gram)?|ig|telegram|snap(?:chat)?|facebook|fb|twitter)\\s?(?:id|handle)?\\s?[:-]?\\s?@[\\p{L}0-9._]{2,}",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

        private static final String[][] DIGIT_WORDS = {
            {"zero", "shunya", "शून्य"},
            {"one", "ek", "एक"},
            {"two", "do", "दो", "दोन"},
            {"three", "teen", "तीन"},
            {"four", "char", "chaar", "चार"},
            {"five", "paanch", "panch", "पांच", "पाँच", "पाच"},
            {"six", "chhe", "chhah", "छह", "छः", "छे", "सहा"},
            {"seven", "saat", "सात"},
            {"eight", "aath", "आठ"},
            {"nine", "nau", "नौ", "नऊ"},
        };
        private static final Map<String, String> DIGIT_BY_WORD = new HashMap<>();

        static {
            for (int digit = 0; digit < DIGIT_WORDS.length; digit++) {
                for (String word : DIGIT_WORDS[digit]) {
                    DIGIT_BY_WORD.put(word, String.valueOf(digit));
                }
            }
        }

        private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{M}]+");
        private static final Pattern REPEATED =
                Pattern.compile("(double|triple|dabal|डबल|ट्रिपल)[\\p{Z}\\s\\p{Pd}]*([0-9])", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

        private static final Pattern INVISIBLE = Pattern.compile("\\p{Cf}");

        private static final Pattern WHITESPACE = Pattern.compile("[\\s\\p{Z}\\u0085]+");

        private static final Pattern SEPARATORS = Pattern.compile("[\\p{Z}\\p{Pd}\\p{M}\\s.()+_*:|']");

        private static final Pattern RANGE_JOIN = Pattern.compile("(?<=[0-9]000)[\\p{Z}\\s]*[\\p{Pd}|](?=[\\p{Z}\\s]*[0-9])");

        @Override
        public boolean isValid(String text, ConstraintValidatorContext context) {
            if (text == null || text.isBlank()) {
                return true;
            }

            String normalized = toAsciiDigits(INVISIBLE.matcher(Normalizer.normalize(text, Normalizer.Form.NFKC)).replaceAll(""));
            String collapsed = WHITESPACE.matcher(normalized).replaceAll(" ");
            return !EMAIL.matcher(collapsed).find()
                    && !LINK.matcher(collapsed).find()
                    && !HANDLE.matcher(collapsed).find()
                    && !hasMobile(spelledDigits(normalized));
        }

        private static String spelledDigits(String text) {
            String digits = WORD.matcher(text)
                    .replaceAll(m -> DIGIT_BY_WORD.getOrDefault(m.group().toLowerCase(Locale.ROOT), m.group()));
            return REPEATED.matcher(digits)
                    .replaceAll(m -> m.group(2).repeat(m.group(1).equalsIgnoreCase("triple") || m.group(1).equals("ट्रिपल") ? 3 : 2));
        }

        /** NFKC folds the fullwidth digits but not the Indic ones, which are separate characters
         * rather than compatibility variants — so the digit value is read out explicitly. */
        private static String toAsciiDigits(String text) {
            StringBuilder out = new StringBuilder(text.length());
            text.codePoints().forEach(cp -> {
                int type = Character.getType(cp);
                int digit = type == Character.DECIMAL_DIGIT_NUMBER ? Character.digit(cp, 10)
                        : type == Character.OTHER_NUMBER ? Character.getNumericValue(cp) : -1;
                if (digit >= 0 && digit <= 9) {
                    out.append((char) ('0' + digit));
                } else {
                    out.appendCodePoint(cp);
                }
            });
            return out.toString();
        }

        private static boolean hasMobile(String text) {
            return MOBILE.matcher(SEPARATORS.matcher(RANGE_JOIN.matcher(text).replaceAll(",")).replaceAll("")).find();
        }
    }
}
