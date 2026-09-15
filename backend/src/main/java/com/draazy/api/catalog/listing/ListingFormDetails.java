package com.draazy.api.catalog.listing;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Closed, bounded owner-edit answers; canonical listing fields and trust flags cannot enter here. */
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ListingFormDetails.Validator.class)
public @interface ListingFormDetails {
    String message() default "contains unsupported fields, invalid values or oversized answers";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<ListingFormDetails, Map<String, Object>> {
        private static final Set<String> TEXT = Set.of(
                "flatNumber", "tower", "society", "street", "landmark", "commercialType",
                "ownership", "agreementDuration", "lockIn", "noticePeriod", "foodPref", "petsPolicy",
                "availableFrom", "possession", "rentMaintMode", "plotArea", "floorsInHouse", "washrooms",
                "shellType", "camCharges", "plotLength", "plotWidth", "openSides", "roadWidth",
                "plotZone", "waterSource");
        private static final Set<String> FLAGS = Set.of(
                "loanAvailable", "powerBackup", "pantry", "cornerPlot", "boundaryWall",
                "naSanctioned", "electricity", "roadAccess", "satbara");
        private static final Set<String> ARRAYS = Set.of("furniture", "fixtures", "suitableFor", "preferredTenants");
        private static final Map<String, Integer> LIMITS = Map.of(
                "flatNumber", 20, "tower", 30, "society", 60, "street", 60, "landmark", 60,
                "availableFrom", 10);

        @Override
        public boolean isValid(Map<String, Object> details, ConstraintValidatorContext context) {
            if (details == null) return true;
            if (details.size() > TEXT.size() + FLAGS.size() + ARRAYS.size()) return false;
            Map<?, ?> raw = details;
            return raw.entrySet().stream().allMatch(entry -> entry.getKey() instanceof String key
                    && validValue(key, entry.getValue()));
        }

        private static boolean validValue(String key, Object value) {
            if (FLAGS.contains(key)) return value instanceof Boolean;
            if (ARRAYS.contains(key)) {
                return value instanceof List<?> list && list.size() <= 30
                        && list.stream().allMatch(item -> item instanceof String s && validText(s, 80));
            }
            if (!TEXT.contains(key) || !(value instanceof String text)
                    || !validText(text, LIMITS.getOrDefault(key, 80))) return false;
            if (!key.equals("availableFrom") || text.isEmpty()) return true;
            try {
                return LocalDate.parse(text).toString().equals(text);
            } catch (DateTimeParseException ignored) {
                return false;
            }
        }

        // Single-line answers exclude controls and unpaired surrogates: JSONB rejects NUL, and
        // escaped controls could exceed the storage cap despite the per-answer length limits.
        private static boolean validText(String text, int limit) {
            return text.length() <= limit && text.codePoints()
                    .noneMatch(c -> c < 32 || (c >= 0xD800 && c <= 0xDFFF));
        }
    }
}