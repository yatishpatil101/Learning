package com.draazy.api.catalog.listing;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.math.BigDecimal;

/**
 * The arithmetic between fields that are each individually plausible: floor 9 of a 4-storey building is a
 * contradiction, not a typo. Only compares pairs the submission states — a missing count is silence.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = CoherentDimensions.Validator.class)
public @interface CoherentDimensions {

    String message() default "contradicts another dimension on this listing";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    /** What the validator needs, so one rule covers both the create and the update body. */
    interface Dimensions {
        Integer floor();

        Integer totalFloors();

        BigDecimal carpetArea();

        BigDecimal builtUpArea();

        BigDecimal superBuiltUpArea();
    }

    class Validator implements ConstraintValidator<CoherentDimensions, Dimensions> {

        @Override
        public boolean isValid(Dimensions in, ConstraintValidatorContext context) {
            if (in == null) {
                return true;
            }
            context.disableDefaultConstraintViolation();
            boolean valid = true;
            if (in.floor() != null && in.totalFloors() != null && in.floor() > in.totalFloors()) {
                valid = report(context, "floor", "cannot be above the building's top floor");
            }
            if (exceeds(in.carpetArea(), in.builtUpArea())) {
                valid = report(context, "carpetArea", "cannot exceed the built-up area");
            }
            if (exceeds(in.builtUpArea(), in.superBuiltUpArea())) {
                valid = report(context, "builtUpArea", "cannot exceed the super built-up area");
            }
            if (exceeds(in.carpetArea(), in.superBuiltUpArea())) {
                valid = report(context, "carpetArea", "cannot exceed the super built-up area");
            }
            return valid;
        }

        private static boolean exceeds(BigDecimal smaller, BigDecimal larger) {
            return smaller != null && larger != null && smaller.compareTo(larger) > 0;
        }

        private static boolean report(ConstraintValidatorContext context, String field, String message) {
            context.buildConstraintViolationWithTemplate(message)
                    .addPropertyNode(field)
                    .addConstraintViolation();
            return false;
        }
    }
}
