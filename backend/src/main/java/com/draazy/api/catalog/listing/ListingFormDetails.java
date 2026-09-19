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
                "availableFrom", "possession", "transactionType", "rentMaintMode", "plotArea",
                "floorsInHouse", "washrooms",
                "shellType", "camCharges", "plotLength", "plotWidth", "openSides", "roadWidth",
                "plotZone", "waterSource", "naStatus", "otherRights", "buyerEligibility",
                "gstOnRent", "fitOutMonths", "escalationPct", "tenancyStatus", "inPlaceRent", "leaseExpiry",
                "seatCount", "frontage", "floorLoad", "clearHeight", "sanctionedPower", "dockCount");
        /* `naSanctioned` and `satbara` are retired in favour of `naStatus` and `otherRights`; they
         * stay legal because listings published under them are live and re-save theirs unchanged. */
        private static final Set<String> FLAGS = Set.of(
                "loanAvailable", "powerBackup", "pantry", "cornerPlot", "boundaryWall",
                "naSanctioned", "electricity", "roadAccess", "satbara");
        private static final Set<String> ARRAYS = Set.of("furniture", "fixtures", "suitableFor", "preferredTenants");
        private static final Map<String, Integer> LIMITS = Map.of(
                "flatNumber", 20, "tower", 30, "society", 60, "street", 60, "landmark", 60,
                "availableFrom", 10, "leaseExpiry", 10);

        /* Picker answers, so a length check would accept what a picker can never produce — and these feed
         * filters and contract terms. Empty stays legal: that is the owner declining to answer. */
        private static final Map<String, Set<String>> ENUMS = Map.ofEntries(
                Map.entry("ownership", Set.of("", "Freehold", "Leasehold", "Co-operative Society",
                        "Power of Attorney", "MIDC / Industrial Lease")),
                Map.entry("agreementDuration", Set.of("", "6", "11", "12", "24", "36", "60", "108", "120", "long")),
                Map.entry("lockIn", Set.of("", "0", "1", "2", "3", "6", "12", "24", "36", "60")),
                Map.entry("noticePeriod", Set.of("", "1", "2", "3", "6")),
                Map.entry("foodPref", Set.of("", "any", "veg")),
                Map.entry("petsPolicy", Set.of("", "yes", "no")),
                Map.entry("rentMaintMode", Set.of("", "included", "extra")),
                Map.entry("transactionType", Set.of("", "new", "resale")),
                /* `coworking` is retired from the wizard but stays legal: listings published under it
                 * are still live, and a re-save that rejected it would force the owner to relabel. */
                Map.entry("commercialType", Set.of("", "office", "shop", "retail", "warehouse",
                        "industrial", "coworking")),
                Map.entry("shellType", Set.of("", "bareShell", "warmShell", "furnished")),
                Map.entry("washrooms", Set.of("", "0", "1", "2", "3", "4+")),
                Map.entry("gstOnRent", Set.of("", "yes", "no")),
                Map.entry("fitOutMonths", Set.of("", "0", "1", "2", "3", "6")),
                Map.entry("tenancyStatus", Set.of("", "vacant", "leased")),
                /* Translated into `land_use`, whose CHECK accepts five values — an unrecognised label does
                 * not fail, it maps to nothing and the plot publishes missing from its only filter. */
                Map.entry("plotZone", Set.of("", "Residential (R1)", "Residential (R2)",
                        "Commercial (C-1)", "Industrial (I-1)", "Public / Semi-public", "Mixed-Use",
                        "Agriculture Zone", "Green Zone / No-Development Zone",
                        "Residential", "Commercial", "Industrial", "Agricultural")),
                Map.entry("naStatus", Set.of("", "agricultural", "deemed", "sanctioned")),
                Map.entry("otherRights", Set.of("", "clear", "mortgage", "tenancy", "minor",
                        "dispute", "unknown")),
                Map.entry("buyerEligibility", Set.of("", "agriculturist", "permission", "converted",
                        "unknown")));

        /* Multi-selects are pickers too. `furniture` and `preferredTenants` stay unbounded: both are
         * offered per property type from lists this file would have to duplicate four times over. */
        private static final Map<String, Set<String>> ARRAY_ENUMS = Map.of(
                "suitableFor", Set.of("Office", "Retail", "Restaurant", "Clinic", "Showroom",
                        "Warehouse", "Bank / ATM", "Gym / Studio"),
                "fixtures", Set.of(
                        "Server / UPS Room", "Meeting Cabins", "Reception Area", "Conference Room",
                        "False Ceiling", "Central AC",
                        "Main-Road Frontage", "Display Windows", "Rolling Shutter", "Signage Space",
                        "Mezzanine Floor", "Customer Washroom",
                        "Loading Bay / Dock", "High Ceiling", "3-Phase Power", "Wide Truck Access",
                        "Crane / Gantry Support", "Covered Yard"));

        /* The numeric commercial specs: digits with at most one decimal point, and empty stays
         * legal. A length check alone would accept "forty" as a seat count. */
        private static final Set<String> DECIMALS = Set.of(
                "escalationPct", "inPlaceRent", "seatCount", "frontage", "floorLoad",
                "clearHeight", "sanctionedPower", "dockCount", "camCharges");

        private static final Set<String> DATES = Set.of("availableFrom", "leaseExpiry");

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
                if (!(value instanceof List<?> list) || list.size() > 30) return false;
                Set<String> allowedItems = ARRAY_ENUMS.get(key);
                return list.stream().allMatch(item -> item instanceof String s && validText(s, 80)
                        && (allowedItems == null || s.isEmpty() || allowedItems.contains(s)));
            }
            if (!TEXT.contains(key) || !(value instanceof String text)
                    || !validText(text, LIMITS.getOrDefault(key, 80))) return false;
            Set<String> allowed = ENUMS.get(key);
            if (allowed != null) return allowed.contains(text);
            if (DECIMALS.contains(key)) return text.isEmpty() || text.matches("\\d{1,9}(\\.\\d{1,2})?");
            if (!DATES.contains(key) || text.isEmpty()) return true;
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