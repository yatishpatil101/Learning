package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.DealIntent;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.math.BigDecimal;
import java.util.Locale;
import java.util.Map;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ListingSanityLimits.Validator.class)
public @interface ListingSanityLimits {

    String message() default "outside the listing sanity limits";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    interface Input {
        String deal();

        String propertyType();

        Long price();

        Long deposit();

        BigDecimal carpetArea();

        BigDecimal builtUpArea();

        BigDecimal superBuiltUpArea();

        String reraId();

        Map<String, Object> formDetails();
    }

    class Validator implements ConstraintValidator<ListingSanityLimits, Input> {
        private static final long SALE_PRICE_MIN = 100_000L;
        private static final long MONTHLY_RENT_MIN = 1_000L;
        private static final long MAX_DEPOSIT_MONTHS = 24L;
        private static final BigDecimal RESIDENTIAL_AREA_MIN = new BigDecimal("100");
        private static final BigDecimal RESIDENTIAL_AREA_MAX = new BigDecimal("20000");

        @Override
        public boolean isValid(Input in, ConstraintValidatorContext context) {
            if (in == null) {
                return true;
            }
            context.disableDefaultConstraintViolation();
            boolean valid = true;
            if (DealIntent.BUY.equals(in.deal()) && in.price() != null && in.price() < SALE_PRICE_MIN) {
                valid = report(context, "price", "must be at least Rs. 1,00,000 for a sale listing");
            }
            if (DealIntent.RENT.equals(in.deal()) && in.price() != null && in.price() < MONTHLY_RENT_MIN) {
                valid = report(context, "price", "must be at least Rs. 1,000 per month");
            }
            if (DealIntent.RENT.equals(in.deal()) && in.deposit() != null && in.price() != null
                    && in.deposit() > in.price() * MAX_DEPOSIT_MONTHS) {
                valid = report(context, "deposit", "cannot exceed 24 months of rent");
            }
            if (isResidential(in.propertyType())) {
                valid = validateResidentialAreas(in, context, valid);
            }
            return valid;
        }

        private static boolean validateResidentialAreas(Input in, ConstraintValidatorContext context,
                boolean valid) {
            if (in.carpetArea() != null && outside(in.carpetArea(), RESIDENTIAL_AREA_MIN,
                    RESIDENTIAL_AREA_MAX)) {
                valid = report(context, "carpetArea",
                        "must be between 100 and 20,000 sq.ft for a residential listing");
            }
            if (exceeds(in.carpetArea(), in.builtUpArea())) {
                valid = report(context, "builtUpArea", "must be at least the carpet area");
            }
            BigDecimal superBuiltUpFloor = in.builtUpArea() == null ? in.carpetArea() : in.builtUpArea();
            if (exceeds(superBuiltUpFloor, in.superBuiltUpArea())) {
                valid = report(context, "superBuiltUpArea",
                        in.builtUpArea() == null
                                ? "must be at least the carpet area"
                                : "must be at least the built-up area");
            }
            return valid;
        }

        private static boolean outside(BigDecimal value, BigDecimal min, BigDecimal max) {
            return value.compareTo(min) < 0 || value.compareTo(max) > 0;
        }

        private static boolean exceeds(BigDecimal smaller, BigDecimal larger) {
            return smaller != null && larger != null && smaller.compareTo(larger) > 0;
        }

        private static boolean isResidential(String propertyType) {
            if (propertyType == null) {
                return false;
            }
            String label = propertyType.toLowerCase(Locale.ROOT);
            return label.contains("flat")
                    || label.contains("apartment")
                    || label.contains("studio")
                    || label.contains("penthouse")
                    || label.contains("independent house")
                    || label.contains("row house")
                    || label.contains("villa");
        }

        private static boolean report(ConstraintValidatorContext context, String field, String message) {
            context.buildConstraintViolationWithTemplate(message)
                    .addPropertyNode(field)
                    .addConstraintViolation();
            return false;
        }
    }
}
