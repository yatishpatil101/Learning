package com.draazy.api.engagement.flatmate;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = FlatDescribedUnlessHunting.Check.class)
@interface FlatDescribedUnlessHunting {

    String message() default "must not be blank";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Check implements ConstraintValidator<FlatDescribedUnlessHunting, FlatmateGroupCreateRequest> {
        @Override
        public boolean isValid(FlatmateGroupCreateRequest body, ConstraintValidatorContext ctx) {
            if (body == null || body.hunting()) {
                return true;
            }
            boolean ok = true;
            ctx.disableDefaultConstraintViolation();
            if (body.locality() == null || body.locality().isBlank()) {
                ctx.buildConstraintViolationWithTemplate("must not be blank")
                        .addPropertyNode("locality").addConstraintViolation();
                ok = false;
            }
            if (body.rent() == null) {
                ctx.buildConstraintViolationWithTemplate("must not be null")
                        .addPropertyNode("rent").addConstraintViolation();
                ok = false;
            }
            return ok;
        }
    }
}
