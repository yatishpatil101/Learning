package com.draazy.api.moderation.verification;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * A rejection must carry its reason: the owner has nothing else to act on. Reported against
 * {@code note} rather than the body, so the console can mark the field the reviewer must fill in.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = RejectionNeedsReason.Validator.class)
public @interface RejectionNeedsReason {
    String message() default "is required when rejecting: the owner is shown this reason";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<RejectionNeedsReason,
            PropertyVerificationController.DecisionRequest> {

        @Override
        public boolean isValid(PropertyVerificationController.DecisionRequest body,
                ConstraintValidatorContext context) {
            if (body == null || !"reject".equals(body.decision())
                    || (body.note() != null && !body.note().isBlank())) {
                return true;
            }
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate())
                    .addPropertyNode("note")
                    .addConstraintViolation();
            return false;
        }
    }
}
