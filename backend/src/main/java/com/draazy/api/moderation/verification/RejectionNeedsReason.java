package com.draazy.api.moderation.verification;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

// Report against note so the console can mark the field the reviewer must fill in.
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = RejectionNeedsReason.Validator.class)
public @interface RejectionNeedsReason {
    String message() default "is required for needs_info or reject";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<RejectionNeedsReason,
            PropertyVerificationController.DecisionRequest> {

        @Override
        public boolean isValid(PropertyVerificationController.DecisionRequest body,
                ConstraintValidatorContext context) {
            if (body == null || (!"reject".equals(body.decision()) && !"needs_info".equals(body.decision()))
                    || (body.reasonCode() != null && !body.reasonCode().isBlank())) {
                return true;
            }
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate())
                    .addPropertyNode("reasonCode")
                    .addConstraintViolation();
            return false;
        }
    }
}
